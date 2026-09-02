import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { subIssuesPath, workflowRunsPath } from "../shared/gh-paths";
import { reason } from "../shared/reason";
import {
  commentBody,
  entryLine,
  finding,
  FINDING_MARKER,
  isLostDispatch,
  signalBody,
  signalTitle,
  type PrdCandidate,
} from "./lost-dispatch";

/**
 * The lost-dispatch counter's entrypoint (#127, ADR-0062, ADR-0065,
 * `.github/workflows/lost-dispatch-counter.yml`): fires on a PRD being labelled `sliceable`,
 * reads whether it sliced, and if it didn't, comments on — or opens — the one standing issue
 * naming every PRD this counter has found lost.
 *
 * **The workflow file cannot correlate a slicing run to a PRD number precisely — this reads is an
 * approximation and says so.** GitHub's runs list carries no field naming the issue a
 * label-triggered run served, so `hasCompletedSlicingRun` below treats *any* completed run of the
 * slicing lane created no earlier than this PRD was opened as evidence the dispatch arrived. The
 * one case this exists to catch — a dispatch that never arrived, so the lane produced no run at
 * all in the whole window — is exactly where that approximation cannot go wrong; a coincidental
 * neighbour run is the only way it can occasionally clear a finding it shouldn't. That is a
 * one-sided error (fewer findings, never more), and the reader it's for can always check by hand.
 *
 * **One standing issue, not one per PRD** (`./lost-dispatch.ts`'s header) — the shape #124's
 * missing-trailer counter established for a `Count: 1` counter that files a growing list rather
 * than a fresh issue per occurrence.
 *
 * **Recomputes, stores nothing.** Every run reads this one PRD's state fresh; whether it has
 * already been named is derived from the standing issue's own body and comments, not a cursor.
 */

/** How many of the slicing lane's most recent runs one check reads — several times this repo's busiest day of `to-tickets` runs. */
export const RUN_PAGE_SIZE = 30;

/** The label this counter is a durable trace of (ADR-0062). Spelled here and in `lost-dispatch-counter.yml`'s job-level `if` — no compiler sees across that boundary, so `lost-dispatch.test.ts` asserts the two still agree. */
export const SLICEABLE_LABEL = "sliceable";

const ApiRun = z.object({
  status: z.string(),
  created_at: z.string(),
});

const PrdIssue = z.object({
  title: z.string(),
  createdAt: z.string(),
  labels: z.array(z.object({ name: z.string() })),
});

const StandingIssue = z.object({
  number: z.number(),
  state: z.string(),
  body: z.string().nullable(),
  comments: z.array(z.object({ body: z.string() })),
});

function readPrd(gh: GhExec, prdNumber: number): { title: string; createdAt: string; labels: string[] } {
  const raw = gh(["issue", "view", String(prdNumber), "--json", "title,createdAt,labels"]);
  const parsed = PrdIssue.parse(JSON.parse(raw));
  return { title: parsed.title, createdAt: parsed.createdAt, labels: parsed.labels.map((label) => label.name) };
}

function readSubIssueCount(gh: GhExec, prdNumber: number): number {
  const raw = gh(["api", subIssuesPath(prdNumber), "--jq", "length"]);
  return Number(raw.trim());
}

/** Whether the slicing lane has produced a completed run since `prdCreatedAt` — see this module's header for the approximation this makes. */
function hasCompletedSlicingRun(gh: GhExec, prdCreatedAt: string, slicingWorkflow: string): boolean {
  const projection = "[.workflow_runs[] | {status, created_at}]";
  const raw = gh(["api", workflowRunsPath(slicingWorkflow, RUN_PAGE_SIZE), "--jq", projection]);
  const runs = ApiRun.array().parse(JSON.parse(raw));
  return runs.some((run) => run.status === "completed" && run.created_at >= prdCreatedAt);
}

/** The open issue carrying `FINDING_MARKER`, if one is already standing. */
function readStandingIssue(gh: GhExec): z.infer<typeof StandingIssue> | undefined {
  const raw = gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,state,body,comments"]);
  const issues = StandingIssue.array().parse(JSON.parse(raw));
  return issues.find((issue) => (issue.body ?? "").includes(FINDING_MARKER));
}

/** Whether `prdNumber` is already named on `standing` — its body (the first finding) or any comment (every later one). */
function alreadyNamed(standing: z.infer<typeof StandingIssue>, prdNumber: number): boolean {
  const marker = `#${prdNumber} —`;
  if ((standing.body ?? "").includes(marker)) return true;
  return standing.comments.some((comment) => comment.body.includes(marker));
}

export interface CounterOptions {
  gh: GhExec;
  /** `github.event.label.name` on the `issues: labeled` event that triggered this run. */
  labelName: string | null | undefined;
  prdNumber: number;
  /**
   * The workflow **file** in the calling repository whose runs are the slicing lane's history —
   * `to-tickets-caller.yml` here, never `to-tickets.yml`: ADR-0055 (amended by ADR-0132) records a
   * `uses:`-reached run against the caller's file, and `to-tickets.yml` itself has carried no run
   * of its own since the split. No default, for the reason `bypass-counter.ts`'s own
   * `verifyWorkflow` has none: a wrong name reads a page frozen before the split, every entry on
   * it older than any PRD opened since — so `hasCompletedSlicingRun` reads false for a PRD that
   * really did slice, and every PRD since the split reads lost.
   */
  slicingWorkflow: string;
  log?: (line: string) => void;
}

export type CounterAction = "skipped" | "clean" | "opened" | "commented" | "already-named";

export interface CounterOutcome {
  action: CounterAction;
  issue?: number;
}

export function countLostDispatch(options: CounterOptions): CounterOutcome {
  const { gh, labelName, prdNumber, slicingWorkflow } = options;
  const log = options.log ?? ((line: string) => console.log(line));

  if (labelName !== SLICEABLE_LABEL) {
    return { action: "skipped" };
  }

  const prd = readPrd(gh, prdNumber);
  const candidate: PrdCandidate = {
    number: prdNumber,
    title: prd.title,
    labels: prd.labels,
    subIssueCount: readSubIssueCount(gh, prdNumber),
    hasCompletedSlicingRun: hasCompletedSlicingRun(gh, prd.createdAt, slicingWorkflow),
  };

  if (!isLostDispatch(candidate)) {
    log(`clean: #${prdNumber} sliced`);
    return { action: "clean" };
  }

  const entry = finding(candidate);
  const standing = readStandingIssue(gh);

  if (standing && alreadyNamed(standing, prdNumber)) {
    log(`already named on #${standing.number}: #${prdNumber}`);
    return { action: "already-named", issue: standing.number };
  }

  if (standing) {
    gh(["issue", "comment", String(standing.number), "--body", commentBody(entry)]);
    log(`commented on #${standing.number}: ${entryLine(entry)}`);
    return { action: "commented", issue: standing.number };
  }

  const url = gh(["issue", "create", "--title", signalTitle(), "--body", signalBody(entry)]).trim();
  const opened = Number(url.split("/").pop());
  log(`opened #${opened}: ${entryLine(entry)}`);
  return { action: "opened", issue: opened };
}

async function main(): Promise<void> {
  try {
    const prdNumberRaw = process.env.PRD_NUMBER;
    if (!prdNumberRaw) throw new Error("PRD_NUMBER must be set");

    // Refused rather than defaulted, the same reason `bypass-counter.ts`'s `VERIFY_WORKFLOW` is:
    // a workflow file the calling repository does not have reads a frozen page and reports every
    // PRD since the split as lost.
    const slicingWorkflow = process.env.SLICING_WORKFLOW;
    if (!slicingWorkflow) {
      throw new Error("SLICING_WORKFLOW must be set — reading a workflow that does not exist misreports every PRD");
    }

    const outcome = countLostDispatch({
      gh: execGh,
      labelName: process.env.LABEL_NAME,
      prdNumber: Number(prdNumberRaw),
      slicingWorkflow,
    });
    console.log(outcome.action);
  } catch (err) {
    console.error(`lost-dispatch-counter failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
