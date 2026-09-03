import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { runJobsPath, workflowRunsPath } from "../shared/gh-paths";
import { reason } from "../shared/reason";
import { SignalIssueSchema } from "../shared/signal-issue-schema";
import { bypassCount, ISSUE_TITLE, issueBody, markedCount, shouldPropose, type VerifyRun } from "./bypass";

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


export const RUN_PAGE_SIZE = 100;

export const MAX_JOB_READS = 60;

function readRuns(gh: GhExec, verifyWorkflow: string): Array<{ id: number; conclusion: string; htmlUrl: string; headBranch: string; createdAt: string }> {
  const projection = "[.workflow_runs[] | {id, conclusion, html_url, head_branch, created_at}]";
  const raw = gh(["api", workflowRunsPath(verifyWorkflow, RUN_PAGE_SIZE), "--jq", projection]);
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

function failedStepName(gh: GhExec, runId: number): string | undefined {
  const raw = gh(["api", runJobsPath(runId)]);
  const parsed = JobsResponse.parse(JSON.parse(raw));
  for (const job of parsed.jobs) {
    const failed = job.steps.find((step) => step.conclusion === "failure");
    if (failed) return failed.name;
  }
  return undefined;
}

function readSignals(gh: GhExec): Array<z.infer<typeof SignalIssueSchema>> {
  const raw = gh([
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,body,state,stateReason",
  ]);
  return SignalIssueSchema.array().parse(JSON.parse(raw));
}

const NOT_PLANNED = "NOT_PLANNED";

export interface BypassCounterOptions {
  gh: GhExec;
  assignee: string;
  verifyWorkflow: string;
  log?: (line: string) => void;
}

export interface BypassCounterOutcome {
  code:
    | "below-threshold"
    | "already-proposed"
    | "declined-and-not-grown"
    | "declined-for-good"
    | "proposed";
  count: number;
  issue?: number;
  wrote?: "opened";
}

export function runBypassCounter(options: BypassCounterOptions): BypassCounterOutcome {
  const { gh, assignee, verifyWorkflow } = options;
  const log = options.log ?? ((line: string) => console.log(line));

  const runs = readRuns(gh, verifyWorkflow);
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

  const refused = carriers.find(
    (issue) => issue.state.toUpperCase() === "CLOSED" && issue.stateReason?.toUpperCase() === NOT_PLANNED,
  );
  if (refused) {
    log(`counted: ${count} bypass(es) — #${refused.number} was closed as not planned, so this asks no further`);
    return { code: "declined-for-good", count };
  }

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
  log(`opened #${opened}: ${count} ${verifyWorkflow} bypasses of the free gates on main`);
  return { code: "proposed", count, issue: opened, wrote: "opened" };
}

async function main(): Promise<void> {
  try {
    const assignee = process.env.SIGNAL_ASSIGNEE;
    if (!assignee) throw new Error("SIGNAL_ASSIGNEE must be set — an unassigned issue notifies nobody");

    const verifyWorkflow = process.env.VERIFY_WORKFLOW;
    if (!verifyWorkflow) {
      throw new Error("VERIFY_WORKFLOW must be set — counting a workflow that does not exist reads as zero bypasses");
    }

    const outcome = runBypassCounter({ gh: execGh, assignee, verifyWorkflow });
    console.log(`${outcome.code}: count ${outcome.count}${outcome.issue ? `, opened #${outcome.issue}` : ""}`);
  } catch (err) {
    console.error(`bypass-counter failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
