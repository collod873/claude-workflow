import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  currentLaneRun,
  execClaudeIn,
  runStageSessionWithinBudget,
  startLaneBudget,
  type LaneBudget,
  type StageExec,
} from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { execGit } from "../shared/git";
import { execGh, type GhExec } from "../shared/gh";
import { laneBudget } from "../shared/lane-budget";
import { markLane, REVIEWING_LABEL } from "../shared/labels";
import { reason } from "../shared/reason";
import { trackerGh } from "../shared/tracker-gh";
import type { Tracker } from "../shared/tracker";
import { implementationBranchTicket } from "../shared/ready-set";
import { isStructurallyRefused, type Finding } from "./structural-refusal";
import { runRefuter } from "./refuter";
import { publishFindings } from "./publish-findings";
import { runCounter, type CounterOutcome, type RefuterTally } from "./counter";

export type { Finding } from "./structural-refusal";

const CORRECTNESS_REVIEWER_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/review/correctness-reviewer/prompt.md";

export const CORRECTNESS_REVIEWER_OUTPUT = structuredOutput(
  z.object({ findings: z.array(z.object({ message: z.string().min(1) })) }),
);

export interface CorrectnessReviewInput {
  diff: string;
}

export function keepSurvivingFindings(findings: Finding[], diff: string): Finding[] {
  return findings.filter((finding) => !isStructurallyRefused(finding, diff));
}

export async function runCorrectnessReview(
  exec: StageExec,
  budget: LaneBudget,
  input: CorrectnessReviewInput,
): Promise<Finding[]> {
  const { value: raw } = await runStageSessionWithinBudget(
    PROMPT_PATH,
    { DIFF: input.diff },
    exec,
    CORRECTNESS_REVIEWER_OUTPUT,
    {
      budget,
      model: CORRECTNESS_REVIEWER_MODEL,
      promptViaStdin: true,
      stage: "correctness",
    },
  );
  return keepSurvivingFindings(raw.findings, input.diff);
}

export type ReviewTracker = GhExec | Tracker;

function isGhExec(source: ReviewTracker): source is GhExec {
  return typeof source === "function";
}

function toTracker(source: ReviewTracker): Tracker {
  return isGhExec(source) ? trackerGh(source) : source;
}

export interface RunReviewInput {
  diff: string;
  assignee: string;
  head: string;
  root?: string;
  budgetMinutes?: number;
}

function resolveTicket(tracker: Tracker, head: string): number {
  const pull = tracker.commitPulls(head).find((candidate) => candidate.headSha === head);
  if (!pull) throw new Error(`no pull request has ${head} as its head commit`);

  const ticketNumber = implementationBranchTicket(pull.headRef);
  if (ticketNumber === undefined) {
    throw new Error(`head branch \`${pull.headRef}\` is not an implementation claim, so it names no ticket`);
  }
  return ticketNumber;
}

export interface RunReviewResult {
  survivors: Finding[];
  publishedIssues: number[];
  tally: RefuterTally;
  counter: CounterOutcome;
}

function resolveTicketSafely(tracker: Tracker, head: string): number | undefined {
  try {
    return resolveTicket(tracker, head);
  } catch (err) {
    console.error(`review runs unmarked: ${reason(err)}`);
    return undefined;
  }
}

export async function runReview(exec: StageExec, source: ReviewTracker, input: RunReviewInput): Promise<RunReviewResult> {
  const tracker = toTracker(source);
  const gh = isGhExec(source) ? source : undefined;

  const budgetMinutes = input.budgetMinutes ?? laneBudget("review");
  const ticketNumber = resolveTicketSafely(tracker, input.head);
  if (ticketNumber !== undefined && gh) markLane(gh, ticketNumber, REVIEWING_LABEL);
  const ticket = ticketNumber === undefined || !gh ? undefined : { gh, ticket: ticketNumber, run: currentLaneRun() };
  const budget = startLaneBudget(budgetMinutes, ticket);

  const candidates = await runCorrectnessReview(exec, budget, { diff: input.diff });
  const survivors = await runRefuter(exec, candidates, input.diff, budgetMinutes);
  const tally: RefuterTally = { reached: candidates.length, refuted: candidates.length - survivors.length };

  const publishedIssues = publishFindings(tracker, survivors, input.assignee);
  const counter = runCounter({ tracker, tally, assignee: input.assignee });

  return { survivors, publishedIssues, tally, counter };
}

async function main(): Promise<void> {
  const base = process.argv[2];
  const head = process.argv[3] ?? "HEAD";

  if (!base) {
    console.error("usage: review.ts <base-ref> [head-ref]");
    process.exitCode = 1;
    return;
  }

  const assignee = process.env.SIGNAL_ASSIGNEE;
  if (!assignee) {
    console.error("SIGNAL_ASSIGNEE must be set: an unassigned finding notifies nobody");
    process.exitCode = 1;
    return;
  }

  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();

  try {
    const diff = execGit(["-C", repoDir, "diff", `${base}...${head}`]);
    const result = await runReview(execClaudeIn(repoDir), execGh, { diff, assignee, head });
    console.log(
      JSON.stringify({ publishedIssues: result.publishedIssues, tally: result.tally }),
    );
  } catch (err) {
    console.error(`review failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
