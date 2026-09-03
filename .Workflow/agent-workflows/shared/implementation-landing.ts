import { z } from "zod";
import { judgeFailsEdits } from "./fails-rule";
import type { GhExec } from "./gh";
import { branchCreationPath, comparePath, GIT_REFS_PATH } from "./gh-paths";
import type { GitExec } from "./git";
import { escalateToOwner } from "./needs-human";
import { reason } from "./reason";
import { extractCriteria, type TicketRead } from "./ticket-shape";
import { dispatchVerify } from "./verify-dispatch";

/**
 * Everything between a held implementer answer and an opened pull request — the claim on the
 * slice's branch, the write, the commit-rebase-push, the PR and its verification dispatch — as one
 * module two lanes share. `implement/implement.ts` runs it after a fresh stage; `recover/recover.ts`
 * runs the *same* code over an answer read back off the artifact a dead run left behind (#196,
 * ADR-0103), so a recovered run can never land differently from a live one. Two lanes, one path
 * to a pull request: that is why it lives here and not in either of them.
 */

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
 * trunk, and pushes it — add, commit, push. This lands on its own branch for a PR to review,
 * never straight onto `main`, so a rebase realigns rather than lands.
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
export function sayOnTicket(gh: GhExec, issueNumber: number, body: string, log: (line: string) => void): void {
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

/**
 * What lane 05 says on the ticket when the answer edited a `test.fails(` acceptance test beyond
 * turning it on (`judgeFailsEdits`, #360). `reason` is the verdict's own, naming each line.
 */
export function failsRuleNote(reason: string): string {
  return [
    "Refused to push this run's answer: it changed an acceptance test it is judged by.",
    "",
    reason,
    "",
    "An implementer may turn a `test.fails(` test on by deleting `.fails` from that line, and may",
    "not otherwise touch it. Nothing was committed. The claim has been released; whoever reads the",
    "answer can re-dispatch this ticket afterwards.",
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
   * them from the ticket body. Kept for the dispatch's shape: `verify.yml`
   * reads `pr` and `changed_files` today, and the job that grepped a restored
   * `tests/acceptance/` for these left with #360 — an acceptance test now
   * lives beside its subject and runs with the suite.
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
 * The payload carries `pr` for lane 08 to merge and `changed_files` for the
 * Immutability job — the two fields trunk's `verify.yml` reads — plus
 * `criteria`, see `PrDispatch`. It carried only `pr` until #145's seam audit,
 * which meant that even once the action names were reconciled, Immutability
 * would have refused every PR on a missing file list. A dispatch that
 * satisfies its receivers is the whole point of sending one.
 *
 * `changed_files` is comma-joined rather than sent as an array because the
 * Immutability job is deliberately a shell string-compare with no checkout and
 * no Node (`verify.yml`), and it splits on `,`. `criteria` is sent as a real
 * array — `gh api`'s `key[]=` repetition.
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
 * How one lane 05 run ended. Named outcomes rather than "PR or no PR", because several of them
 * are green and only one opens a pull request — collapsing the rest into "no PR" is what made a
 * dead run's leftover claim indistinguishable from a healthy duplicate dispatch (#196).
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
  | { outcome: "rebase-conflict"; paths: string[] }
  /** The answer edited a `test.fails(` acceptance test beyond turning it on (#360). Nothing committed; escalated to `needs-human`; the claim is released. */
  | { outcome: "fails-rule-refused"; reason: string };

/**
 * Releases the claim a failed run is holding, unless a pull request now exists on it.
 *
 * The exception is the whole reason this asks GitHub rather than a local flag: `openPrAndDispatch`
 * opens the PR and *then* sends the dispatch, so a failure in the send is a failure with a live PR
 * standing behind it, and deleting that branch would take the run's finished work with it. Anything
 * this cannot determine leaves the claim alone, for the reason `assessClaim` gives.
 */
export function releaseFailedClaim(gh: GhExec, branch: string, log: (line: string) => void): void {
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
 * What `landAnswer` needs from a caller that already holds a claim and an answer — the tail of
 * `implement.ts`'s `ImplementDeps` that has nothing to do with how the answer was obtained (a fresh
 * stage run there, a recovered artifact in `recover/recover.ts`).
 */
export interface LandDeps {
  gh: GhExec;
  git: GitExec;
  writeFile: (path: string, content: string) => void;
}

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

  const paths = answer.files.map((file) => file.path);

  // Before anything is committed: the one rule that replaced the immutable `tests/acceptance/`
  // (#360) — a `test.fails(` acceptance test may be turned on, never rewritten or deleted. Judged
  // on the unstaged diff of the answer's paths against HEAD, which is enough: a file the answer
  // created is untracked and absent from it, and an added file cannot remove a standing
  // `test.fails(` line. Refused here rather than by Verify, so the run that edited its own
  // judgement stops before a pull request exists and the ticket says why.
  const verdict = judgeFailsEdits(deps.git(["diff", "--", ...paths]));
  if (!verdict.ok) {
    releaseClaim(deps.gh, branch, log);
    escalateToOwner(deps.gh, issueNumber, process.env.GITHUB_REPOSITORY_OWNER);
    sayOnTicket(deps.gh, issueNumber, failsRuleNote(verdict.reason), log);
    return { outcome: "fails-rule-refused", reason: verdict.reason };
  }

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