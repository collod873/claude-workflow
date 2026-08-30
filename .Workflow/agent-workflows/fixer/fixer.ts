import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { childEnv } from "../shared/child-env";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { escalateToOwner } from "../shared/needs-human";
import { reason } from "../shared/reason";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";

/**
 * The fixer: what runs against a red completed verification run on an
 * implementer's pull request (ADR-0054's "an implementation PR's checks
 * fire by repository_dispatch" — the same wire an implementer's own PR was
 * opened on, VERIFY_DISPATCH_EVENT_TYPE, `implement.ts`).
 *
 * One call to `runFixer` is the whole attempt loop: up to
 * `MAX_ATTEMPTS` rounds of stage → write → commit → push → re-test, each
 * round comparing what is still red against what the *previous* round left
 * red. Two consecutive rounds reporting the identical
 * `{testName, errorMessage}` set is a fixer talking to itself — nothing
 * changed, so nothing further will — and stops there rather than spending a
 * third attempt on it. The hard cap exists independently of that
 * comparison: three rounds of *different* red is still three rounds spent
 * without landing green, and the point of a cap is that it never depends on
 * anything the loop itself decided.
 *
 * Stopping either way applies the same two writes: `needs-human` on the
 * *ticket*, and a comment on the PR naming what was tried — never nothing,
 * and never a label with no comment beside it, because a `needs-human`
 * ticket with no account of what was attempted sends the owner in blind.
 * Going green drops out of the loop with neither write: a green run needs no
 * record, the verification job it just landed a passing run for already is
 * one.
 *
 * A run whose `Verify` went red before `Restore and run acceptance` ever
 * executed (the immutable set was crossed, or the plain `verify` job itself
 * failed) reaches `runEscalate` instead of `runFixer`: there is no test
 * signature under `.Workflow` to build a brief from, so this applies
 * `needs-human` and comments what the failed job's log actually said rather
 * than spending three Sonnet attempts on a brief with nothing in it.
 */

/** No comparison and no cap outrun this. §3 of the ticket: "capped at three attempts". */
export const MAX_ATTEMPTS = 3;

export const FIXER_PROMPT_PATH = ".Workflow/agent-workflows/fixer/prompt.md";

/** Build/execution work, priced against the pipeline's Opus-tier judgement stages — same tier as the implementer. */
export const FIXER_MODEL = "claude-sonnet-5";

/** One still-red test, as the signature this lane compares attempt to attempt. */
export interface FixerFailure {
  testName: string;
  errorMessage: string;
}

/**
 * What one attempt left red, as a set. Order carries no meaning — two
 * attempts that failed the same tests with the same messages in a different
 * order are the same signature, not a sign of progress.
 */
export type FailureSignature = FixerFailure[];

/** What re-running the suite after an attempt reports. Empty `failures` is green. */
export interface FixerTestResult {
  failures: FixerFailure[];
}

/**
 * A stable key for one signature: sorted by `testName` then `errorMessage`
 * so the comparison in `signaturesEqual` cannot be fooled by two runs that
 * collected the same failures in a different order — vitest makes no
 * ordering guarantee across runs, and this lane's whole "no progress" call
 * rests on this comparison meaning what it says.
 */
function signatureKey(signature: FailureSignature): string {
  const sorted = [...signature].sort(
    (a, b) => a.testName.localeCompare(b.testName) || a.errorMessage.localeCompare(b.errorMessage),
  );
  return JSON.stringify(sorted);
}

/** Whether two attempts left the identical set of tests red with the identical messages. */
export function signaturesEqual(a: FailureSignature, b: FailureSignature): boolean {
  return signatureKey(a) === signatureKey(b);
}

/** One file the fix stage wrote, applied verbatim the same way `implement.ts`'s answer is. */
const FixerAnswer = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).min(1),
  /** A short account of what this attempt changed and why — becomes part of the blocked comment if the fixer stops. */
  summary: z.string().min(1),
});
type FixerAnswer = z.infer<typeof FixerAnswer>;

/** The fix stage's structured-output contract (`shared/structured-output.ts`). */
export const FIXER_OUTPUT = structuredOutput(FixerAnswer);

/**
 * The brief one attempt is handed: which attempt this is, what is currently
 * red and why (`{testName, errorMessage}`, the same signature the loop
 * compares), and what every prior attempt already tried — so an attempt
 * never repeats a fix a previous one already tried and failed.
 */
export function assembleFixBrief(signature: FailureSignature, attempt: number, priorSummaries: string[]): string {
  const failing =
    signature.length > 0
      ? signature.map((failure) => `### ${failure.testName}\n\n${failure.errorMessage}`).join("\n\n")
      : "(none)";
  const tried =
    priorSummaries.length > 0
      ? priorSummaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n")
      : "(none — this is the first attempt)";

  return [
    `## Attempt ${attempt} of ${MAX_ATTEMPTS}`,
    "## Currently failing",
    failing,
    "## What prior attempts already tried",
    tried,
  ].join("\n\n");
}

/** Runs the fix stage against an already-assembled brief and returns its answer, unwritten. */
export function runFixerStage(exec: StageExec, brief: string): Promise<FixerAnswer> {
  return runStage(FIXER_PROMPT_PATH, { BRIEF: brief }, exec, FIXER_OUTPUT, {
    model: FIXER_MODEL,
    promptViaStdin: true,
  });
}

/** Commits one attempt's files onto the PR's existing branch and pushes — never a fresh branch, never a new PR. */
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
  git(["push", "origin", `HEAD:${branch}`]);
}

/** The comment posted when the fixer stops, naming why and what every attempt tried. */
export function blockedComment(stopReason: "no-progress" | "capped", attemptSummaries: string[]): string {
  const why =
    stopReason === "no-progress"
      ? "Two consecutive attempts left the identical tests failing with the identical errors — nothing further will change that."
      : `${MAX_ATTEMPTS} attempts is this lane's cap, reached without landing a green run.`;

  const tried = attemptSummaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n");

  return `**Blocked.** ${why}\n\nWhat was tried:\n\n${tried}`;
}

/**
 * The comment posted when Verify never reached the acceptance job at all — the immutable set was
 * crossed, or the plain `verify` job (lint/typecheck/test/gauntlet) went red — so there is no
 * reproducible test signature for a model to work from.
 */
export function unfixableComment(failedJob: string, errorLine: string): string {
  return `**Needs a human.** \`${failedJob}\` failed before \`Restore and run acceptance\` ever ran, so there is nothing this lane can reproduce and fix.\n\n${errorLine}`;
}

/** Applies `needs-human` to the ticket and comments the PR with what every attempt tried — the one write a stopped fixer always makes. */
function applyBlocked(
  gh: GhExec,
  issueNumber: number,
  prNumber: number,
  assignee: string,
  stopReason: "no-progress" | "capped",
  attemptSummaries: string[],
): void {
  escalateToOwner(gh, issueNumber, assignee);
  gh(["pr", "comment", String(prNumber), "--body", blockedComment(stopReason, attemptSummaries)]);
}

/** Applies `needs-human` to the ticket and comments the PR naming the job Verify actually failed in — the escalate path's one write. */
export function applyUnfixable(gh: GhExec, issueNumber: number, prNumber: number, assignee: string, failedJob: string, errorLine: string): void {
  escalateToOwner(gh, issueNumber, assignee);
  gh(["pr", "comment", String(prNumber), "--body", unfixableComment(failedJob, errorLine)]);
}

export interface FixerDeps {
  gh: GhExec;
  exec: StageExec;
  git: GitExec;
  /** Re-runs the suite after an attempt's fix is pushed and classifies what is still red. */
  runTests: () => FixerTestResult | Promise<FixerTestResult>;
  writeFile: (path: string, content: string) => void;
  /** The signature that made the verification run red in the first place — attempt 1's brief. */
  initialFailure: FailureSignature;
  /** The pull request this fixer is working against. */
  prNumber: number;
  /** The branch that PR is open from — every attempt lands here, never a new branch. */
  branch: string;
  /** The ticket the PR implements, for the `Part of #<n>` trailer on each attempt's commit and for `needs-human` on a stop. */
  issueNumber: number;
  /** Who a stopped fixer assigns the ticket to — the repository owner, read from `SIGNAL_ASSIGNEE`. */
  assignee: string;
}

export type FixerOutcome =
  | { verdict: "green"; attempts: number }
  | { verdict: "blocked"; attempts: number; stopReason: "no-progress" | "capped" };

/**
 * The whole fixer loop: up to `MAX_ATTEMPTS` rounds of stage → write →
 * commit → push → re-test, stopping the moment two consecutive rounds
 * report the identical signature or the cap is reached — whichever comes
 * first — and applying `blocked` plus a comment on either stop. Returns
 * without writing anything when an attempt lands green.
 */
export async function runFixer(deps: FixerDeps): Promise<FixerOutcome> {
  let previousSignature = deps.initialFailure;
  const attemptSummaries: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const brief = assembleFixBrief(previousSignature, attempt, attemptSummaries);
    const answer = await runFixerStage(deps.exec, brief);

    for (const file of answer.files) {
      deps.writeFile(file.path, file.content);
    }
    commitAndPushAttempt(
      deps.git,
      deps.branch,
      answer.files.map((file) => file.path),
      attempt,
      answer.summary,
      deps.issueNumber,
    );
    attemptSummaries.push(answer.summary);

    const result = await deps.runTests();

    if (result.failures.length === 0) {
      return { verdict: "green", attempts: attempt };
    }

    if (attempt >= 2 && signaturesEqual(result.failures, previousSignature)) {
      applyBlocked(deps.gh, deps.issueNumber, deps.prNumber, deps.assignee, "no-progress", attemptSummaries);
      return { verdict: "blocked", attempts: attempt, stopReason: "no-progress" };
    }

    if (attempt === MAX_ATTEMPTS) {
      applyBlocked(deps.gh, deps.issueNumber, deps.prNumber, deps.assignee, "capped", attemptSummaries);
      return { verdict: "blocked", attempts: attempt, stopReason: "capped" };
    }

    previousSignature = result.failures;
  }

  // Unreachable: the loop above always returns by attempt === MAX_ATTEMPTS.
  throw new Error("runFixer: exited its loop without a verdict");
}

/** The error name a failure message opens with, mirroring `acceptance/push-gate.ts`'s `errorNameOf` shape. */
interface VitestJsonAssertion {
  fullName?: string;
  title?: string;
  status: string;
  failureMessages?: string[];
}

interface VitestJsonTestResult {
  name: string;
  status: string;
  message?: string;
  assertionResults: VitestJsonAssertion[];
}

interface VitestJsonReport {
  testResults: VitestJsonTestResult[];
}

/**
 * The real `runTests`: shells `npx vitest run <dir> --reporter=json` and
 * reads back every failed assertion's full message — not just the error's
 * class name, the way `push-gate.ts`'s classifier does, because two
 * attempts that both threw `AssertionError` are only the *same* failure
 * when the message matches too. A collection failure (a syntax error, a
 * broken import) is reported as a single synthetic failure naming the file,
 * so a fixer attempt that cannot even be collected still gets a signature
 * to compare against rather than being read as silently green.
 */
export function runVitestJsonForFixer(dir: string): FixerTestResult {
  let stdout: string;
  try {
    stdout = execFileSync("npx", ["vitest", "run", dir, "--reporter=json"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv(),
    });
  } catch (err) {
    const output = (err as { stdout?: string }).stdout;
    if (typeof output !== "string" || output.trim() === "") {
      return { failures: [{ testName: dir, errorMessage: reason(err) }] };
    }
    stdout = output;
  }

  let report: VitestJsonReport;
  try {
    report = JSON.parse(stdout) as VitestJsonReport;
  } catch (err) {
    return { failures: [{ testName: dir, errorMessage: `unparseable vitest JSON: ${reason(err)}` }] };
  }

  const failures: FixerFailure[] = [];
  for (const file of report.testResults) {
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

/** `SIGNAL_ASSIGNEE`, the same env var `run-watchdog.yml` sets from `github.repository_owner` — read here rather than three times, one per caller. */
function readAssignee(): string {
  const assignee = process.env.SIGNAL_ASSIGNEE;
  if (!assignee) throw new Error("SIGNAL_ASSIGNEE must be set — an unassigned ticket notifies nobody");
  return assignee;
}

/**
 * The escalate path: `fixer.yml`'s resolve step reaches this when the failed job was not
 * `Restore and run acceptance` — the immutable set was crossed, or the plain `verify` job
 * (lint/typecheck/test/gauntlet) went red. Neither leaves a test signature under `.Workflow` for
 * the model loop to work from, so this applies `needs-human` and comments what actually failed
 * instead of handing three Sonnet attempts a brief with nothing to fix.
 */
async function runEscalate(): Promise<void> {
  const [issueArg, prArg, failedJob, errorLine] = process.argv.slice(3);
  if (!issueArg || !prArg || !failedJob || !errorLine) {
    console.error("usage: fixer.ts escalate <issue-number> <pr-number> <failed-job-name> <error-line>");
    process.exitCode = 1;
    return;
  }

  try {
    applyUnfixable(execGh, Number(issueArg), Number(prArg), readAssignee(), failedJob, errorLine);
    console.log(`escalated #${issueArg}: ${failedJob} failed before acceptance ran`);
  } catch (err) {
    console.error(`fixer failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

async function runFix(): Promise<void> {
  const [issueArg, prArg, branch, dir] = process.argv.slice(2);
  if (!issueArg || !prArg || !branch || !dir) {
    console.error("usage: fixer.ts <issue-number> <pr-number> <branch> <acceptance-tests-dir>");
    process.exitCode = 1;
    return;
  }

  try {
    // Read the suite once before the loop, and stop here when it is green.
    //
    // Not every red `Verify` run is one this lane can see: lint, typecheck, the clone gate and
    // lane 06's acceptance-restore job all fail a run without failing a test under `dir`. Handed
    // an empty signature, `assembleFixBrief` writes "Currently failing: (none)" and three Sonnet
    // attempts go to a model with nothing to fix — which then edits something, pushes it, and
    // ends by labelling a pull request `blocked` over a failure it was never shown. Declining is
    // the honest answer: this lane fixes what it can reproduce, and the run log says which.
    const initialFailure = runVitestJsonForFixer(dir).failures;
    if (initialFailure.length === 0) {
      console.log(`nothing to fix: no test under ${dir} is failing in this checkout`);
      return;
    }

    const outcome = await runFixer({
      gh: execGh,
      exec: execClaude,
      git: execGit,
      runTests: () => runVitestJsonForFixer(dir),
      writeFile: (path, content) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
      },
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

/** `escalate` as the first argument selects the no-model path; anything else is the attempt loop. */
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
