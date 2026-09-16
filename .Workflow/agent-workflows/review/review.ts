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
import { commitPullsPath } from "../shared/gh-paths";
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

export interface RunReviewInput {
  diff: string;
  assignee: string;
  head: string;
  root?: string;
  budgetMinutes?: number;
}

interface CommitPull {
  head?: { sha?: string; ref?: string };
}

function resolveTicket(gh: GhExec, head: string): number {
  const pulls = JSON.parse(gh(["api", commitPullsPath(head)])) as CommitPull[];

  const pull = pulls.find((candidate) => candidate.head?.sha === head);
  if (!pull) throw new Error(`no pull request has ${head} as its head commit`);

  const branch = pull.head?.ref ?? "";
  const ticketNumber = implementationBranchTicket(branch);
  if (ticketNumber === undefined) {
    throw new Error(`head branch \`${branch}\` is not an implementation claim, so it names no ticket`);
  }
  return ticketNumber;
}

export interface RunReviewResult {
  survivors: Finding[];
  publishedIssues: number[];
  tally: RefuterTally;
  counter: CounterOutcome;
}

function resolveTicketSafely(gh: GhExec, head: string): number | undefined {
  try {
    return resolveTicket(gh, head);
  } catch (err) {
    console.error(`review runs unmarked: ${reason(err)}`);
    return undefined;
  }
}

export async function runReview(exec: StageExec, gh: GhExec, input: RunReviewInput): Promise<RunReviewResult> {
  const budgetMinutes = input.budgetMinutes ?? laneBudget("review");
  const ticketNumber = resolveTicketSafely(gh, input.head);
  if (ticketNumber !== undefined) markLane(gh, ticketNumber, REVIEWING_LABEL);
  const ticket = ticketNumber === undefined ? undefined : { gh, ticket: ticketNumber, run: currentLaneRun() };
  const budget = startLaneBudget(budgetMinutes, ticket);

  const candidates = await runCorrectnessReview(exec, budget, { diff: input.diff });
  const survivors = await runRefuter(exec, candidates, input.diff, budgetMinutes);
  const tally: RefuterTally = { reached: candidates.length, refuted: candidates.length - survivors.length };

  const publishedIssues = publishFindings(gh, survivors, input.assignee);
  const counter = runCounter({ gh, tally, assignee: input.assignee });

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
