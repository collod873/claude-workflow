import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { runJobsPath, workflowRunsPath } from "../shared/gh-paths";
import { reason } from "../shared/reason";
import { bypassCount, ISSUE_TITLE, issueBody, markedCount, shouldPropose, type VerifyRun } from "./bypass";

/**
 * The bypass counter's entrypoint (PRD #117, move 8d,
 * `.github/workflows/bypass-counter.yml`): recomputes how many times
 * `verify.yml` has failed at its `Gauntlet` step on `main` — a red tree
 * reaching trunk despite the free venues — and, once that count reaches
 * `BYPASS_THRESHOLD`, files an issue proposing move 10 (branch protection)
 * be brought forward.
 *
 * **Recomputes, stores nothing.** No cursor, no ledger. The count is read
 * fresh off `verify.yml`'s own run history every time this fires, the same
 * shape `run-watchdog.ts` already has for dead lanes.
 *
 * **One-sided, with no delete trigger.** Its firing condition is a build
 * landing — move 10 makes the class of event this counts structurally
 * impossible — so it has no zero-count close condition to build. A declined
 * proposal (a closed issue carrying the counter's marker) re-proposes only
 * once the count has grown past what that issue recorded, so a "no" cannot
 * be nagged past.
 *
 * **Rides `workflow_run` on `verify.yml` completing, not a clock.** ADR-0004
 * forbids a cadence; `verify.yml` completing on `main` is the event this
 * counts, so it is also the event that re-evaluates the count. The job-level
 * `if` in `bypass-counter.yml` scopes this to `main`, and `isBypass` in
 * `./bypass.ts` checks the same fact independently off the fetched run data
 * — so a workflow-level mis-scope cannot make this over-count.
 */

const ApiRun = z.object({
  id: z.number(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  head_branch: z.string().nullable(),
  created_at: z.string(),
});

const JobsResponse = z.object({
  jobs: z.array(
    z.object({
      steps: z.array(
        z.object({
          name: z.string(),
          conclusion: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const SignalIssue = z.object({
  number: z.number(),
  body: z.string().nullable(),
  state: z.string(),
});

/** One page of `verify.yml`'s own runs. A hundred reaches back through this repo's entire history to date many times over. */
export const RUN_PAGE_SIZE = 100;

/**
 * The most job reads one sweep will spend finding a failed step name. Each
 * costs one API call; a repo mid-incident can fail a great many runs, and a
 * sweep that spent hundreds of calls would be reporting its own lack of a
 * bound. What it declines to read is logged, because a cap nobody is told
 * about reads as "there was nothing else".
 */
export const MAX_JOB_READS = 60;

function readRuns(gh: GhExec): Array<{ id: number; conclusion: string; htmlUrl: string; headBranch: string; createdAt: string }> {
  const projection = "[.workflow_runs[] | {id, conclusion, html_url, head_branch, created_at}]";
  const raw = gh(["api", workflowRunsPath("verify.yml", RUN_PAGE_SIZE), "--jq", projection]);
  return ApiRun.array()
    .parse(JSON.parse(raw))
    .map((run) => ({
      id: run.id,
      conclusion: run.conclusion ?? "",
      htmlUrl: run.html_url,
      headBranch: run.head_branch ?? "",
      createdAt: run.created_at,
    }));
}

/**
 * The name of the step that failed in `runId`, or `undefined` if none did
 * (the run executed no job at all — that is the run watchdog's concern, not
 * this counter's) or more than one did, in which case the first failure in
 * job order is the one that actually stopped the run.
 */
function failedStepName(gh: GhExec, runId: number): string | undefined {
  const raw = gh(["api", runJobsPath(runId)]);
  const parsed = JobsResponse.parse(JSON.parse(raw));
  for (const job of parsed.jobs) {
    const failed = job.steps.find((step) => step.conclusion === "failure");
    if (failed) return failed.name;
  }
  return undefined;
}

/** Every issue carrying this counter's marker, open or closed. */
function readSignals(gh: GhExec): Array<z.infer<typeof SignalIssue>> {
  const raw = gh(["issue", "list", "--state", "all", "--limit", "200", "--json", "number,body,state"]);
  return SignalIssue.array().parse(JSON.parse(raw));
}

export interface BypassCounterOptions {
  gh: GhExec;
  /** Who the signal is assigned to, so it notifies rather than sits in a list. */
  assignee: string;
  log?: (line: string) => void;
}

export interface BypassCounterOutcome {
  /** A stable slug for the log — mirrors `run-watchdog.ts`'s own `Outcome.code`. */
  code: "below-threshold" | "already-proposed" | "declined-and-not-grown" | "proposed";
  count: number;
  issue?: number;
  wrote?: "opened";
}

export function runBypassCounter(options: BypassCounterOptions): BypassCounterOutcome {
  const { gh, assignee } = options;
  const log = options.log ?? ((line: string) => console.log(line));

  const runs = readRuns(gh);
  const failed = runs.filter((run) => run.conclusion === "failure");

  const read = failed.slice(0, MAX_JOB_READS);
  if (failed.length > read.length) {
    log(`note: ${failed.length - read.length} failed run(s) went unread — this sweep spends at most ${MAX_JOB_READS} job reads`);
  }

  const verifyRuns: VerifyRun[] = read.map((run) => ({
    id: run.id,
    headBranch: run.headBranch,
    createdAt: run.createdAt,
    htmlUrl: run.htmlUrl,
    conclusion: run.conclusion,
    failedStep: failedStepName(gh, run.id),
  }));

  const count = bypassCount(verifyRuns);
  if (!shouldPropose(count)) {
    log(`counted: ${count} bypass(es) — below the threshold of proposing move 10`);
    return { code: "below-threshold", count };
  }

  const existing = readSignals(gh);
  const carriers = existing.filter((issue) => (issue.body ?? "").includes("<!-- bypass-counter:"));

  const standing = carriers.find((issue) => issue.state.toUpperCase() === "OPEN");
  if (standing) {
    log(`counted: ${count} bypass(es) — proposal #${standing.number} already stands`);
    return { code: "already-proposed", count };
  }

  // A closed carrier is a proposal the owner has already ruled on. Re-filing at the same count would
  // teach the reader to close this mechanism's issues unread, so only a count that has grown past
  // what that issue recorded reopens the question.
  const highestDeclined = carriers
    .map((issue) => markedCount(issue.body ?? ""))
    .filter((each): each is number => each !== undefined)
    .sort((a, b) => a - b)
    .pop();
  if (highestDeclined !== undefined && count <= highestDeclined) {
    log(`counted: ${count} bypass(es) — not past the declined count of ${highestDeclined}`);
    return { code: "declined-and-not-grown", count };
  }

  const url = gh([
    "issue",
    "create",
    "--title",
    ISSUE_TITLE,
    "--body",
    issueBody(verifyRuns),
    "--assignee",
    assignee,
  ]).trim();
  const opened = Number(url.split("/").pop());
  log(`opened #${opened}: ${count} verify.yml bypasses of the free gates on main`);
  return { code: "proposed", count, issue: opened, wrote: "opened" };
}

async function main(): Promise<void> {
  try {
    const assignee = process.env.SIGNAL_ASSIGNEE;
    if (!assignee) throw new Error("SIGNAL_ASSIGNEE must be set — an unassigned issue notifies nobody");

    const outcome = runBypassCounter({ gh: execGh, assignee });
    console.log(`${outcome.code}: count ${outcome.count}${outcome.issue ? `, opened #${outcome.issue}` : ""}`);
  } catch (err) {
    console.error(`bypass-counter failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
