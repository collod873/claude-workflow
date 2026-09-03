import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { dispatchVerify } from "../shared/verify-dispatch";
import { childEnv } from "../shared/child-env";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { escalateToOwner } from "../shared/needs-human";
import { reason } from "../shared/reason";
import { fileSpecGap } from "../shared/spec-gap";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { extractCriteria, parentPrdNumber, readTicket } from "../shared/ticket-shape";

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
 * The two stops route differently on top of those writes (ADR-0119): a
 * `capped` stop is ordinary difficulty and reaches the owner alone, while a
 * `no-progress` stop — a test whose demand did not move under two
 * independent attempts — is also filed as `spec/gap` at the parent PRD,
 * because a test no diff can satisfy is a defect in the contract rather than
 * in the diff. See `applyBlocked`.
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

/**
 * What one attempt answers with: an account of itself, and nothing else.
 *
 * **It used to carry the files too** — `{path, content}` for every file the fix touched, complete
 * content, never a diff — and that is what killed two consecutive runs on PR #280 (#283). The stage
 * edits the checkout in-session and runs the suite against those edits; the `files` array was the
 * model then *retyping* everything it had already written, so that the lane could write it back to
 * the same paths. On #274 — a ten-file migration adding one line to each — that was 12 files and
 * ~231 KB of verbatim TypeScript in a single JSON response, at the model's per-response output
 * ceiling and twenty-odd minutes of generation. Both runs died there with the fix already on disk
 * and green, and both looked like a hang because `stream-json` prints one event per *completed*
 * message and that message never completed.
 *
 * The cost scaled with the number of files touched and not at all with the size of the edits, which
 * makes "one line in ten files" the worst case and also an ordinary one. So the transport is gone:
 * the working tree is the answer, and `changedPaths` reads it off git
 * ([ADR-0121](../../../docs/adr/0121-the-fixer-s-fix-is-the-working-tree-it-edited-not-a-file-lis.md)).
 * What is left here is the one thing only the model can say.
 */
const FixerAnswer = z.object({
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
    stage: "fixer",
  });
}

/**
 * Every path the stage's edits left changed in the checkout — the fix itself, read off git rather
 * than dictated back by the model (see `FixerAnswer`).
 *
 * `--porcelain` because it is the one `git status` format promised to be stable across versions and
 * unaffected by the user's config, which is the whole reason it exists. `-uall` lists new files
 * individually instead of collapsing them into a directory entry, so a fix that adds two files
 * under one new directory commits as two paths rather than as a directory `git add` would then have
 * to re-expand. Ignored files stay out by default, which is what keeps `node_modules/`,
 * `.Workflow/agent-workflows/checkpoints/` and the rest of `.gitignore` from ever reaching a
 * commit — the stage runs a vitest suite in this checkout and those are its leavings.
 *
 * A rename is reported as `old -> new`, and only `new` is a path to add; `old`'s deletion is
 * already staged by the rename detection that produced the line. Paths containing a space are
 * unquoted and reach the end of the line intact, so the field split is on the *first* space after
 * the two status columns and nothing else.
 */
export function changedPaths(git: GitExec): string[] {
  return git(["status", "--porcelain", "-uall"])
    .split("\n")
    .filter((line) => line.trim() !== "")
    // Two status columns, one space, then the path — `slice(3)` rather than a split on whitespace,
    // which would truncate every path with a space in it.
    .map((line) => line.slice(3))
    .map((path) => {
      const arrow = path.indexOf(" -> ");
      return arrow === -1 ? path : path.slice(arrow + 4);
    })
    // Git quotes a path with characters outside the printable ASCII range (`core.quotePath`), and a
    // quoted path handed back to `git add` verbatim is not the path it names. Nothing in this repo
    // has one, so rather than reimplement git's own C-style unquoting, the quotes are stripped —
    // the one shape `git add` still resolves correctly for the paths that actually occur.
    .map((path) => (path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path));
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
  // `--force-with-lease`, because `fixer.yml` rebases the branch onto trunk before this lane runs
  // (so that the fixer executing is trunk's, not whichever one the implementer branched from), and
  // a rebased branch is a rewritten history a plain push refuses. Lane 08 force-pushes the same
  // rebase when it merges, so an implement branch's history is already understood to be rewritten
  // by lanes; the lease keeps it from clobbering a push nobody here has seen.
  git(["push", "--force-with-lease", "origin", `HEAD:${branch}`]);
}

/** The comment posted when the fixer stops, naming why and what every attempt tried. */
export function blockedComment(stopReason: "no-progress" | "capped", attemptSummaries: string[], gapIssue?: number): string {
  const why =
    stopReason === "no-progress"
      ? "Two consecutive attempts left the identical tests failing with the identical errors — nothing further will change that."
      : `${MAX_ATTEMPTS} attempts is this lane's cap, reached without landing a green run.`;

  const tried = attemptSummaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n");
  const routed =
    gapIssue === undefined
      ? ""
      : `\n\nFiled as \`spec/gap\` #${gapIssue}: an immovable test is a defect in the contract, not in this diff (ADR-0119).`;

  return `**Blocked.** ${why}\n\nWhat was tried:\n\n${tried}${routed}`;
}

/**
 * The `spec/gap` a no-progress stop files: the immovable signature, verbatim, and what every
 * attempt tried against it.
 *
 * The signature is the evidence and the reason it is worth a lane 02 run — two independent Sonnet
 * attempts, each given what the last one tried, moved this failure by exactly nothing. What the
 * spec author has to decide is which reading of the criterion the test encodes, which is the
 * question the report puts in front of it.
 */
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
    "diff — it is asking for something the ticket did not decide, and ADR-0034 rules that the spec,",
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

/**
 * The comment posted when Verify never reached the acceptance job at all — the immutable set was
 * crossed, or the plain `verify` job (lint/typecheck/test/gauntlet) went red — so there is no
 * reproducible test signature for a model to work from.
 */
export function unfixableComment(failedJob: string, errorLine: string): string {
  return `**Needs a human.** \`${failedJob}\` failed before \`Restore and run acceptance\` ever ran, so there is nothing this lane can reproduce and fix.\n\n${errorLine}`;
}

/**
 * The two writes a stopped fixer makes, and the one decision between them: **where** the stop is
 * routed — [ADR-0119](../../../docs/adr/0119-a-fixer-that-stops-making-no-progress-files-spec-gap-rather.md).
 *
 * A `capped` stop is ordinary difficulty: three attempts, each of them moving the failure, and no
 * green. Nobody but the owner can size that, so it goes to `needs-human` as it always has.
 *
 * A `no-progress` stop is a different event wearing the same clothes. Two independent attempts, the
 * second told what the first tried, left the identical tests failing with the identical messages —
 * the test's demand did not move, so no diff is going to move it. That is the disagreement #278
 * says the pipeline cannot express: lane 04 encoded one reading of the ticket and lane 05 built
 * another, neither could ask the other, and lane 06 shows it as *the implementation does not
 * satisfy the test* whichever side is wrong. It is filed as `spec/gap` at the parent PRD, where
 * ADR-0034's route already runs — the spec author clarifies the criterion, ADR-0033 re-fires
 * acceptance for the slices whose tests name it, and the PR is judged against the corrected
 * reading.
 *
 * **The ticket still gets `needs-human` either way.** A `spec/gap` that reaches lane 02 is a repair
 * in flight, not a delivery, and ADR-0079 lets the spec author refuse one it cannot fix with a
 * clarification. Dropping the label on the strength of a repair that may refuse would leave a
 * stalled ticket in nobody's list, which is the failure `shared/needs-human.ts` was written after.
 *
 * A ticket with no `## Parent PRD` — a hand-written one entering at lane 06 (#184) — has no spec to
 * amend, so the route does not exist for it and the stop is the owner's, unrouted.
 */
function applyBlocked(
  gh: GhExec,
  issueNumber: number,
  prNumber: number,
  assignee: string,
  stopReason: "no-progress" | "capped",
  attemptSummaries: string[],
  immovable?: FailureSignature,
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

  gh(["pr", "comment", String(prNumber), "--body", blockedComment(stopReason, attemptSummaries, gapIssue)]);
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

/**
 * A green attempt is a new head on the pull request, and a head lane 06 has not judged is one lane
 * 08 will never merge: the fixer's first real green (PR #280, 2026-08-30) pushed its fix and then
 * nothing happened, because the only `implementation-opened` this pipeline sends is the one lane 05
 * sends when it opens the PR. This sends the same one, with the same three fields, so a fixed PR
 * takes the same road a fresh one does — Verify, Review, Integrate — and the fixer's "green" is
 * the suite's word rather than only its own.
 *
 * `changed_files` is every path the PR touches against trunk, not only what the attempts wrote:
 * the Immutability job judges the whole diff, and a list that named only the fix would let an
 * implementer's own immutable-set touch through on the fixer's ticket.
 */
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
  | { verdict: "blocked"; attempts: number; stopReason: "no-progress" | "capped" };

/**
 * The whole fixer loop: up to `MAX_ATTEMPTS` rounds of stage → write →
 * commit → push → re-test, stopping the moment two consecutive rounds
 * report the identical signature or the cap is reached — whichever comes
 * first — and applying `blocked` plus a comment on either stop. Returns
 * without writing anything when an attempt lands green.
 */
/**
 * How many attempts earlier fixer runs already committed onto this branch, read off the commits
 * themselves (`fix: attempt N at #n`, the subject `commitAndPushAttempt` writes) — durable, free,
 * and the only place the count survives a run ending.
 *
 * Needed because a green attempt now goes back to Verify (`rejudge`), and a Verify that comes back
 * red starts a *new* fixer run with a fresh loop. Three per run is then no ceiling at all: the
 * loop would be fix → judge → fix, each round a model spend, until something else broke it.
 * ADR-0041's three is per ticket, so the loop counts what is already on the branch and takes only
 * the remainder.
 */
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

    // The stage edited this checkout; what it changed is the attempt. An attempt that changed
    // nothing is committed as nothing rather than as an empty commit — `git commit` refuses one
    // anyway, and a `fix: attempt N` commit with no diff would inflate `priorAttempts`' count
    // against the ticket's ceiling for a round that did not spend it on a fix. The summary is still
    // recorded, so it reaches the blocked comment and says why; the loop carries on and the
    // no-progress comparison stops it a round later, when the identical red comes back twice.
    const paths = changedPaths(deps.git);
    if (paths.length > 0) {
      commitAndPushAttempt(deps.git, deps.branch, paths, attempt, answer.summary, deps.issueNumber);
    }
    attemptSummaries.push(answer.summary);

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

  // Unreachable: the loop above always returns by attempt === MAX_ATTEMPTS - already.
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
 *
 * `repoDir` is the tree the suite runs in — the target checkout under the
 * reusable workflow (ADR-0055), where the branch being fixed actually is,
 * and cwd anywhere else.
 */
export function runVitestJsonForFixer(targets: string[], repoDir: string = process.cwd()): FixerTestResult {
  const dir = targets.join(" ");
  let stdout: string;
  try {
    stdout = execFileSync("npx", ["vitest", "run", ...targets, "--reporter=json"], {
      cwd: repoDir,
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
    // `dir` plus this ticket's own acceptance tests, `tests/acceptance/<n>-*.test.ts` — a vitest
    // positional is a substring filter over `include`, and that directory is in it. Without the
    // second target this lane judged itself by a suite Verify does not judge by: run 33326974110
    // read the `.Workflow` suite green while #274's acceptance test was the red that had summoned
    // it, said "nothing to fix", and left PR #280 exactly as it found it. What is red here is
    // what Verify refused, so the brief names the failure that actually matters and the loop's
    // "green" means the same thing lane 06's does.
    const targets = [dir, `tests/acceptance/${issueArg}-`];

    // Which checkout holds the branch being fixed. `TARGET_WORKSPACE` is set only by the reusable
    // workflow (ADR-0055): there this process runs from the machine checkout, and the suite, the
    // tree the model edits and the branch every attempt is committed onto are all the target's.
    // The model's own working directory is bound to it too — this lane's whole job is editing
    // code, so a model sitting in the machine checkout would repair the pipeline instead of the
    // pull request it was summoned for.
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
