import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { execGit } from "../shared/git";
import { execGh, type GhExec } from "../shared/gh";
import { parseIssueNumber } from "../shared/issue-url";
import { reason } from "../shared/reason";
import { fileSpecGap } from "../shared/spec-gap";
import { testsForCriteria } from "../shared/affected-tests";
import { commitPullsPath } from "../shared/gh-paths";
import { implementationBranchTicket } from "../shared/ready-set";
import { extractCriteria, parentPrdNumber, readTicket } from "../shared/ticket-shape";
import { isStructurallyRefused, type Finding, type GreenGateCheck } from "./structural-refusal";
import { runRefuter } from "./refuter";
import { publishFindings } from "./publish-findings";
import { runCounter, type CounterOutcome, type RefuterTally } from "./counter";

export type { Finding, GreenGateCheck } from "./structural-refusal";

const CORRECTNESS_REVIEWER_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/review/correctness-reviewer/prompt.md";

export const CORRECTNESS_REVIEWER_OUTPUT = structuredOutput(
  z.object({ findings: z.array(z.object({ message: z.string().min(1) })) }),
);

export interface CorrectnessReviewInput {
  diff: string;
  greenGateChecks: GreenGateCheck[];
}

export function keepSurvivingFindings(
  findings: Finding[],
  diff: string,
  greenGateChecks: GreenGateCheck[],
): Finding[] {
  return findings.filter((finding) => !isStructurallyRefused(finding, diff, greenGateChecks));
}

export async function runCorrectnessReview(
  exec: StageExec,
  input: CorrectnessReviewInput,
): Promise<Finding[]> {
  const raw = await runStage(
    PROMPT_PATH,
    { DIFF: input.diff },
    exec,
    CORRECTNESS_REVIEWER_OUTPUT,
    {
      model: CORRECTNESS_REVIEWER_MODEL,
      promptViaStdin: true,
      stage: "correctness",
    },
  );
  return keepSurvivingFindings(raw.findings, input.diff, input.greenGateChecks);
}

const CONFORMANCE_REVIEWER_PROMPT_PATH =
  ".Workflow/agent-workflows/review/conformance-reviewer/prompt.md";

export const CONFORMANCE_REVIEWER_OUTPUT = structuredOutput(
  z.object({
    items: z.array(
      z.object({
        classification: z.enum(["divergence", "gap"]),
        message: z.string().min(1),
      }),
    ),
  }),
);

export interface ConformanceReviewInput {
  specText: string;
  diff: string;
  criteria: string[];
  greenGateChecks: GreenGateCheck[];
  prdIssueNumber: number;
  root?: string;
}

export interface ConformanceReviewResult {
  findings: Finding[];
  gapIssues: number[];
}

export function untestedCriteria(criteria: string[], root?: string): string[] {
  return criteria.filter((criterion) => testsForCriteria([criterion], root).length === 0);
}

function fileConformanceGap(gh: GhExec, prdIssueNumber: number, report: string): number {
  return fileSpecGap(
    gh,
    prdIssueNumber,
    `spec/gap: #${prdIssueNumber}'s spec is silent on part of this diff`,
    `Filed by lane 07's conformance reviewer (ADR-0038).\n\n${report}`,
  );
}

export async function runConformanceReview(
  exec: StageExec,
  gh: GhExec,
  input: ConformanceReviewInput,
): Promise<ConformanceReviewResult> {
  const scope = untestedCriteria(input.criteria, input.root);

  const raw = await runStage(
    CONFORMANCE_REVIEWER_PROMPT_PATH,
    { SPEC: input.specText, SCOPE: scope.join("\n"), DIFF: input.diff },
    exec,
    CONFORMANCE_REVIEWER_OUTPUT,
    {
      model: CORRECTNESS_REVIEWER_MODEL,
      promptViaStdin: true,
      stage: "conformance",
    },
  );

  const divergences = raw.items
    .filter((item) => item.classification === "divergence")
    .map((item) => ({ message: item.message }));
  const findings = keepSurvivingFindings(divergences, input.diff, input.greenGateChecks);

  const gapIssues = raw.items
    .filter((item) => item.classification === "gap")
    .map((item) => fileConformanceGap(gh, input.prdIssueNumber, item.message));

  return { findings, gapIssues };
}

export interface RunReviewInput {
  diff: string;
  greenGateChecks: GreenGateCheck[];
  assignee: string;
  head: string;
  root?: string;
}

type ResolvedSpec = Pick<ConformanceReviewInput, "specText" | "criteria" | "prdIssueNumber">;

interface CommitPull {
  head?: { sha?: string; ref?: string };
}

function resolveSpec(gh: GhExec, head: string): ResolvedSpec {
  const pulls = JSON.parse(gh(["api", commitPullsPath(head)])) as CommitPull[];

  const pull = pulls.find((candidate) => candidate.head?.sha === head);
  if (!pull) throw new Error(`no pull request has ${head} as its head commit`);

  const branch = pull.head?.ref ?? "";
  const ticketNumber = implementationBranchTicket(branch);
  if (ticketNumber === undefined) {
    throw new Error(`head branch \`${branch}\` is not an implementation claim, so it names no ticket`);
  }

  const ticket = readTicket(gh, ticketNumber);
  const criteria = extractCriteria(ticket.body);

  const prdNumber = parentPrdNumber(ticket.body);
  if (prdNumber === undefined) {
    return { specText: ticket.body, criteria, prdIssueNumber: ticketNumber };
  }

  return { specText: readTicket(gh, prdNumber).body, criteria, prdIssueNumber: prdNumber };
}

export interface RunReviewResult {
  survivors: Finding[];
  publishedIssues: number[];
  tally: RefuterTally;
  counter: CounterOutcome;
}

export async function runReview(exec: StageExec, gh: GhExec, input: RunReviewInput): Promise<RunReviewResult> {
  const correctness = await runCorrectnessReview(exec, { diff: input.diff, greenGateChecks: input.greenGateChecks });

  const conformance = await reviewConformance(exec, gh, input);

  const candidates = [...correctness, ...conformance];
  const survivors = await runRefuter(exec, candidates, input.diff, input.greenGateChecks);
  const tally: RefuterTally = { reached: candidates.length, refuted: candidates.length - survivors.length };

  const publishedIssues = publishFindings(gh, survivors, input.assignee);
  const counter = runCounter({ gh, tally, assignee: input.assignee });

  return { survivors, publishedIssues, tally, counter };
}

async function reviewConformance(exec: StageExec, gh: GhExec, input: RunReviewInput): Promise<Finding[]> {
  let spec: ResolvedSpec;
  try {
    spec = resolveSpec(gh, input.head);
  } catch (err) {
    console.error(`conformance review skipped: ${reason(err)}`);
    return [];
  }

  const result = await runConformanceReview(exec, gh, {
    specText: spec.specText,
    diff: input.diff,
    criteria: spec.criteria,
    greenGateChecks: input.greenGateChecks,
    prdIssueNumber: spec.prdIssueNumber,
    root: input.root,
  });
  return result.findings;
}

async function main(): Promise<void> {
  const base = process.argv[2];
  const head = process.argv[3] ?? "HEAD";
  const greenGateChecks = process.argv.slice(4);

  if (!base) {
    console.error("usage: review.ts <base-ref> [head-ref] [green-gate-check...]");
    process.exitCode = 1;
    return;
  }

  const assignee = process.env.SIGNAL_ASSIGNEE;
  if (!assignee) {
    console.error("SIGNAL_ASSIGNEE must be set — an unassigned finding notifies nobody");
    process.exitCode = 1;
    return;
  }

  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();

  try {
    const diff = execGit(["-C", repoDir, "diff", `${base}...${head}`]);
    const result = await runReview(execClaudeIn(repoDir), execGh, { diff, greenGateChecks, assignee, head });
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
