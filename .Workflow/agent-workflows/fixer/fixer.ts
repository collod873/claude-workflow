import { pathToFileURL } from "node:url";
import { z } from "zod";
import { dispatchVerify } from "../shared/verify-dispatch";
import { execGh, type GhExec } from "../shared/gh";
import { gateGrowth } from "../shared/gate-files";
import { execGit, type GitExec } from "../shared/git";
import { escalateToOwner } from "../shared/needs-human";
import { reason } from "../shared/reason";
import { fileSpecGap } from "../shared/spec-gap";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { runVitestReport } from "../shared/vitest-json";
import { extractCriteria, parentPrdNumber, readTicket } from "../shared/ticket-shape";

export type StopReason = "no-progress" | "capped" | "gate-growth";

export const MAX_ATTEMPTS = 3;

export const FIXER_PROMPT_PATH = ".Workflow/agent-workflows/fixer/prompt.md";

export const FIXER_MODEL = "claude-sonnet-5";

export interface FixerFailure {
  testName: string;
  errorMessage: string;
}

export type FailureSignature = FixerFailure[];

export interface FixerTestResult {
  failures: FixerFailure[];
}

function signatureKey(signature: FailureSignature): string {
  const sorted = [...signature].sort(
    (a, b) => a.testName.localeCompare(b.testName) || a.errorMessage.localeCompare(b.errorMessage),
  );
  return JSON.stringify(sorted);
}

export function signaturesEqual(a: FailureSignature, b: FailureSignature): boolean {
  return signatureKey(a) === signatureKey(b);
}

const FixerAnswer = z.object({
  summary: z.string().min(1),
});
type FixerAnswer = z.infer<typeof FixerAnswer>;

export const FIXER_OUTPUT = structuredOutput(FixerAnswer);

export function assembleFixBrief(signature: FailureSignature, attempt: number, priorSummaries: string[]): string {
  const failing =
    signature.length > 0
      ? signature.map((failure) => `### ${failure.testName}\n\n${failure.errorMessage}`).join("\n\n")
      : "(none)";
  const tried =
    priorSummaries.length > 0
      ? priorSummaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n")
      : "(none: this is the first attempt)";

  return [
    `## Attempt ${attempt} of ${MAX_ATTEMPTS}`,
    "## Currently failing",
    failing,
    "## What prior attempts already tried",
    tried,
  ].join("\n\n");
}

export function runFixerStage(exec: StageExec, brief: string): Promise<FixerAnswer> {
  return runStage(FIXER_PROMPT_PATH, { BRIEF: brief }, exec, FIXER_OUTPUT, {
    model: FIXER_MODEL,
    promptViaStdin: true,
    stage: "fixer",
  });
}

export function changedPaths(git: GitExec): string[] {
  return git(["status", "--porcelain", "-uall"])
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3))
    .map((path) => {
      const arrow = path.indexOf(" -> ");
      return arrow === -1 ? path : path.slice(arrow + 4);
    })
    .map((path) => (path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path));
}

function commitAndPushAttempt(
  git: GitExec,
  branch: string,
  paths: string[],
  attempt: number,
  summary: string,
  issueNumber: number,
): void {
  git(["checkout", branch]);
  git(["add", ...paths]);
  git(["commit", "-m", `fix: attempt ${attempt} at #${issueNumber}\n\n${summary}\n\nPart of #${issueNumber}`]);
  git(["push", "--force-with-lease", "origin", `HEAD:${branch}`]);
}

export function blockedComment(
  stopReason: StopReason,
  attemptSummaries: string[],
  gapIssue?: number,
  gateFiles: string[] = [],
): string {
  const why = {
    "no-progress":
      "Two consecutive attempts left the identical tests failing with the identical errors, and nothing further will change that.",
    capped: `${MAX_ATTEMPTS} attempts is this lane's cap, reached without landing a green run.`,
    "gate-growth": `The last attempt adds a file to the gate, which a lane may shrink and never grow (#360); it was not committed.\n\n${gateFiles.map((path) => `- \`${path}\``).join("\n")}`,
  }[stopReason];

  const tried = attemptSummaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n");
  const routed =
    gapIssue === undefined
      ? ""
      : `\n\nFiled as \`spec/gap\` #${gapIssue}: an immovable test is a defect in the contract, not in this diff (ADR-0119).`;

  return `**Blocked.** ${why}\n\nWhat was tried:\n\n${tried}${routed}`;
}

export function immovableGapReport(
  ticketNumber: number,
  signature: FailureSignature,
  attemptSummaries: string[],
): string {
  const failing = signature.map((failure) => `### ${failure.testName}\n\n${failure.errorMessage}`).join("\n\n");
  const tried = attemptSummaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n");

  return [
    `The fixer made ${MAX_ATTEMPTS === attemptSummaries.length ? "every" : `${attemptSummaries.length}`} attempt(s) at #${ticketNumber} and two consecutive ones left the identical tests failing with the identical errors.`,
    "",
    "An acceptance test that does not move under two independent attempts is not being failed by the",
    "diff: it is asking for something the ticket did not decide, and ADR-0034 rules that the spec,",
    "not the test, is what settles that. The reading the test encodes is below; the criterion it was",
    "authored from is the one to clarify.",
    "",
    "## What stayed red, unchanged",
    "",
    failing,
    "",
    "## What the fixer tried",
    "",
    tried,
  ].join("\n");
}

export function unfixableComment(failedJob: string, errorLine: string): string {
  return `**Needs a human.** \`${failedJob}\` failed without a test failing, so there is nothing this lane can reproduce and fix.\n\n${errorLine}`;
}

function applyBlocked(
  gh: GhExec,
  issueNumber: number,
  prNumber: number,
  assignee: string,
  stopReason: StopReason,
  attemptSummaries: string[],
  immovable?: FailureSignature,
  gateFiles: string[] = [],
): void {
  escalateToOwner(gh, issueNumber, assignee);

  let gapIssue: number | undefined;
  if (stopReason === "no-progress" && immovable) {
    const prd = parentPrdNumber(readTicket(gh, issueNumber).body);
    if (prd !== undefined) {
      gapIssue = fileSpecGap(
        gh,
        prd,
        `spec/gap: #${issueNumber}'s acceptance test does not move under any fix`,
        immovableGapReport(issueNumber, immovable, attemptSummaries),
      );
    }
  }

  gh(["pr", "comment", String(prNumber), "--body", blockedComment(stopReason, attemptSummaries, gapIssue, gateFiles)]);
}

export function applyUnfixable(gh: GhExec, issueNumber: number, prNumber: number, assignee: string, failedJob: string, errorLine: string): void {
  escalateToOwner(gh, issueNumber, assignee);
  gh(["pr", "comment", String(prNumber), "--body", unfixableComment(failedJob, errorLine)]);
}

export interface FixerDeps {
  gh: GhExec;
  exec: StageExec;
  git: GitExec;
  runTests: () => FixerTestResult | Promise<FixerTestResult>;
  initialFailure: FailureSignature;
  prNumber: number;
  branch: string;
  issueNumber: number;
  assignee: string;
}

function rejudge(gh: GhExec, prNumber: number, issueNumber: number): void {
  const pr = JSON.parse(gh(["pr", "view", String(prNumber), "--json", "url,files"])) as {
    url: string;
    files: Array<{ path: string }>;
  };
  dispatchVerify(gh, {
    prUrl: pr.url,
    changedFiles: pr.files.map((file) => file.path),
    criteria: extractCriteria(readTicket(gh, issueNumber).body),
  });
}

export type FixerOutcome =
  | { verdict: "green"; attempts: number }
  | { verdict: "blocked"; attempts: number; stopReason: StopReason };

export function priorAttempts(git: GitExec): number {
  const subjects = git(["log", "origin/main..HEAD", "--format=%s"]);
  return subjects.split("\n").filter((line) => /^fix: attempt \d+ at #\d+/.test(line)).length;
}

export async function runFixer(deps: FixerDeps): Promise<FixerOutcome> {
  let previousSignature = deps.initialFailure;
  const attemptSummaries: string[] = [];

  const already = priorAttempts(deps.git);
  if (already >= MAX_ATTEMPTS) {
    applyBlocked(deps.gh, deps.issueNumber, deps.prNumber, deps.assignee, "capped", [
      `${already} attempt(s) were already on this branch from earlier fixer runs, and Verify refused every one.`,
    ]);
    return { verdict: "blocked", attempts: 0, stopReason: "capped" };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS - already; attempt += 1) {
    const brief = assembleFixBrief(previousSignature, attempt, attemptSummaries);
    const answer = await runFixerStage(deps.exec, brief);

    const paths = changedPaths(deps.git);
    attemptSummaries.push(answer.summary);

    const growth = gateGrowth(deps.git, paths);
    if (growth.length > 0) {
      applyBlocked(deps.gh, deps.issueNumber, deps.prNumber, deps.assignee, "gate-growth", attemptSummaries, undefined, growth);
      return { verdict: "blocked", attempts: attempt, stopReason: "gate-growth" };
    }

    if (paths.length > 0) {
      commitAndPushAttempt(deps.git, deps.branch, paths, attempt, answer.summary, deps.issueNumber);
    }

    const result = await deps.runTests();

    if (result.failures.length === 0) {
      rejudge(deps.gh, deps.prNumber, deps.issueNumber);
      return { verdict: "green", attempts: attempt };
    }

    if (attempt >= 2 && signaturesEqual(result.failures, previousSignature)) {
      applyBlocked(
        deps.gh,
        deps.issueNumber,
        deps.prNumber,
        deps.assignee,
        "no-progress",
        attemptSummaries,
        result.failures,
      );
      return { verdict: "blocked", attempts: attempt, stopReason: "no-progress" };
    }

    if (attempt === MAX_ATTEMPTS - already) {
      applyBlocked(deps.gh, deps.issueNumber, deps.prNumber, deps.assignee, "capped", attemptSummaries);
      return { verdict: "blocked", attempts: attempt, stopReason: "capped" };
    }

    previousSignature = result.failures;
  }

  throw new Error("runFixer: exited its loop without a verdict");
}

export function runVitestJsonForFixer(targets: string[], repoDir: string = process.cwd()): FixerTestResult {
  const ran = runVitestReport(targets, repoDir);
  if ("error" in ran) return { failures: [{ testName: targets.join(" "), errorMessage: ran.error }] };

  const failures: FixerFailure[] = [];
  for (const file of ran.report.testResults) {
    if (file.assertionResults.length === 0 && file.status === "failed") {
      failures.push({ testName: file.name, errorMessage: file.message ?? "failed to collect" });
      continue;
    }
    for (const assertion of file.assertionResults) {
      if (assertion.status !== "failed") continue;
      failures.push({
        testName: assertion.fullName ?? assertion.title ?? file.name,
        errorMessage: (assertion.failureMessages ?? []).join("\n") || "failed",
      });
    }
  }

  return { failures };
}

function readAssignee(): string {
  const assignee = process.env.SIGNAL_ASSIGNEE;
  if (!assignee) throw new Error("SIGNAL_ASSIGNEE must be set: an unassigned ticket notifies nobody");
  return assignee;
}

async function runEscalate(): Promise<void> {
  const [issueArg, prArg, failedJob, errorLine] = process.argv.slice(3);
  if (!issueArg || !prArg || !failedJob || !errorLine) {
    console.error("usage: fixer.ts escalate <issue-number> <pr-number> <failed-job-name> <error-line>");
    process.exitCode = 1;
    return;
  }

  try {
    applyUnfixable(execGh, Number(issueArg), Number(prArg), readAssignee(), failedJob, errorLine);
    console.log(`escalated #${issueArg}: ${failedJob} failed without a test failing`);
  } catch (err) {
    console.error(`fixer failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

async function runFix(): Promise<void> {
  const [issueArg, prArg, branch, dir] = process.argv.slice(2);
  if (!issueArg || !prArg || !branch || !dir) {
    console.error("usage: fixer.ts <issue-number> <pr-number> <branch> <test-dir>");
    process.exitCode = 1;
    return;
  }

  try {
    const targets = [dir];

    const repoDir = process.env.TARGET_WORKSPACE || process.cwd();

    const initialFailure = runVitestJsonForFixer(targets, repoDir).failures;
    if (initialFailure.length === 0) {
      console.log(`nothing to fix: no test under ${targets.join(" or ")} is failing in this checkout`);
      return;
    }

    const outcome = await runFixer({
      gh: execGh,
      exec: execClaudeIn(repoDir),
      git: (args) => execGit(["-C", repoDir, ...args]),
      runTests: () => runVitestJsonForFixer(targets, repoDir),
      initialFailure,
      prNumber: Number(prArg),
      branch,
      issueNumber: Number(issueArg),
      assignee: readAssignee(),
    });

    if (outcome.verdict === "green") {
      console.log(`green after ${outcome.attempts} attempt(s)`);
    } else {
      console.log(`blocked after ${outcome.attempts} attempt(s): ${outcome.stopReason}`);
    }
  } catch (err) {
    console.error(`fixer failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "escalate") {
    await runEscalate();
  } else {
    await runFix();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
