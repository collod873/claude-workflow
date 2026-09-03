import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { branchCreationPath, comparePath, GIT_REFS_PATH } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "../shared/immutable-set";
import { escalateToOwner } from "../shared/needs-human";
import { implementationBranch, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { reason } from "../shared/reason";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import {
  extractCriteria,
  extractFilesClaimed,
  normalizeNewlines,
  parentPrdNumber,
  readTicket,
  sectionText,
  type TicketRead,
} from "../shared/ticket-shape";
import { runVitestJson, type TestRunResult } from "../acceptance/push-gate";
import { recordOutOfBrief } from "./out-of-brief";
import { execGenerator, regenerateArtifacts, type GeneratorExec } from "./regenerate-artifacts";

/**
 * Lane: build one ticket from exactly the brief this file assembles — the
 * ticket body, the seam manifest lines it consumes, its target module's
 * `CONTEXT.md`, and its own failing acceptance test file(s) — never a
 * broader repository read (PRD #145 move 6, #167).
 *
 * A Sonnet stage (build/execution work, not the judgement-under-uncertainty
 * every Opus stage in this pipeline is priced for) writes the files the
 * ticket needs, deterministically applied here — the same
 * author-writes/wrapper-applies split `acceptance/acceptance.ts` uses, kept
 * for the same reason: a model's own `gh`/`git` calls are not something a
 * headless run can be trusted to get right unsupervised, so this wrapper
 * owns every write to disk and every write to GitHub, and the stage's only
 * output is structured content.
 */

/** Build/execution work, priced against the pipeline's Opus-tier judgement stages — see the header. */
export const IMPLEMENTER_MODEL = "claude-sonnet-5";

export const IMPLEMENTER_PROMPT_PATH = ".Workflow/agent-workflows/implement/implementer/prompt.md";

/**
 * The `repository_dispatch` action `implement.yml`'s job gates on — the one authority
 * `implement.yml`'s `if:` and `implement-workflow.test.ts` both check against, since no compiler
 * sees across the JS↔YAML boundary (the same pattern `SPEC_DISPATCH_EVENT_TYPE` and
 * `AUDIT_DISPATCH_ACTION` follow).
 *
 * Re-exported from `shared/ready-set.ts` rather than declared here, for the reason
 * `VERIFY_DISPATCH_EVENT_TYPE` below is: it has **two senders** now, not one — the publish step
 * (`to-tickets/slice-and-publish.ts`) and the reconciler (`dispatch/reconcile.ts`) — and `shared/`
 * is the only place both can reach without a lane importing a lane. Declaring a wire name twice is
 * what left both of `verify.yml`'s jobs unreachable until #145's seam audit.
 */
export const IMPLEMENT_DISPATCH_EVENT_TYPE = TICKET_READY_DISPATCH_ACTION;

/**
 * The `repository_dispatch` action this lane sends on success, naming the PR
 * it just opened — the implementer's own verification dispatch (ADR-0054:
 * "an implementation PR's checks fire by repository_dispatch").
 *
 * Re-exported from `shared/immutable-set.ts` rather than declared here,
 * because the three jobs that receive it — `verify.yml`'s Immutability and
 * Restore-and-run-acceptance, and `integrate.yml` — must read the same
 * string this sends, and `shared/` is the only place all four can reach
 * without a lane importing a lane. Declaring it twice is what left both of
 * `verify.yml`'s jobs unreachable until #145's seam audit.
 */
export const VERIFY_DISPATCH_EVENT_TYPE = IMPLEMENTATION_PR_DISPATCH_ACTION;

/** `render-body.ts`'s `## Seams consumed` heading — present only when the slice consumed any. */
const SEAMS_HEADING_RE = /^##[ \t]+Seams consumed[ \t]*$/m;

/**
 * The seam manifest lines a ticket's `## Seams consumed` section names, one
 * per line, in the body's own order. Empty when the section is absent — a
 * slice that consumed no seam is not an error (`render-body.ts` omits the
 * heading entirely in that case).
 */
export function extractSeamsConsumed(body: string): string[] {
  const section = sectionText(normalizeNewlines(body), SEAMS_HEADING_RE);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The nearest `CONTEXT.md` above the first claimed file, walking up one
 * directory at a time and falling back to the repo root's own `CONTEXT.md`
 * when no closer one exists (today, every module in this repo shares the
 * root file — see `CONTEXT.md`'s own header — but a lane-owned one, the
 * shape `to-tickets.ts`'s `VOCABULARY_PATH` comment anticipates, is found
 * the same way without this function changing).
 */
export function moduleContextPath(filesClaimed: string[], fileExists: (path: string) => boolean): string {
  const ROOT_CONTEXT = "CONTEXT.md";
  if (filesClaimed.length === 0) return ROOT_CONTEXT;

  let dir = dirname(filesClaimed[0]);
  while (dir !== "." && dir !== "/") {
    const candidate = join(dir, "CONTEXT.md");
    if (fileExists(candidate)) return candidate;
    dir = dirname(dir);
  }
  return ROOT_CONTEXT;
}

/** One failing acceptance test file the brief inlines — its repo-relative path and its full content. */
export interface FailingTestFile {
  path: string;
  content: string;
}

/** Everything `assembleBrief` is built from — exactly the four ingredients #167 names, nothing else. */
export interface BriefInputs {
  ticketBody: string;
  seamManifestLines: string[];
  moduleContext: string;
  failingTests: FailingTestFile[];
}

/**
 * Assembles the implementer's whole prompt input from exactly four
 * ingredients: the ticket body, the seam manifest lines it consumes, the
 * target module's `CONTEXT.md`, and its failing acceptance test file(s).
 * Deterministic — the same inputs always render the same string — which is
 * what lets `implement.test.ts` assert the result contains only these four
 * and nothing else by building the same template independently rather than
 * trusting this function's own account of itself.
 */
export function assembleBrief(inputs: BriefInputs): string {
  const seams = inputs.seamManifestLines.length > 0 ? inputs.seamManifestLines.join("\n") : "(none)";
  const tests =
    inputs.failingTests.length > 0
      ? inputs.failingTests.map((file) => `### ${file.path}\n\n${file.content}`).join("\n\n")
      : "(none)";

  return [
    "## Ticket",
    inputs.ticketBody,
    "## Seam manifest lines consumed",
    seams,
    "## Module CONTEXT.md",
    inputs.moduleContext,
    "## Failing acceptance test(s)",
    tests,
  ].join("\n\n");
}

/**
 * Exported for `recover/recover.ts`: a recovered run parses the artifact `implement.yml` uploaded
 * with this exact shape rather than trusting untyped JSON — the same contract the model's own
 * reply is held to here.
 */
export const ImplementerAnswer = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).min(1),
  /** A short account of what was built — becomes the PR body's lead paragraph. */
  summary: z.string().min(1),
  /**
   * Every module this implementer read outside its brief — ADR-0042: it
   * reads what it needs and carries on, never blocking, and names each
   * module here rather than filing a `seam/question`. One entry per read,
   * in read order; the same module named twice is two reads, not one — each
   * becomes its own call to `recordOutOfBrief`, so a module read twice is
   * counted twice on the tracker.
   */
  outOfBriefReads: z.array(z.string().min(1)).default([]),
});
export type ImplementerAnswer = z.infer<typeof ImplementerAnswer>;

/** The implementer stage's structured-output contract (`shared/structured-output.ts`). */
export const IMPLEMENTER_OUTPUT = structuredOutput(ImplementerAnswer);

/** Runs the implementer stage against an already-assembled brief and returns its answer, unwritten. */
export function runImplementer(exec: StageExec, brief: string): Promise<ImplementerAnswer> {
  return runStage(IMPLEMENTER_PROMPT_PATH, { BRIEF: brief }, exec, IMPLEMENTER_OUTPUT, {
    model: IMPLEMENTER_MODEL,
    promptViaStdin: true,
    stage: "implementer",
  });
}

/**
 * Where a run drops the implementer's answer, verbatim, the moment it has one. `implement.yml`
 * points this at the runner's temp directory and uploads the file with `if: always()`; unset — a
 * workstation run — means don't bother.
 */
export const ANSWER_PATH_ENV = "IMPLEMENT_ANSWER_PATH";

/**
 * Writes the implementer's answer down **before anything is decided about it**.
 *
 * A lane 05 answer exists in exactly one place — the model's reply — and run 33275876786 is what
 * that costs when a later step throws it away: 23 minutes and $6.36 of correct work gone, with no
 * artifact, no commit, and a runner log that renders the call as a bare `StructuredOutput()` with
 * its payload elided. Nothing on GitHub held a copy (ADR-0103). This is the copy.
 *
 * **Never throws.** A receipt is for the humans reading the run afterwards; a run that cannot write
 * one still has a ticket to build.
 */
function keepAnswer(
  writeFile: (path: string, content: string) => void,
  env: Record<string, string | undefined>,
  answer: ImplementerAnswer,
  log: (line: string) => void,
): void {
  const path = env[ANSWER_PATH_ENV];
  if (!path) return;
  try {
    writeFile(path, JSON.stringify(answer, null, 2));
    log(`kept the implementer's answer at ${path}`);
  } catch (err) {
    log(`could not keep the implementer's answer at ${path}: ${reason(err)}`);
  }
}

function fsWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export { implementationBranch };

/**
 * How long a claim may sit unexplained before another run may take it — `implement.yml`'s own
 * `timeout-minutes` for the `implement` job, which `implement.test.ts` pins against the workflow
 * file so the two cannot drift.
 *
 * The number is load-bearing in one direction only: a run cannot outlive its own timeout, so a
 * claim older than this is held by **no run at all**. Reading it any tighter would let a live run's
 * claim be stolen out from under it; reading it looser only delays a retry.
 *
 * Raised from 30 after run 33278318023 was killed at 30:15 building #237. Its implementer stage
 * alone took ~28 minutes and the answer was already in hand; what the cap actually cut off was the
 * commit and the pull request. The previous run of the same ticket finished in 23:20, so 30 was
 * not a limit the lane was comfortably inside — it was a coin flip nobody had watched land.
 */
export const CLAIM_TIMEOUT_MINUTES = 45;

/** The REST resource for one branch's ref, derived from `GIT_REFS_PATH` rather than restated. */
function refPath(branch: string): string {
  return `${GIT_REFS_PATH}/heads/${branch}`;
}

/**
 * Creates the claim ref at `sha`, atomically. `POST git/refs` **fails when the ref exists**
 * (HTTP 422) where a push may fast-forward, and a fast-forward is not a claim.
 */
function createClaimRef(gh: GhExec, branch: string, sha: string, log: (line: string) => void): boolean {
  try {
    gh(["api", GIT_REFS_PATH, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
    return true;
  } catch (err) {
    log(`\`${branch}\` was not claimed here: ${reason(err)}`);
    return false;
  }
}

/**
 * Deletes the claim ref, so the next dispatch for this ticket finds the slice unstarted and is free
 * to build it (#196). **Never throws**: a release that fails must not turn one failure into two,
 * and the run's own outcome is what the caller is reporting.
 */
/**
 * Releases a claim on `branch` that a **known-dead** run left behind, when nothing on GitHub is
 * attached to it — no commits ahead of trunk, no pull request. Returns whether it let go.
 *
 * Deliberately not `assessClaim`'s test. That one is asked by a *rival* run, which cannot tell a
 * healthy young claim from debris and so waits out `CLAIM_TIMEOUT_MINUTES` rather than trample one.
 * `recover.ts` is not a rival: it only runs because the claimant died, so the age term is the one
 * piece of evidence it does not need and the one that was blocking it. Without this, cancelling or
 * timing out a run left its claim standing, the re-dispatch Recover sent bounced straight off it
 * (`#342 is already claimed — nothing to do`, run 33698760072), and the ticket sat unbuildable for
 * 45 minutes — the stranding the `cancelled()` routing was supposed to end.
 */
export function releaseDeadClaim(gh: GhExec, branch: string, base: string, log: (line: string) => void): boolean {
  try {
    if (hasPullRequest(gh, branch)) {
      log(`\`${branch}\` has a pull request, so its claim is somebody's finished work — left alone.`);
      return false;
    }
    if (commitsAhead(gh, branch, base) > 0) {
      log(`\`${branch}\` carries commits, so its claim is somebody's unfinished work — left alone.`);
      return false;
    }
  } catch (err) {
    log(`could not inspect \`${branch}\`, so its claim is left alone: ${reason(err)}`);
    return false;
  }
  releaseClaim(gh, branch, log);
  return true;
}

function releaseClaim(gh: GhExec, branch: string, log: (line: string) => void): void {
  try {
    gh(["api", "--method", "DELETE", refPath(branch)]);
    log(`released the claim on \`${branch}\``);
  } catch (err) {
    log(`could not release the claim on \`${branch}\`: ${reason(err)}`);
  }
}

/** Whether any pull request — open, closed or merged — has ever named `branch` as its head. */
function hasPullRequest(gh: GhExec, branch: string): boolean {
  const raw = gh(["pr", "list", "--head", branch, "--state", "all", "--json", "number"]);
  return (JSON.parse(raw) as unknown[]).length > 0;
}

/**
 * How many commits `branch` carries that `base` does not. Anything but a number reads as **has
 * commits**, because every unknown here has to fall on the side that leaves the claim alone.
 */
function commitsAhead(gh: GhExec, branch: string, base: string): number {
  const raw = gh(["api", comparePath(base, branch)]);
  const ahead = (JSON.parse(raw) as { ahead_by?: unknown }).ahead_by;
  return typeof ahead === "number" ? ahead : 1;
}

/** How long ago `branch` was created, in minutes, or `undefined` when GitHub records no creation. */
function claimAgeMinutes(gh: GhExec, branch: string, now: Date): number | undefined {
  const raw = gh(["api", branchCreationPath(branch)]);
  const activity = (JSON.parse(raw) as Array<{ timestamp?: string }>)[0];
  if (!activity?.timestamp) return undefined;
  const created = Date.parse(activity.timestamp);
  if (Number.isNaN(created)) return undefined;
  return (now.getTime() - created) / 60_000;
}

/**
 * Whether the claim already on `branch` is held by a run that is still going, or is debris a dead
 * run left behind (#196).
 *
 * Debris is the conjunction the ticket names: **no pull request, no commits, and older than the
 * lane's own timeout**. Each term alone would be wrong — a branch with commits is somebody's
 * unfinished work, a branch with a PR is a finished run, and a young branch is a run still in its
 * first minutes — and together they describe a ref that nothing on GitHub is still attached to.
 *
 * **Every uncertainty answers `live`**, including an error reading any of the three. Refusing a
 * claim that was in fact debris costs one delayed retry; taking one that was in fact held costs two
 * implementers building the same ticket at once, which is the failure the claim exists to prevent.
 */
function assessClaim(
  gh: GhExec,
  branch: string,
  base: string,
  now: Date,
  log: (line: string) => void,
): "live" | "stale" {
  try {
    if (hasPullRequest(gh, branch)) return "live";
    if (commitsAhead(gh, branch, base) > 0) return "live";
    const age = claimAgeMinutes(gh, branch, now);
    if (age === undefined) {
      log(`\`${branch}\` has no recorded creation time, so its claim is read as still held.`);
      return "live";
    }
    return age > CLAIM_TIMEOUT_MINUTES ? "stale" : "live";
  } catch (err) {
    log(`could not tell whether \`${branch}\`'s claim is still held, so it is: ${reason(err)}`);
    return "live";
  }
}

/** What `claimImplementationBranch` answers: whether this run holds the slice, and how it got it. */
export interface ClaimOutcome {
  claimed: boolean;
  /** True only when this run took a claim a dead run left behind, rather than making a fresh one. */
  tookOverStaleClaim: boolean;
}

/**
 * Claims this slice, atomically, **before the model runs** (#179).
 *
 * Dispatch is at-least-once: the reconciler recomputes the ready set on every `graph-changed` and
 * every `session-captured` and is deliberately dumb about what it has already sent, because the
 * claim is what makes a duplicate free. That only holds if the claim happens *first*. It did not:
 * `commitAndPushBranch` pushes at the end, after the implementer stage has already run, so two
 * implementers would both do the whole job and only the push would collide — a wasted Sonnet run
 * and, worse, a second one that might win the race with different files.
 *
 * A refusal is no longer the end of it (#196). The ref's existence was read as *somebody is
 * building this*, which is true right up until the run holding it dies — after which every retry
 * read the same 422, logged "already claimed", and exited 0 having done nothing, so the ticket was
 * unbuildable until a human deleted the branch by hand. So a refusal now asks whether anything is
 * actually holding the ref (`assessClaim`), and takes it when nothing is.
 *
 * The takeover is a delete followed by the **same atomic create**, never an assumption that the
 * delete made room for this run in particular: two runs that both find the same debris still race
 * on `POST git/refs`, and still only one of them wins.
 */
export function claimImplementationBranch(
  gh: GhExec,
  git: GitExec,
  branch: string,
  log: (line: string) => void = (line) => console.log(line),
  now: Date = new Date(),
): ClaimOutcome {
  const sha = git(["rev-parse", "HEAD"]).trim();
  if (createClaimRef(gh, branch, sha, log)) return { claimed: true, tookOverStaleClaim: false };

  if (assessClaim(gh, branch, sha, now, log) === "live") return { claimed: false, tookOverStaleClaim: false };

  log(`\`${branch}\` is a claim no run is holding — taking it over.`);
  releaseClaim(gh, branch, log);
  if (!createClaimRef(gh, branch, sha, log)) return { claimed: false, tookOverStaleClaim: false };
  return { claimed: true, tookOverStaleClaim: true };
}

/** The remote and trunk name this lane's push rebases onto — the same `origin main` `fixer.yml`'s
 * own "Rebase onto trunk" step fetches, restated here because `implement.yml` is immutable and
 * carries no equivalent step of its own. */
const TRUNK_REMOTE = "origin";
const TRUNK_BRANCH = "main";

/**
 * Raised when the branch just committed conflicts rebasing onto trunk — the escalation
 * `commitAndPushBranch` throws instead of pushing. `paths` names every file the rebase could not
 * replay, read from `git diff --diff-filter=U` before the rebase is aborted.
 */
export class RebaseConflictError extends Error {
  constructor(public readonly paths: string[]) {
    super(`conflicted rebasing onto ${TRUNK_REMOTE}/${TRUNK_BRANCH}: ${paths.join(", ")}`);
    this.name = "RebaseConflictError";
  }
}

/**
 * Fetches trunk and rebases the checked-out branch onto it, right before the push — the window
 * Class 3 of the research note calls "exposed, worst case": job start checks the branch out, a
 * 45-minute model run follows, and until this existed nothing fetched or rebased between that
 * checkout and the push at the end. `fixer.yml`'s "Rebase onto trunk" step is the shape copied —
 * fetch, attempt the rebase, and on conflict abort and name the paths — but as git commands here
 * rather than a workflow step, because `implement.yml` is immutable and fixer's own step runs
 * before its model where this lane's model has already run by the time a push is possible.
 *
 * A conflict is **escalated, not resolved**: automatically merging it would be a second, unaudited
 * decision spent guessing at a diff, the same reason fixer's own step escalates before ever calling
 * its model rather than after. Throwing `RebaseConflictError` here is what keeps this lane from
 * spending one.
 */
function rebaseOntoTrunk(git: GitExec): void {
  git(["fetch", TRUNK_REMOTE, TRUNK_BRANCH]);
  try {
    git(["rebase", `${TRUNK_REMOTE}/${TRUNK_BRANCH}`]);
  } catch (err) {
    const paths = git(["diff", "--name-only", "--diff-filter=U"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    git(["rebase", "--abort"]);
    throw new RebaseConflictError(paths.length > 0 ? paths : [reason(err)]);
  }
}

/**
 * Commits the stage's written files to the branch this run claimed, optionally rebases it onto
 * trunk, and pushes it — the same add-commit-push shape `push-gate.ts`'s `commitAndPush` uses,
 * minus the rebase-onto-main step's *destination*: this lands on its own branch for a PR to
 * review, never straight onto `main`, so a rebase realigns rather than lands.
 *
 * `rebaseFirst` is lane 05's own call, made once per caller rather than inferred here: `landAnswer`
 * is shared with `recover/recover.ts`, whose own push realignment is a separate concern this ticket
 * (#334) does not touch, so a recovered run keeps the exact commit-then-push shape it always has
 * unless it explicitly opts in.
 *
 * The remote ref already exists, at the same commit this checkout is on (`claimImplementationBranch`
 * created it there), so the push is ordinarily a fast-forward onto the claim — true again once a
 * requested rebase has replayed this run's commit onto trunk's current tip.
 */
function commitAndPushBranch(git: GitExec, branch: string, paths: string[], commitMessage: string, rebaseFirst: boolean): void {
  git(["checkout", "-b", branch]);
  git(["add", ...paths]);
  git(["commit", "-m", commitMessage]);
  if (rebaseFirst) rebaseOntoTrunk(git);
  git(["push", "origin", `HEAD:${branch}`]);
}

/**
 * Whatever `paths` carry that the commit this run started at does not — asked of **git**, after the
 * write, so the answer covers work however it arrived on disk.
 *
 * A no-op is a legitimate outcome and this is the question that establishes one (#196): run
 * 33229214201 built #210, correctly found the ticket already implemented, returned its files
 * unchanged, and died on `git commit` with `nothing to commit, working tree clean`, leaving its
 * claim behind.
 *
 * It has to be git that answers, because the implementer is not only a thing that *returns* files —
 * it holds Edit, Write and Bash, and building a ticket is what it does with them. Comparing its
 * answer against the filesystem compares that answer to its own edits, which agree by construction:
 * run 33275876786 built #237 over 23 minutes, reported the five files it had already written, was
 * told every one of them matched disk, and had the lot discarded as "nothing to build"
 * ([ADR-0103](docs/adr/0103-what-a-lane-05-run-built-is-a-question-only-git-can-answer.md)).
 * `git status` is indifferent to who wrote a file and answers both cases correctly: clean when the
 * implementer genuinely changed nothing, dirty when it did the work itself.
 *
 * Scoped to `paths` — the implementer's own report of what it wrote — so a stray edit it made and
 * did not report cannot smuggle itself into the commit.
 */
export function worktreeChanges(git: GitExec, paths: string[]): string[] {
  if (paths.length === 0) return [];
  return git(["status", "--porcelain", "--", ...paths])
    .split("\n")
    .filter((line) => line.trim() !== "");
}

/**
 * Says one thing on the ticket — that a stale claim was taken over, or that there was nothing to
 * build. **Never throws**: the comment is this lane's signal to a human, not part of the claim
 * mechanism, and a run that has already done its work must not fail for want of one.
 *
 * `implement.yml` grants `issues: read` today, so this is the call that 403s until that permission
 * is widened to `issues: write`. Swallowing that leaves the release itself — the part that unblocks
 * the ticket — working either way.
 */
function sayOnTicket(gh: GhExec, issueNumber: number, body: string, log: (line: string) => void): void {
  try {
    gh(["issue", "comment", String(issueNumber), "--body", body]);
  } catch (err) {
    log(`could not say this on #${issueNumber} (${reason(err)}): ${body}`);
  }
}

/** What lane 05 says on the ticket when it takes over a claim a dead run left behind (#196). */
export function staleClaimTakeoverNote(branch: string): string {
  return [
    `Took over a stale claim on \`${branch}\`.`,
    "",
    `The branch was already there when this run started, with no pull request, no commits, and older`,
    `than this lane's own ${CLAIM_TIMEOUT_MINUTES}-minute timeout — a claim left behind by a run that`,
    "died rather than one a run is still holding. This run took it over and is building the ticket now.",
  ].join("\n");
}

/** What lane 05 says on the ticket when its push conflicted rebasing onto trunk (`RebaseConflictError`). */
export function rebaseConflictNote(paths: string[]): string {
  return [
    `Could not rebase this run's branch onto trunk before pushing — conflicted in: ${paths.join(", ")}.`,
    "",
    "This is escalated rather than resolved automatically, the same reason `fixer.yml`'s own rebase",
    "step stops instead of guessing at a merge. The claim has been released; whoever resolves the",
    "conflict by hand can re-dispatch this ticket afterwards.",
  ].join("\n");
}

/** What lane 05 says on the ticket when the implementer's files match what is already on disk. */
export function nothingToBuildNote(issueNumber: number): string {
  return [
    `Found nothing to build for #${issueNumber}.`,
    "",
    "The implementer returned this ticket's files exactly as they already are on trunk, so there was",
    "no commit to make and no pull request to open. That is an outcome, not a failure: the ticket may",
    "already be true. The claim has been released, so a later dispatch is free to try again.",
  ].join("\n");
}

/** What `openPrAndDispatch` opens a PR for and then tells the verification lane about. */
export interface PrDispatch {
  branch: string;
  title: string;
  body: string;
  /**
   * Every path this implementer wrote, exactly as `commitAndPushBranch` staged
   * them. The Immutability job reads this and **refuses an empty one** — an
   * implementer that sends no file list is a broken guarantee, not "nothing to
   * check" — so this is never allowed to be omitted or defaulted.
   */
  changedFiles: string[];
  /**
   * This slice's acceptance criteria, verbatim, as `extractCriteria` lifts
   * them from the ticket body. The Restore-and-run-acceptance job greps
   * trunk's `tests/acceptance/` for these (ADR-0033's verbatim match,
   * `shared/affected-tests.ts`) to scope its run to this slice alone.
   */
  criteria: string[];
}

/**
 * Opens exactly one PR for the branch just pushed, then sends exactly one
 * `VERIFY_DISPATCH_EVENT_TYPE` dispatch naming that PR — in that order, the
 * same order `applyGate` (`spec/open-questions.ts`) keeps for its own
 * label-then-dispatch write, so a dispatch that never sends still leaves the
 * PR as a durable trace rather than a silent stop.
 *
 * The payload carries three fields because trunk's `verify.yml` reads three:
 * `pr` for lane 08 to merge, `changed_files` for the Immutability job, and
 * `criteria` for the Restore-and-run-acceptance job. It carried only `pr`
 * until #145's seam audit, which meant that even once the action names were
 * reconciled, Immutability would have refused every PR on a missing file list
 * and the acceptance job would have found no test to run. A dispatch that
 * satisfies its receivers is the whole point of sending one.
 *
 * `changed_files` is comma-joined rather than sent as an array because the
 * Immutability job is deliberately a shell string-compare with no checkout and
 * no Node (`verify.yml`), and it splits on `,`. `criteria` is sent as a real
 * array — `gh api`'s `key[]=` repetition — because that job reads it through
 * `toJson()` and parses it as JSON.
 */
export function openPrAndDispatch(gh: GhExec, dispatch: PrDispatch): string {
  const prUrl = gh([
    "pr",
    "create",
    "--title",
    dispatch.title,
    "--body",
    dispatch.body,
    "--head",
    dispatch.branch,
  ]).trim();

  dispatchVerify(gh, { prUrl, changedFiles: dispatch.changedFiles, criteria: dispatch.criteria });
  return prUrl;
}

/**
 * The dispatch half of `openPrAndDispatch` on its own, for a pull request that already exists and
 * has changed since lane 06 last judged it. The fixer is the caller: a fix it pushes is a new head
 * nothing re-judges unless this is sent, and PR #280 sat green-by-the-fixer and unmerged on
 * 2026-08-30 for exactly that reason. Same three fields, same receivers, same reasons as above.
 */
export function dispatchVerify(
  gh: GhExec,
  dispatch: { prUrl: string; changedFiles: string[]; criteria: string[] },
): void {
  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${VERIFY_DISPATCH_EVENT_TYPE}`,
    "-f",
    `client_payload[pr]=${dispatch.prUrl}`,
    "-f",
    `client_payload[changed_files]=${dispatch.changedFiles.join(",")}`,
    ...dispatch.criteria.flatMap((criterion) => ["-f", `client_payload[criteria][]=${criterion}`]),
  ]);
}

export interface ImplementDeps {
  gh: GhExec;
  exec: StageExec;
  git: GitExec;
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  /**
   * The failing acceptance test file(s) for this slice — a **thunk**, deliberately, not a resolved
   * array.
   *
   * It was resolved eagerly, and that quietly broke #179's guarantee. `main` builds this object as
   * the argument to `runImplement`, so an eagerly-resolved `failingTests` ran
   * `findFailingTestFiles` — a full `vitest run tests/acceptance/` — *before* `runImplement` was
   * entered, and therefore before `claimImplementationBranch`. The claim was documented as
   * happening "before the ticket read and long before the model"; in practice a whole acceptance
   * suite ran first. On 2026-09-02 that window was seventeen minutes and counting on two runs, and
   * it is what let the reconciler read a live implementer as unstarted and dispatch a second one
   * against #342.
   *
   * Called from `buildAndOpen`, after the claim is held. Two things follow: the window is the
   * claim's own API call again rather than a test suite, and a run that exits `already-claimed`
   * no longer pays for an acceptance suite it will never use.
   */
  failingTests: () => FailingTestFile[];
  /** Where a refused claim is reported. Injected so a test reads it rather than the run log. */
  log?: (line: string) => void;
  /** When this run started, for judging a claim's age. Injected so a test can age one. */
  now?: Date;
  /** Read for `ANSWER_PATH_ENV` only. Injected so a test names a path without setting one. */
  env?: Record<string, string | undefined>;
  /**
   * Runs one of `GENERATED_ARTIFACTS`' generators — wired to `execGenerator` by `main`, and absent
   * everywhere else. Absent means *do not regenerate*, which is the right default for the only
   * callers that leave it out: a test spawning the real generators would rewrite this repo's own
   * `.claude/contract.json` from whatever tree the suite happens to be running against.
   */
  runGenerator?: GeneratorExec;
  /**
   * The repo root the generators are pointed at — the *target* checkout under the reusable
   * workflow (ADR-0055), which is not this process's cwd there. Defaults to cwd, which is the
   * right answer for a workstation run and for every caller that has only one checkout.
   */
  repoRoot?: string;
}

/**
 * How one lane 05 run ended. Three outcomes, because two of them are green and only one of those
 * opens a pull request — collapsing either into "no PR" is what made a dead run's leftover claim
 * indistinguishable from a healthy duplicate dispatch (#196).
 */
export type ImplementOutcome =
  /** A pull request was opened and the verification lane told about it. */
  | { outcome: "opened"; pr: string }
  /** Somebody is building this slice already — the ordinary price of at-least-once dispatch (#179). */
  | { outcome: "already-claimed" }
  /** The ticket was already true: the implementer's files matched trunk, so there was nothing to commit. */
  | { outcome: "nothing-to-build" }
  /** The dispatch named a ticket that is already closed — a stale doorbell read (#279). Nothing was spent and the claim is released. */
  | { outcome: "ticket-closed" }
  /** The push conflicted rebasing onto trunk. Escalated to `needs-human` rather than resolved; the claim is released. */
  | { outcome: "rebase-conflict"; paths: string[] };

/**
 * Releases the claim a failed run is holding, unless a pull request now exists on it.
 *
 * The exception is the whole reason this asks GitHub rather than a local flag: `openPrAndDispatch`
 * opens the PR and *then* sends the dispatch, so a failure in the send is a failure with a live PR
 * standing behind it, and deleting that branch would take the run's finished work with it. Anything
 * this cannot determine leaves the claim alone, for the reason `assessClaim` gives.
 */
function releaseFailedClaim(gh: GhExec, branch: string, log: (line: string) => void): void {
  try {
    if (hasPullRequest(gh, branch)) {
      log(`\`${branch}\` already carries a pull request — leaving its claim in place.`);
      return;
    }
  } catch (err) {
    log(`could not tell whether \`${branch}\` carries a pull request, so its claim stands: ${reason(err)}`);
    return;
  }
  releaseClaim(gh, branch, log);
}

/**
 * The whole implement flow, end to end: claim the branch, read the ticket, assemble its brief
 * from exactly the four ingredients #167 names, run the implementer stage,
 * write what it returns, commit and push the claimed branch, then open exactly one PR
 * and send exactly one verification dispatch naming it.
 *
 * **A claim this run made does not outlive it** (#196). Every path out of here that is not an open
 * pull request gives the branch back: a throw anywhere after the claim, and the no-op where the
 * implementer's files match trunk. The claim is the ready set's `started` term
 * (`shared/ready-set.ts`), so a claim left standing by a dead run is not a stale ref — it is a
 * ticket nothing will ever build again, which is exactly what happened twice in one evening and
 * both times took a `git push origin --delete` by hand to clear.
 */
export async function runImplement(deps: ImplementDeps): Promise<ImplementOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));

  // First, before the ticket read and long before the model: the claim is only a claim if nothing
  // expensive has happened yet.
  const branch = implementationBranch(deps.issueNumber);
  const claim = claimImplementationBranch(deps.gh, deps.git, branch, log, deps.now ?? new Date());
  if (!claim.claimed) return { outcome: "already-claimed" };

  // A retry that succeeded and a retry that was refused both used to look like a green run with no
  // PR. Saying this on the ticket is what tells them apart, for a reader who has only the tracker.
  if (claim.tookOverStaleClaim) {
    sayOnTicket(deps.gh, deps.issueNumber, staleClaimTakeoverNote(branch), log);
  }

  try {
    return await buildAndOpen(deps, branch, log);
  } catch (err) {
    releaseFailedClaim(deps.gh, branch, log);
    throw err;
  }
}

/**
 * What `landAnswer` needs from a caller that already holds a claim and an answer — the tail of
 * `ImplementDeps` that has nothing to do with how the answer was obtained (a fresh stage run here,
 * a recovered artifact in `recover/recover.ts`).
 */
type LandDeps = Pick<ImplementDeps, "gh" | "git" | "writeFile" | "runGenerator" | "repoRoot">;

/**
 * Everything from a held answer to an opened pull request: write the files, ask git what actually
 * changed, commit and push the claimed branch, then open the PR and dispatch verification —
 * or release the claim and say so when the answer changed nothing.
 *
 * Split out of `buildAndOpen` so `recover/recover.ts` can hand this the *same* answer twice —
 * once assembled fresh by a stage, once read back off an `implementer-answer-<n>` artifact a dead
 * run left behind — without either caller re-deriving what happens after an answer exists. Only
 * the commit message differs between the two, so it is the one thing this takes as a parameter
 * rather than building itself.
 *
 * `options.rebaseOntoTrunk` defaults to `false` so `recover/recover.ts`'s existing call — which
 * passes none — keeps its exact commit-then-push shape; `buildAndOpen` below is the one caller
 * that opts in, for the reason `commitAndPushBranch` gives.
 */
export async function landAnswer(
  deps: LandDeps,
  branch: string,
  issueNumber: number,
  ticket: TicketRead,
  answer: ImplementerAnswer,
  commitMessage: string,
  log: (line: string) => void,
  options: { rebaseOntoTrunk?: boolean } = {},
): Promise<ImplementOutcome> {
  for (const file of answer.files) {
    deps.writeFile(file.path, file.content);
  }

  // Asked of git, after the write — see `worktreeChanges` for why the filesystem cannot answer it.
  const changing = worktreeChanges(deps.git, answer.files.map((file) => file.path));

  if (changing.length === 0) {
    releaseClaim(deps.gh, branch, log);
    sayOnTicket(deps.gh, issueNumber, nothingToBuildNote(issueNumber), log);
    return { outcome: "nothing-to-build" };
  }

  // Only now, once there is something to commit: a run that built nothing has nothing to make a
  // generated artifact stale, and spending two subprocesses to prove that is spending them for
  // nothing. Regenerated paths ride along on the commit — see `regenerate-artifacts.ts` for why the
  // implementer is not the one asked to keep them fresh.
  const paths = [
    ...answer.files.map((file) => file.path),
    ...(deps.runGenerator ? regenerateArtifacts(deps.runGenerator, deps.repoRoot ?? process.cwd(), log) : []),
  ];

  try {
    commitAndPushBranch(deps.git, branch, paths, commitMessage, options.rebaseOntoTrunk ?? false);
  } catch (err) {
    if (!(err instanceof RebaseConflictError)) throw err;
    releaseClaim(deps.gh, branch, log);
    escalateToOwner(deps.gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, issueNumber, rebaseConflictNote(err.paths), log);
    return { outcome: "rebase-conflict", paths: err.paths };
  }

  const pr = openPrAndDispatch(deps.gh, {
    branch,
    title: ticket.title,
    body: `${answer.summary}\n\nCloses #${issueNumber}`,
    // The same `paths` just staged and pushed — the implementer's own report of what it wrote,
    // not a `git diff` re-read, so the list the Immutability job judges is the list this lane
    // committed.
    changedFiles: paths,
    criteria: extractCriteria(ticket.body),
  });
  return { outcome: "opened", pr };
}

/** Everything between a held claim and an opened pull request — see `runImplement` for the frame. */
async function buildAndOpen(deps: ImplementDeps, branch: string, log: (line: string) => void): Promise<ImplementOutcome> {
  // Before the brief and long before the model: a dispatch can name a ticket that already merged
  // and closed — #279's stalled wave arrived exactly here, as a full model run against finished
  // work that exited green and made the stall invisible. A closed ticket is refused out loud and
  // the claim is put back. Its own read, not a field on `readTicket`: that call's argv is a pinned
  // seam three other lanes' fakes route on.
  const stateRead = JSON.parse(deps.gh(["issue", "view", String(deps.issueNumber), "--json", "state"])) as {
    state?: string;
  };
  if (stateRead.state === "CLOSED") {
    log(`refusing #${deps.issueNumber}: the ticket is already closed — a stale dispatch builds nothing`);
    releaseFailedClaim(deps.gh, branch, log);
    return { outcome: "ticket-closed" };
  }

  const ticket = readTicket(deps.gh, deps.issueNumber);
  const seamManifestLines = extractSeamsConsumed(ticket.body);
  const filesClaimed = extractFilesClaimed(ticket.body);
  const contextPath = moduleContextPath(filesClaimed, deps.fileExists);
  const moduleContext = deps.readFile(contextPath);

  const brief = assembleBrief({
    ticketBody: ticket.body,
    seamManifestLines,
    moduleContext,
    failingTests: deps.failingTests(),
  });

  const answer = await runImplementer(deps.exec, brief);
  keepAnswer(deps.writeFile, deps.env ?? process.env, answer, log);

  // Non-blocking (ADR-0042): every out-of-brief read the implementer reports is recorded on the
  // standing tracker issue and nothing else — never a `dependencies/blocked_by` write, never a
  // pause. The dependency graph stays lane 03's alone (ADR-0069).
  for (const module of answer.outOfBriefReads) {
    recordOutOfBrief(deps.gh, module);
  }

  return landAnswer(
    deps,
    branch,
    deps.issueNumber,
    ticket,
    answer,
    `Implement #${deps.issueNumber}\n\n${answer.summary}\n\nPart of #${deps.issueNumber}`,
    log,
    { rebaseOntoTrunk: true },
  );
}

/**
 * The acceptance files belonging to one slice: `tests/acceptance/<issue>-*`, the naming lane 04
 * authors by (`acceptance.ts`) and `testsForCriteria` matches against.
 *
 * This scoping is the difference between a brief and a repository read. `findFailingTestFiles`
 * used to run the *whole* acceptance directory and hand back every failure in it: on 2026-09-03
 * that was 19 files, of which 10 belonged to no live ticket at all, and each implementer was
 * handed all of them as "its own failing acceptance test(s)". Its own docstring already promised
 * per-issue scoping that its signature could not deliver — it never took an issue number.
 *
 * The cost was not only wrong content. The unscoped run took 257 seconds of test CPU, which is
 * roughly 26 minutes on the two-core runner this lane gets — measured on runs 33696576981 and
 * 33697122706, both of which spent more than half of `implement.yml`'s 45-minute cap here before
 * their model started. One slice's files are ~13 seconds of the same measure.
 */
export function sliceTestFiles(dir: string, issueNumber: number, repoDir: string): string[] {
  const root = resolve(repoDir, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.startsWith(`${issueNumber}-`) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(name))
    .map((name) => `${dir}${name}`);
}

/**
 * Every failing acceptance test file **for `issueNumber` alone**, read from disk —
 * `push-gate.ts`'s own `TestRunResult` shape, reused rather than
 * re-classified, since "which test failed" is exactly what it already
 * reports. Real production behaviour for `main()`; `runImplement` above
 * never calls this itself, so a test exercising the brief-assembly or
 * PR-and-dispatch criteria never has to run a real suite.
 *
 * `repoDir` is the tree the suite runs in and the paths are relative to —
 * the target checkout under the reusable workflow (ADR-0055), cwd anywhere
 * else. The paths that come back stay repo-relative either way: they are
 * what the brief names and what a criterion is matched against, so they
 * cannot carry a runner's absolute workspace into either.
 */
export function findFailingTestFiles(
  dir: string,
  issueNumber: number,
  readFile: (path: string) => string,
  repoDir: string = process.cwd(),
  runTests: () => TestRunResult = () => runVitestJson(`${dir}${issueNumber}-`, repoDir),
): FailingTestFile[] {
  // Nothing to run, and nothing to say: a slice whose acceptance tests lane 04 has not authored
  // yet has no failing test of its own, which is not the same as a red suite. Asked before the
  // runner is spawned, because vitest given a filter that matches no file reports an uncollected
  // suite, and this function reads that as an error.
  if (sliceTestFiles(dir, issueNumber, repoDir).length === 0) return [];

  const result = runTests();
  if (!result.collected) {
    throw new Error(`acceptance suite under ${dir} did not collect: ${result.collectionError ?? "no detail reported"}`);
  }
  const paths = [...new Set(result.failures.map((failure) => failure.name.split(" > ")[0]))];
  return paths
    .filter((path) => existsSync(resolve(repoDir, path)))
    .map((path) => ({ path, content: readFile(path) }));
}

async function main(): Promise<void> {
  const issueArg = process.argv[2];
  if (!issueArg) {
    console.error("usage: implement.ts <issue-number>");
    process.exitCode = 1;
    return;
  }
  const issueNumber = Number(issueArg);

  // Which checkout is the repository being built. `TARGET_WORKSPACE` is set only by the reusable
  // workflow (ADR-0055, amended by ADR-0132): there, this process runs from the *machine* checkout
  // — that is where this file, the implementer's prompt and the generators live — while everything
  // a ticket names is a path in the target's tree. A workstation run has one of each, so cwd is the
  // right answer and this is absent.
  //
  // Every seam below that could mean either repository is bound to the target here, in one place,
  // rather than left to whichever function happened to reach the filesystem first:
  //
  // - `exec` — the implementer holds Edit, Write and Bash and *builds with them*, so its own
  //   working directory has to be the target or a run would edit the pipeline instead of the
  //   repository it was dispatched for. This is the seam no other lane needs.
  // - `git` — `-C` bound once, the same shape `integrate.ts`'s `main` uses, so the claim's
  //   `rev-parse`, the branch, the commit and the push all describe the target.
  // - `readFile`/`fileExists`/`writeFile` — every path in play is repo-relative (the ticket's
  //   `CONTEXT.md`, the answer's own files), and `resolve` leaves the one absolute path that
  //   reaches `writeFile` — the answer receipt in the runner's temp directory — untouched.
  // - `failingTests` and `repoRoot` — the target's acceptance suite is what the brief is built
  //   from, and the target's generated artifacts are what a commit can make stale.
  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();
  const inRepo = (path: string) => resolve(repoDir, path);

  try {
    const result = await runImplement({
      gh: execGh,
      exec: execClaudeIn(repoDir),
      git: (args) => execGit(["-C", repoDir, ...args]),
      readFile: (path) => readFileSync(inRepo(path), "utf8"),
      fileExists: (path) => existsSync(inRepo(path)),
      writeFile: (path, content) => fsWriteFile(inRepo(path), content),
      issueNumber,
      failingTests: () =>
        findFailingTestFiles("tests/acceptance/", issueNumber, (path) => readFileSync(inRepo(path), "utf8"), repoDir),
      runGenerator: execGenerator,
      repoRoot: repoDir,
    });
    if (result.outcome === "already-claimed") {
      // Not a failure. A duplicate `ticket-ready` is the price of at-least-once dispatch, and the
      // branch ref is what makes it free — exiting green here is that guarantee being kept.
      console.log(`#${issueNumber} is already claimed — nothing to do.`);
      return;
    }
    if (result.outcome === "ticket-closed") {
      // A refusal, not a failure: the graph moved between the dispatch and this run (#279). Red
      // here would summon Recover to rebuild a ticket that is already done.
      console.log(`#${issueNumber} is already closed — refused the stale dispatch.`);
      return;
    }
    if (result.outcome === "nothing-to-build") {
      // Also not a failure, and the distinction the run that died on `nothing to commit` could not
      // make (#196): the ticket was already true, the claim is back, and the ticket says so.
      console.log(`#${issueNumber} needed no changes — nothing to build.`);
      return;
    }
    if (result.outcome === "rebase-conflict") {
      // Escalated, not failed: the ticket carries `needs-human` and names what did not replay, and
      // this run spent nothing further trying to resolve it itself.
      console.log(`#${issueNumber} conflicted rebasing onto trunk: ${result.paths.join(", ")} — escalated.`);
      return;
    }
    console.log(`opened ${result.pr}`);
  } catch (err) {
    console.error(`implement failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
