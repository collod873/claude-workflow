import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { childEnv } from "../shared/child-env";
import { closeTicketProcess, type CloseTicketResult } from "../shared/close-ticket";
import { VERIFY_DISPATCH_EVENT_TYPE } from "../implement/implement";
import { execGh, type GhExec } from "../shared/gh";
import { runJobsPath, workflowRunsPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { escalateToOwner } from "../shared/needs-human";
import { announceGraphChanged, GRAPH_CHANGED_DISPATCH_ACTION } from "../shared/ready-set";
import { reason } from "../shared/reason";

export { VERIFY_DISPATCH_EVENT_TYPE, GRAPH_CHANGED_DISPATCH_ACTION };

/**
 * Lane 08 (PRD #145, move 7): the merge actor. Fires on the same
 * `repository_dispatch` an implementer's `openPrAndDispatch` sends
 * (`VERIFY_DISPATCH_EVENT_TYPE`, `implement.ts`) — re-exported here rather
 * than restated, so `integrate-workflow.test.ts` and `integrate.yml`'s own
 * `if:` both check against the one constant `implement.ts` owns.
 *
 * No model runs here (DESIGN.md §10 move 7: "with no model in it") — every
 * decision below is a git rebase, a shell to `bin/gauntlet`, and a `gh pr
 * merge`, in that order, never a judgement call. The one property ADR-0054
 * binds this actor to: **a completed green run merges, a completed red run
 * does not, and the absence of any completed run does not either** — the
 * third case is not "no red check", it is its own refusal, because a
 * dispatch that never lands or a gauntlet invocation that never finishes
 * must never read the same as a real pass (see `IntegrateOutcome` below).
 */

/** One `bin/gauntlet push` invocation's outcome, exactly the three exit codes `bin/gauntlet`'s own header names. */
export interface GauntletResult {
  /** `0` clean, `1` a real finding, `2` the checks could not run at all. */
  exitCode: 0 | 1 | 2;
}

/**
 * One `bin/close-ticket` invocation's outcome, re-exported from the shared seam both closing lanes
 * reach it through — `shared/close-ticket.ts`, whose docstring is its home.
 */
export type { CloseTicketResult };

/**
 * What became of the ticket the merged pull request named (#195). A merge that landed is never
 * undone by anything in here, so this rides *alongside* `merged: true` rather than qualifying it.
 */
export type ClosingOutcome =
  /** `bin/close-ticket` verified the ticket's own criteria against the merge and posted the `## Closing record`. */
  | { closed: true; ticket: number }
  /** `bin/close-ticket` declined to close (see `CloseTicketResult`). The ticket stays open and carries a comment from this lane saying why. */
  | { closed: false; reason: "refused"; ticket: number }
  /** The pull request body names no ticket, so there is nothing to close — a branch pushed by hand, never lane 05's work. */
  | { closed: false; reason: "no-ticket" };

export type IntegrateOutcome =
  | { merged: true; closing: ClosingOutcome }
  /** A completed run reported red — `bin/gauntlet push` exited `1`. */
  | { merged: false; reason: "red" }
  /**
   * No completed run to merge on — `bin/gauntlet push` exited `2` (a broken
   * gauntlet, never a finding) or threw before producing an exit code at
   * all. Kept distinct from `"red"` so a caller can never read "nothing ran"
   * as "it ran and passed", the exact absence-of-evidence mistake ADR-0054
   * names.
   */
  | { merged: false; reason: "no-run" }
  /**
   * Lane 06's `Immutability` job failed for this dispatch's head commit: an implementer's diff
   * crossed `tests/acceptance/`, `vitest.config.ts` or `.github/` (ADR-0053/ADR-0054). The one
   * alarm this lane never merges over — a diff that can silence a check has invalidated whatever
   * this lane's own gauntlet just said about it.
   */
  | { merged: false; reason: "immutable-set" }
  /**
   * Lane 06 has not judged this head commit: no dispatch run of `verify.yml` carries it, or the
   * `Immutability` job on the run that does is still queued, running, skipped or cancelled. Kept
   * distinct from `"immutable-set"` for the same reason `"no-run"` is kept distinct from `"red"` —
   * ADR-0054's property is that the *absence* of a completed verdict is its own refusal, never a
   * pass by default (#197).
   */
  | { merged: false; reason: "unjudged" }
  /**
   * Lane 06's `Restore and run acceptance` job failed for this head commit: the slice's own
   * acceptance tests, restored from trunk, do not pass against this diff. The ticket is not built.
   *
   * This bound nothing until now, and ADR-0095 said why — the job was red for every pull request
   * while lane 04's first-authoring was unwired, so binding on it would have stopped the chain
   * rather than caught anything. That is no longer true (ADR-0104).
   */
  | { merged: false; reason: "acceptance" }
  /**
   * The rebase onto trunk stopped on a conflict, and this lane wrote the record rather than
   * throwing one (#234): the rebase is aborted, the pull request carries `blocked`, and a comment
   * names `paths`. Unlike every other refusal here, nothing judged the diff and nothing was found
   * wrong with it — trunk simply moved somewhere the branch cannot be replayed onto by machine.
   *
   * It is also the one refusal that does not redden the run (see `main`): the pull request carries
   * the whole account, and a red lane beside that record would say the merge actor broke.
   */
  | { merged: false; reason: "conflict"; paths: string[] };

export interface IntegrateDeps {
  git: GitExec;
  gh: GhExec;
  /** The PR this run integrates, as `gh` accepts it — a number, a URL, or `OWNER/REPO#123`. Same identifier `implement.ts`'s `openPrAndDispatch` names in its dispatch payload. */
  pr: string;
  /**
   * The commit lane 06's run for this dispatch carries as its head — `github.sha` in
   * `integrate.yml`. Lane 06 and lane 08 fire on the *same* `repository_dispatch`, and a
   * dispatch-triggered run always executes trunk's copy of the workflow file at trunk's tip
   * (ADR-0054), so both runs carry that tip as `head_sha`. It is the only fact the two runs share
   * that the Actions API will answer on: `pull_requests` on a dispatch run is empty, and the
   * pull request's own head commit carries no check runs at all, so neither `gh pr checks` nor
   * `--json statusCheckRollup` can see lane 06 from here.
   */
  headSha: string;
  /** Re-runs the gauntlet against the rebased tree. Real production behaviour shells to `bin/gauntlet push`; a test injects a canned result instead of paying for a real run. */
  runGauntlet: () => GauntletResult;
  /** Who a rebase conflict assigns the ticket to — `SIGNAL_ASSIGNEE`, the repository owner. Absent on a workstation run, which then labels without assigning. */
  assignee?: string;
  /** Closes `ticket` against `range`. Real production behaviour shells to this repository's own `bin/close-ticket` (`runRealCloseTicket`); a test injects a canned result rather than paying for a tracker write and the ticket's own checks. */
  closeTicket: (ticket: number, range: string) => CloseTicketResult;
  /** Waits between re-reads of lane 06's verdict. Injected so a test counts reads instead of sleeping. */
  sleep?: (ms: number) => void;
}

/** What one `gh pr view` tells this lane: the branch to rebase, and the ticket the merge will finish. */
interface PullRequest {
  /** The PR's own head branch name. */
  branch: string;
  /** The ticket this pull request's body says it closes, or `undefined` when it names none. */
  ticket: number | undefined;
}

/**
 * `Closes #123` in a pull request body — the form lane 05's `openPrAndDispatch` writes
 * (`implement.ts`), widened to the rest of GitHub's own closing keywords so a hand-opened pull
 * request reads the same way.
 */
const CLOSING_REFERENCE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;

/**
 * The one read this lane makes before it writes anything: the branch to rebase and the ticket to
 * close, from a single `gh pr view`.
 *
 * The ticket comes from **parsing the body**, not from `--json closingIssuesReferences`, and that
 * is the point rather than an omission. GitHub's linkage is what was already missing in the run
 * #195 was filed on: [#193](https://github.com/collod873/claude-workflow/pull/193) ended in
 * `Closes #190`, #190's timeline carried `referenced` and `cross-referenced` and no `connected`
 * event at all, and #190 stayed open. Reading the linkage would have this lane ask GitHub the
 * question GitHub had already answered wrong; reading the body asks the pull request what it says.
 */
function readPr(gh: GhExec, pr: string): PullRequest {
  const raw = gh(["pr", "view", pr, "--json", "headRefName,body"]);
  const json = JSON.parse(raw) as { headRefName?: string; body?: string };
  const match = CLOSING_REFERENCE_RE.exec(json.body ?? "");
  return {
    branch: (json.headRefName ?? "").trim(),
    ticket: match ? Number(match[1]) : undefined,
  };
}

/**
 * What lane 06 says about one of its jobs, for the head commit this dispatch names.
 *
 * Three states rather than a boolean, and the third is the point. `verify.yml`'s `Immutability`
 * job is gated on the implementer's dispatch, so on a `push: main` run it is **skipped** — and
 * `verify.yml`'s own downstream `if: always() && needs.immutability.result != 'failure'` waves
 * that skip through on purpose. Lane 08 may not: a job that was skipped, cancelled, or is still
 * running has said nothing, and "said nothing" must never collapse into "said yes" (ADR-0054).
 */
export type JobVerdict = "passed" | "failed" | "unjudged";

/** Lane 06's two jobs, as lane 08 reads them for one head commit. */
interface VerifyVerdict {
  immutability: JobVerdict;
  acceptance: JobVerdict;
}

/** `verify.yml`'s file name, which is how the Actions API addresses one workflow's own runs. */
const VERIFY_WORKFLOW_FILE = "verify.yml";

/**
 * The `Immutability` job's `name:` in `verify.yml`. Spelled here as well as there — `shared/` may
 * not import a workflow file and the Actions API answers job *names* — so `integrate.test.ts`
 * parses `verify.yml` and asserts the two agree, the same split `immutable-set.ts` holds to for
 * `IMMUTABLE_SET` and the dispatch action.
 */
export const IMMUTABILITY_JOB = "Immutability";

/** The `Restore and run acceptance` job's `name:` in `verify.yml`, pinned the same way. */
export const ACCEPTANCE_JOB = "Restore and run acceptance";

/** The `event` an Actions run carries when lane 05's `openPrAndDispatch` started it. */
const DISPATCH_EVENT = "repository_dispatch";

/**
 * How far back one lane-06 lookup reaches. The run being looked for was created by the same
 * webhook delivery as this one, minutes ago at most, so a page this size is the entire fleet's
 * recent history several times over — it is sized to survive a burst of parallel implementers,
 * not to reach into last week.
 */
const VERIFY_RUN_PAGE_SIZE = 100;

/**
 * How many times lane 08 re-reads lane 06 while its acceptance job is still running, and how long
 * it waits between reads — about ten minutes end to end.
 *
 * `Immutability` needs none of this: it is a checkout-free string comparison that finishes in
 * seconds, so reading it once after the rebase and the gauntlet always finds it done. `Restore and
 * run acceptance` is a checkout, an `npm ci` and a vitest run, on the same order as this lane's own
 * work — so which of the two finishes first is a genuine race, and a single read would resolve it
 * by refusing whichever pull request happened to lose. Now that the job binds (ADR-0104), losing
 * that race would block a merge that nothing retries, so this lane waits for the answer rather than
 * treating "still running" as "not judged".
 */
const ACCEPTANCE_POLL_ATTEMPTS = 40;
const ACCEPTANCE_POLL_MS = 15_000;

/**
 * Blocks the thread for `ms`. Synchronous on purpose: `runIntegrate` is deliberately not a
 * `Promise` (see its header), and this lane holds the merge lock while it waits either way, so
 * there is nothing else for this process to be doing.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const ApiRun = z.object({
  id: z.number(),
  head_sha: z.string(),
  event: z.string(),
  status: z.string(),
});
const ApiJob = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

/**
 * One job's verdict. Only a *completed* job that concluded `success` is a pass; `failure` is a
 * fail; everything else — queued, in progress, skipped, cancelled, timed out — is `unjudged`,
 * because each of those is a job that has not said this diff is fine.
 */
function jobVerdict(jobs: Array<z.infer<typeof ApiJob>>, name: string): JobVerdict {
  const job = jobs.find((each) => each.name === name);
  if (!job || job.status !== "completed") return "unjudged";
  if (job.conclusion === "success") return "passed";
  if (job.conclusion === "failure") return "failed";
  return "unjudged";
}

/** Lane 06 has said nothing about this pull request — the reading every refusal below collapses to. */
const NOT_JUDGED: VerifyVerdict = { immutability: "unjudged", acceptance: "unjudged" };

/** One run's jobs, as the Actions API answers them — the four fields this lane reads. */
function readJobs(gh: GhExec, runId: number): Array<z.infer<typeof ApiJob>> {
  return ApiJob.array().parse(
    JSON.parse(gh(["api", runJobsPath(runId), "--jq", "[.jobs[] | {id, name, status, conclusion}]"])),
  );
}

/**
 * Whether one job's own log says it was judging `pr` — the `judging <pr-url> on <branch>` line
 * `verify.yml`'s jobs print first (ADR-0104), the same line `fixer.yml` resolves its target from.
 *
 * Addressed by **job** rather than by run, which is the whole of the fix's second half. `gh run
 * view <run> --log` refuses a run that is still going ("run N is still in progress; logs will be
 * available when it is complete"), and lane 06's run is still going for the whole several minutes
 * its acceptance job takes — so a run-addressed read could never recognise the re-judge that was
 * in flight, and fell back to the stale failure underneath it every time (#286). `--job` refuses
 * only while *that* job is unfinished, and `Immutability` — a checkout-free string comparison that
 * runs before both other jobs — is done seconds in.
 *
 * A log that cannot be read names nothing: the safe reading is "not this pull request's run",
 * which costs a wait, never a merge on someone else's verdict.
 */
function jobJudged(gh: GhExec, jobId: number, pr: string): boolean {
  try {
    return gh(["run", "view", "--job", String(jobId), "--log"]).includes(`judging ${pr} on `);
  } catch {
    return false;
  }
}

/**
 * Lane 06's verdict on this dispatch's head commit, read off the Actions API.
 *
 * Runs are narrowed by `head_sha` **and** by `event`. The `head_sha` alone is not enough: the push
 * that produced this trunk tip ran `verify.yml` at the very same commit, and that run's
 * `Immutability` job is skipped by its own `if:` — so a `head_sha`-only filter would hand this
 * lane a skipped job to read, which is exactly the reading `JobVerdict` exists to refuse.
 *
 * Among what is left, **newest first, and the newest run that names this pull request wins
 * outright**. Several dispatch runs can share trunk's sha while judging different pull requests,
 * and a fixer's re-judge shares it with the failed run it supersedes — reading the strictest
 * verdict across all of them let a superseded failure outvote its own green re-judge forever
 * (#286).
 *
 * A newer run that has not yet named anyone stops the read rather than being skipped past. Its
 * `Immutability` job is where the name gets written, so until that job finishes the run *might* be
 * this pull request's own re-judge, and reading the older verdict underneath it would settle a
 * question the newer run is still answering. Silence from a live run is not permission to read a
 * superseded one — the same direction ADR-0054 takes on a job that has said nothing: wait and ask
 * again, which costs a poll rather than a merge on a stale verdict. A run that finished without
 * ever naming anyone is genuinely not ours and is skipped.
 */
function readVerifyVerdict(gh: GhExec, headSha: string, pr: string): VerifyVerdict {
  const runsPath = workflowRunsPath(VERIFY_WORKFLOW_FILE, VERIFY_RUN_PAGE_SIZE);
  const runs = ApiRun.array().parse(
    JSON.parse(gh(["api", runsPath, "--jq", "[.workflow_runs[] | {id, head_sha, event, status}]"])),
  );
  const candidates = runs
    .filter((run) => run.head_sha === headSha && run.event === DISPATCH_EVENT)
    .sort((a, b) => b.id - a.id);
  for (const run of candidates) {
    const jobs = readJobs(gh, run.id);
    const immutability = jobs.find((job) => job.name === IMMUTABILITY_JOB);
    if (immutability === undefined || immutability.status !== "completed") {
      if (run.status !== "completed") return NOT_JUDGED;
      continue;
    }
    if (!jobJudged(gh, immutability.id, pr)) continue;
    return {
      immutability: jobVerdict(jobs, IMMUTABILITY_JOB),
      acceptance: jobVerdict(jobs, ACCEPTANCE_JOB),
    };
  }
  return NOT_JUDGED;
}

/**
 * Lane 06's verdict, re-read until its acceptance job stops being "still running" — see
 * `ACCEPTANCE_POLL_ATTEMPTS` for why only this half needs waiting for.
 *
 * Gives up on the attempt budget rather than on a clock, so a test drives it by counting reads
 * instead of by advancing time. Giving up leaves `acceptance` as `unjudged`, which the caller
 * refuses on — the direction that costs a merge that waits rather than a merge that should not
 * have happened.
 */
function awaitVerifyVerdict(gh: GhExec, headSha: string, pr: string, sleep: (ms: number) => void): VerifyVerdict {
  let verdict = readVerifyVerdict(gh, headSha, pr);
  for (let attempt = 0; verdict.acceptance === "unjudged" && attempt < ACCEPTANCE_POLL_ATTEMPTS; attempt++) {
    sleep(ACCEPTANCE_POLL_MS);
    verdict = readVerifyVerdict(gh, headSha, pr);
  }
  return verdict;
}

/**
 * Says on the pull request why lane 08 withheld the merge — ADR-0104, which amends ADR-0095's
 * "warns only" ruling now that lane 04 authors real tests and the job means something.
 *
 * Swallowed on failure, for the reason it always was: a comment that would not post must not change
 * what this lane decided. The decision is the refusal itself; this only explains it to whoever
 * opens the pull request next.
 */
function noteAcceptanceRefusal(gh: GhExec, pr: string, verdict: JobVerdict): void {
  const body = [
    `Lane 06's \`${ACCEPTANCE_JOB}\` job is **${verdict}** for this head commit, so lane 08 did not merge.`,
    "",
    verdict === "failed"
      ? "The slice's own acceptance tests, restored from trunk, do not pass against this diff — the ticket is not built."
      : "The job never reached a verdict within the window this lane waits, and an absent verdict is a refusal, never a pass (ADR-0054).",
    "",
    "Re-dispatch the pull request once the cause is dealt with; nothing retries this on its own.",
  ].join("\n");
  try {
    gh(["pr", "comment", pr, "--body", body]);
  } catch (err) {
    console.error(`could not note lane 06's acceptance verdict on ${pr}: ${reason(err)}`);
  }
}

/**
 * The merged pull request's own commits, as the `BASE..HEAD` string `bin/close-ticket` records in
 * the `## Closing record`.
 *
 * Read after the rebase and before the merge, which is the only window where both ends are true
 * locally: `origin/main` is the trunk `rebaseOntoTrunk` just fetched and rebased onto, and `HEAD`
 * is the rebased branch. `gh pr merge` moves trunk on the remote and this checkout never fetches
 * again, so asking afterwards would name a base that had already stopped being the merge's parent.
 */
function prCommitRange(git: GitExec): string {
  const base = git(["rev-parse", "origin/main"]).trim();
  const head = git(["rev-parse", "HEAD"]).trim();
  return `${base}..${head}`;
}

/** What `rebaseOntoTrunk` found: a branch now sitting on trunk, or the paths git could not replay. */
type RebaseOutcome = { conflicted: false } | { conflicted: true; paths: string[] };

/**
 * The paths git left unmerged, read out of the stopped rebase itself rather than out of its error
 * message. `git rebase`'s stderr is prose meant for a person and changes between versions; the
 * index is the fact.
 */
function conflictingPaths(git: GitExec): string[] {
  return git(["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Rebases `branch` onto current trunk and pushes the result back — the
 * "rebase the PR onto current trunk" half of this lane's whole job.
 *
 * A conflict used to propagate straight out of `runIntegrate` as an ordinary `git` failure, on the
 * scope line of the ticket that built this lane. With three lanes merging into `main` that is the
 * #183 disease (#234): the run goes red on a `git` error nobody is subscribed to, the pull request
 * stays green and open, and the ticket behind it never closes, because the lane that reacts to the
 * failure does not exist. So the conflict is returned rather than thrown, and the caller writes the
 * record.
 *
 * **Only a conflict is caught, and the index is what says so.** A rebase can also die on a bad ref,
 * a dirty tree or a failed fetch, and those leave nothing in `--diff-filter=U`. Reading any rebase
 * failure as a conflict would file the repository's own breakage as the pull request author's
 * problem, so a failure with no unmerged path is re-thrown exactly as it arrived.
 */
function rebaseOntoTrunk(git: GitExec, branch: string): RebaseOutcome {
  git(["fetch", "origin", "main", branch]);
  git(["checkout", branch]);
  try {
    git(["rebase", "origin/main"]);
  } catch (err) {
    const paths = conflictingPaths(git);
    if (paths.length === 0) throw err;
    // Read first, abort second: after the abort git has thrown the unmerged index away, and the
    // paths are the only thing the record has to say.
    git(["rebase", "--abort"]);
    return { conflicted: true, paths };
  }
  git(["push", "--force-with-lease", "origin", `HEAD:${branch}`]);
  return { conflicted: false };
}

/**
 * The record a conflict leaves: `needs-human` on the ticket, assigned to the owner, and a comment on
 * the pull request naming what would not replay. It was `blocked` on the pull request until
 * 2026-08-30 — a label this repo never created, so the `gh pr edit` threw and the one refusal that
 * is meant to leave a green run was leaving a red one with no record at all. The escalation is
 * `shared/needs-human.ts`'s, the same write the fixer and the recover lane make when they stop.
 *
 * Deliberately **not** swallowed the way `noteAcceptanceRefusal` is. That one explains a decision
 * that stands either way; this one *is* the outcome. A conflict with no label and no comment is the
 * silent stop this whole change exists to end, so a failure to write it fails the run.
 */
function blockOnConflict(gh: GhExec, pr: string, paths: string[], ticket: number | undefined, assignee: string | undefined): void {
  const body = [
    "**Blocked — rebase conflict.** Lane 08 could not replay this branch onto current trunk, so it",
    "aborted the rebase and merged nothing. No model ran and nothing here judged the diff.",
    "",
    "Conflicting paths:",
    "",
    ...paths.map((path) => `- \`${path}\``),
    "",
    "Rebase it by hand and re-dispatch the pull request; nothing retries this on its own.",
  ].join("\n");
  // A pull request with no `Closes #n` has no ticket to escalate; the comment is then the whole
  // record, as it was before.
  if (ticket !== undefined) escalateToOwner(gh, ticket, assignee);
  gh(["pr", "comment", pr, "--body", body]);
}

/** Merges `pr` — the one write this lane makes on a completed green run. */
function mergePr(gh: GhExec, pr: string): void {
  gh(["pr", "merge", pr, "--merge", "--delete-branch"]);
}

/** How much of `bin/close-ticket`'s own output the refusal comment carries. Same tail-not-head choice, and the same reason, as `shared/reason.ts`: a check runner prints its findings last, and an issue comment is capped at 65536 characters. */
const REFUSAL_TAIL = 4000;

/**
 * Says on the ticket that it merged and could not close — the "says so on it rather than going
 * red" half of #195. Without this the ticket is indistinguishable from one nobody has started,
 * which is the exact defect that ticket names; a run log nobody reads is not a record.
 */
function noteRefusal(gh: GhExec, ticket: number, pr: string, result: CloseTicketResult): void {
  const detail = result.output.trim().slice(-REFUSAL_TAIL);
  const body = [
    `Lane 08 merged ${pr} and could not close this ticket: \`bin/close-ticket\` exited ${result.exitCode}, so no \`## Closing record\` was posted and this stays open.`,
    "",
    "The merge stands — a criterion that did not check out does not un-land it. Re-run the same",
    "`bin/close-ticket` invocation once the criterion is satisfied; that is the whole recovery path.",
    "",
    "```",
    detail,
    "```",
  ].join("\n");
  gh(["issue", "comment", String(ticket), "--body", body]);
}

/**
 * Closes the ticket the merged pull request named, through the repository's own `bin/close-ticket`
 * — which fetches the ticket's criteria, runs each one's `check:` marker against this checkout,
 * posts the `## Closing record` and closes. Lane 08 supplies the arguments and interprets nothing:
 * whether the work is done is the criteria's answer, and this lane has no model in it to second-
 * guess them with.
 *
 * **Nothing in here may fail the lane.** It runs after `mergePr`, so by the time it is reached the
 * merge is on trunk and no exit code can take it back; a red lane on a run that merged correctly
 * would say the merge failed, and the next dispatch would try it again. So every path returns a
 * `ClosingOutcome` — including a throw from the seam or from the comment, which is reported to
 * stderr and read as a refusal, since the observable state is the same either way: ticket open.
 */
function closeMergedTicket(deps: IntegrateDeps, ticket: number | undefined, range: string): ClosingOutcome {
  if (ticket === undefined) return { closed: false, reason: "no-ticket" };
  try {
    const result = deps.closeTicket(ticket, range);
    if (result.exitCode === 0) return { closed: true, ticket };
    noteRefusal(deps.gh, ticket, deps.pr, result);
  } catch (err) {
    console.error(`could not close #${ticket}: ${reason(err)}`);
  }
  return { closed: false, reason: "refused", ticket };
}

/**
 * The whole flow: read the PR's branch, rebase it onto current trunk,
 * re-run the gauntlet against the rebased tree, read lane 06's verdict on the same head commit,
 * merge only when this lane's own run *completed* reporting green and lane 06 completed saying the
 * immutable set was not crossed — then ring the doorbell, and finish the ticket the merge
 * delivered.
 *
 * **A rebase conflict ends the run here, with a record instead of a stack trace** (#234). It is
 * checked first because it is the one refusal that costs nothing to find: the branch never reached
 * trunk, so there is no rebased tree for the gauntlet to have an opinion about, and every minute
 * spent below this point would be spent on a diff that does not exist yet.
 *
 * **Lane 06's verdict is read last, immediately before the merge, and that ordering is the whole
 * reason this works** (#197). `verify.yml` and `integrate.yml` fire on the same dispatch, in
 * parallel; lane 06's `Immutability` job is a checkout-free string comparison that finishes in
 * seconds, while everything above this read — a checkout, an `npm ci`, a rebase and a full
 * `bin/gauntlet push` — takes minutes. Reading before the rebase would race a lane that has not
 * started, and a race that lands on `"unjudged"` refuses every pull request in the fleet. The cost
 * of reading late is a gauntlet run spent on a diff the immutable-set alarm was going to refuse,
 * which is a few runner-minutes on the rarest event this pipeline has.
 *
 * **Both of lane 06's jobs now bind** (ADR-0104). `Restore and run acceptance` used to be waved
 * through — it was red for every pull request while lane 04's first-authoring was unwired (#201),
 * so binding on it would have stopped the chain rather than caught anything (ADR-0095). Lane 04
 * authors real tests now, so the job means what its name says and a red one is a slice that is not
 * built. Its verdict is *waited for* rather than merely read, because unlike `Immutability` it runs
 * on the same order of minutes this lane does — see `ACCEPTANCE_POLL_ATTEMPTS`.
 *
 * **The close comes last, and it does not wait for lane 07** (#195,
 * [ADR-0094](../../../docs/adr/0094-lane-08-closes-the-ticket-it-merged-and-a-ticket-that-will-n.md)).
 * Lane 07 reviews the pull request off the same dispatch and may still be reviewing one this lane
 * has already merged; its verdict is advice on a diff, and it cannot change what a criterion's
 * `check:` command observes. Waiting for it would hold a model's latency inside the `integrate`
 * concurrency group — the merge lock — which is the one thing this lane's single fixed group
 * exists to keep short. No longer ahead of the doorbell: ADR-0115 reversed the ordering
 * ADR-0094 chose here. The doorbell announces "a blocker just closed", so it rings after the close
 * or it announces something false — the reconciler read the stale graph and re-dispatched every
 * merged ticket while withholding its successors (#279).
 *
 * **The doorbell interprets nothing** (#179). A merge is what makes some other slice's last
 * blocker deliver, and this is the only thing that knows a merge happened. It says so and stops
 * there: no dependencies read, no tracker read, no promotion. #178 proposed this lane promote its
 * successors and accepted a second lane reasoning about the graph as the cost of putting the
 * sender at the merge; that cost does not have to be paid. `dispatch/reconcile.ts` is the reader,
 * it writes nothing to the graph, and
 * [ADR-0069](../../../docs/adr/0069-the-dependency-graph-is-lane-03-s-output-and-read-only-downs.md)
 * is applied rather than amended.
 *
 * Sent after the merge and the close, never before either (ADR-0115), and its failure is nobody's problem: the reconciler also
 * rides `session-captured`, so a doorbell that never rings costs latency, not the wave.
 *
 * Deliberately not a `Promise` — every step here is synchronous (`git`,
 * `gh`, and the real `runGauntlet` all shell out and block), so nothing
 * downstream has to `await` a lane with no model in it.
 */
export function runIntegrate(deps: IntegrateDeps): IntegrateOutcome {
  const pullRequest = readPr(deps.gh, deps.pr);
  const rebase = rebaseOntoTrunk(deps.git, pullRequest.branch);
  if (rebase.conflicted) {
    blockOnConflict(deps.gh, deps.pr, rebase.paths, pullRequest.ticket, deps.assignee);
    return { merged: false, reason: "conflict", paths: rebase.paths };
  }
  const range = prCommitRange(deps.git);

  const result = deps.runGauntlet();
  if (result.exitCode === 1) return { merged: false, reason: "red" };
  if (result.exitCode !== 0) return { merged: false, reason: "no-run" };

  const verdict = awaitVerifyVerdict(deps.gh, deps.headSha, deps.pr, deps.sleep ?? sleepSync);
  if (verdict.immutability === "failed") return { merged: false, reason: "immutable-set" };
  if (verdict.immutability !== "passed") return { merged: false, reason: "unjudged" };
  if (verdict.acceptance === "failed") {
    noteAcceptanceRefusal(deps.gh, deps.pr, verdict.acceptance);
    return { merged: false, reason: "acceptance" };
  }
  if (verdict.acceptance !== "passed") {
    noteAcceptanceRefusal(deps.gh, deps.pr, verdict.acceptance);
    return { merged: false, reason: "unjudged" };
  }

  mergePr(deps.gh, deps.pr);
  // Close before the doorbell: readiness is defined as every blocker closed (`shared/ready-set.ts`),
  // so a doorbell rung first announces a graph that is not yet true — every merge re-dispatched the
  // ticket it had just merged and withheld its successors (#279; ADR-0115, amending ADR-0094).
  const closing = closeMergedTicket(deps, pullRequest.ticket, range);
  announceGraphChanged(deps.gh, deps.pr);
  return { merged: true, closing };
}

/**
 * The real `runGauntlet`: shells to `bin/gauntlet push` in the current
 * working directory (the rebased checkout `rebaseOntoTrunk` just produced)
 * and classifies its exit code. Never reads stdout/stderr for a verdict —
 * the exit code is the whole contract `bin/gauntlet`'s own header states,
 * the same contract `verify.yml`'s "Run gauntlet" step reads.
 */
export function runRealGauntlet(): GauntletResult {
  try {
    execFileSync("bin/gauntlet", ["push"], { encoding: "utf8", env: childEnv() });
    return { exitCode: 0 };
  } catch (err) {
    // The exit code is still the whole verdict. The output is forwarded because a refusal that says
    // only `not merged (red)` is a red nobody can act on: run 33325622921 refused PR #281 on a
    // gauntlet that was green on the same tree at every other venue, and the log held no clue
    // which of its eight checks disagreed. `bin/gauntlet` prints one `--- name ---` section per
    // failed check; that is what a reader of this run needs, and it costs nothing to keep.
    const failure = err as { status?: number | null; stdout?: string; stderr?: string };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim();
    if (output) console.error(output);
    return { exitCode: failure.status === 1 ? 1 : 2 };
  }
}

/**
 * The real `closeTicket`: shells to **this repository's own** `bin/close-ticket` — never the copy
 * in `~/.agents/skills/bin`, which is a different, older program — with the runner's checkout as
 * the tree the criteria run against. That checkout is already the merged content with dependencies
 * installed, which is what makes a criterion like `npx vitest run …` mean anything here.
 *
 * The argv is the whole of this lane's contribution; the spawn and its output folding live in
 * `shared/close-ticket.ts`, which lane 09's `--spec` closer reaches through too.
 */
export function runRealCloseTicket(ticket: number, range: string): CloseTicketResult {
  return closeTicketProcess([String(ticket), range, "."]);
}

/** One line naming what became of the ticket, for the runner log — the lane's exit code says only whether the merge happened. */
function describeClosing(closing: ClosingOutcome, pr: string): string {
  if (closing.closed) return `closed #${closing.ticket}`;
  if (closing.reason === "refused") return `#${closing.ticket} stays open: bin/close-ticket refused, noted on the ticket`;
  return `nothing to close: ${pr} names no ticket`;
}

async function main(): Promise<void> {
  const pr = process.argv[2];
  // Required, never defaulted: without the head commit there is no way to find lane 06's run, and a
  // lane that silently skipped the verdict read is the defect #197 was filed on.
  const headSha = process.argv[3];
  if (!pr || !headSha) {
    console.error("usage: integrate.ts <pr> <head-sha>");
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = runIntegrate({
      git: execGit,
      gh: execGh,
      pr,
      headSha,
      runGauntlet: runRealGauntlet,
      closeTicket: runRealCloseTicket,
      assignee: process.env.SIGNAL_ASSIGNEE,
    });

    if (!outcome.merged) {
      console.error(`not merged (${outcome.reason}): ${pr}`);
      // A rebase conflict is the one refusal that leaves the run green. The ticket carries
      // `needs-human` and the pull request a comment naming every path that would not replay, which is the whole account
      // — and a red run beside that record would say the merge actor broke rather than that trunk
      // moved. Every other refusal still reddens, because each of those is a verdict on the diff.
      if (outcome.reason !== "conflict") process.exitCode = 1;
      return;
    }
    // Green whatever became of the ticket: the exit code is this lane's verdict on the *merge*,
    // and the merge landed (see `closeMergedTicket`).
    console.log(`merged ${pr} — ${describeClosing(outcome.closing, pr)}`);
  } catch (err) {
    console.error(`integrate failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
