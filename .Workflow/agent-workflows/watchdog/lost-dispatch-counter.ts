import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, fetchSubIssueCount, type GhExec } from "../shared/gh";
import { SLICEABLE_LABEL } from "../shared/labels";
import { reason } from "../shared/reason";
import type { Tracker } from "../shared/tracker";
import { trackerGh } from "../shared/tracker-gh";
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

export const RUN_PAGE_SIZE = 30;

export { SLICEABLE_LABEL };

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

function hasSuccessfulSlicingRun(tracker: Tracker, prdCreatedAt: string, slicingWorkflow: string): boolean {
  const runs = tracker.workflowRuns(slicingWorkflow, RUN_PAGE_SIZE);
  return runs.some((run) => run.conclusion === "success" && run.createdAt >= prdCreatedAt);
}

function readStandingIssue(gh: GhExec): z.infer<typeof StandingIssue> | undefined {
  const raw = gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,state,body,comments"]);
  const issues = StandingIssue.array().parse(JSON.parse(raw));
  return issues.find((issue) => (issue.body ?? "").includes(FINDING_MARKER));
}

function alreadyNamed(standing: z.infer<typeof StandingIssue>, prdNumber: number): boolean {
  const marker = `#${prdNumber} —`;
  if ((standing.body ?? "").includes(marker)) return true;
  return standing.comments.some((comment) => comment.body.includes(marker));
}

export interface CounterOptions {
  gh: GhExec;
  labelName: string | null | undefined;
  prdNumber: number;
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

  const tracker = trackerGh(gh);
  const prd = readPrd(gh, prdNumber);
  const candidate: PrdCandidate = {
    number: prdNumber,
    title: prd.title,
    labels: prd.labels,
    subIssueCount: fetchSubIssueCount(gh, prdNumber),
    hasSuccessfulSlicingRun: hasSuccessfulSlicingRun(tracker, prd.createdAt, slicingWorkflow),
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

    const slicingWorkflow = process.env.SLICING_WORKFLOW;
    if (!slicingWorkflow) {
      throw new Error("SLICING_WORKFLOW must be set: reading a workflow that does not exist misreports every PRD");
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
