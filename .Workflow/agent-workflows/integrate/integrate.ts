import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { childEnv } from "../shared/child-env";
import { VERIFY_DISPATCH_EVENT_TYPE } from "../implement/implement";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
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
 * One `bin/close-ticket` invocation's outcome. Exit `0` is the only shape that closed anything:
 * the record posted and the ticket closed. Every other exit means the ticket is still open —
 * a criterion's `check:` command failed, the body's criteria came back every-one-unverified
 * (the refusal #215 landed: zero of any number is not evidence), or the script could not run at
 * all. Those are one case here on purpose: they differ in cause and not in consequence, and the
 * consequence — the ticket stays open, said so on the ticket — is the whole decision this lane
 * makes. Nothing downstream branches on the cause, so nothing downstream is offered it.
 */
export interface CloseTicketResult {
  exitCode: number;
  /** Everything the invocation said, stdout and stderr folded together. Quoted back onto the ticket when it refuses — that text names the criterion that did not check out, and nobody is watching this run's log. */
  output: string;
}

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
  | { merged: false; reason: "no-run" };

export interface IntegrateDeps {
  git: GitExec;
  gh: GhExec;
  /** The PR this run integrates, as `gh` accepts it — a number, a URL, or `OWNER/REPO#123`. Same identifier `implement.ts`'s `openPrAndDispatch` names in its dispatch payload. */
  pr: string;
  /** Re-runs the gauntlet against the rebased tree. Real production behaviour shells to `bin/gauntlet push`; a test injects a canned result instead of paying for a real run. */
  runGauntlet: () => GauntletResult;
  /** Closes `ticket` against `range`. Real production behaviour shells to this repository's own `bin/close-ticket` (`runRealCloseTicket`); a test injects a canned result rather than paying for a tracker write and the ticket's own checks. */
  closeTicket: (ticket: number, range: string) => CloseTicketResult;
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

/**
 * Rebases `branch` onto current trunk and pushes the result back — the
 * "rebase the PR onto current trunk" half of this lane's whole job. A
 * rebase conflict surfaces as an ordinary `git` failure and propagates
 * straight out of `runIntegrate`; no conflict-resolution logic is added
 * here (the ticket's own scope line).
 */
function rebaseOntoTrunk(git: GitExec, branch: string): void {
  git(["fetch", "origin", "main", branch]);
  git(["checkout", branch]);
  git(["rebase", "origin/main"]);
  git(["push", "--force-with-lease", "origin", `HEAD:${branch}`]);
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
 * re-run the gauntlet against the rebased tree, merge only when that
 * run *completed* reporting green — then ring the doorbell, and finish
 * the ticket the merge delivered.
 *
 * **The close comes last, and it does not wait for lane 07** (#195,
 * [ADR-0094](../../../docs/adr/0094-lane-08-closes-the-ticket-it-merged-and-a-ticket-that-will-n.md)).
 * Lane 07 reviews the pull request off the same dispatch and may still be reviewing one this lane
 * has already merged; its verdict is advice on a diff, and it cannot change what a criterion's
 * `check:` command observes. Waiting for it would hold a model's latency inside the `integrate`
 * concurrency group — the merge lock — which is the one thing this lane's single fixed group
 * exists to keep short. Behind the doorbell for the same reason: the criteria checks are the
 * ticket author's own commands and can take minutes, and a successor whose last blocker just
 * landed should not queue behind them.
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
 * Sent after the merge and never before, and its failure is nobody's problem: the reconciler also
 * rides `session-captured`, so a doorbell that never rings costs latency, not the wave.
 *
 * Deliberately not a `Promise` — every step here is synchronous (`git`,
 * `gh`, and the real `runGauntlet` all shell out and block), so nothing
 * downstream has to `await` a lane with no model in it.
 */
export function runIntegrate(deps: IntegrateDeps): IntegrateOutcome {
  const pullRequest = readPr(deps.gh, deps.pr);
  rebaseOntoTrunk(deps.git, pullRequest.branch);
  const range = prCommitRange(deps.git);

  const result = deps.runGauntlet();

  if (result.exitCode === 0) {
    mergePr(deps.gh, deps.pr);
    announceGraphChanged(deps.gh, deps.pr);
    return { merged: true, closing: closeMergedTicket(deps, pullRequest.ticket, range) };
  }
  if (result.exitCode === 1) {
    return { merged: false, reason: "red" };
  }
  return { merged: false, reason: "no-run" };
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
    const status = (err as { status?: number | null }).status;
    return { exitCode: status === 1 ? 1 : 2 };
  }
}

/**
 * The real `closeTicket`: shells to **this repository's own** `bin/close-ticket` — never the copy
 * in `~/.agents/skills/bin`, which is a different, older program — with the runner's checkout as
 * the tree the criteria run against. That checkout is already the merged content with dependencies
 * installed, which is what makes a criterion like `npx vitest run …` mean anything here.
 *
 * `spawnSync` rather than `execFileSync`: the refusal path needs the output, and `execFileSync`
 * splits it across a thrown `Error`'s message and a `stdout` field. `close-ticket` writes its
 * verdict to stderr and its record to stdout, so both halves are folded together here.
 */
export function runRealCloseTicket(ticket: number, range: string): CloseTicketResult {
  const result = spawnSync("bin/close-ticket", [String(ticket), range, "."], {
    encoding: "utf8",
    env: childEnv(),
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? result.error.message : ""}`;
  // A spawn that never ran has a null status; it did not close the ticket, which is all the
  // caller decides on (see `CloseTicketResult`).
  return { exitCode: result.status ?? 1, output };
}

/** One line naming what became of the ticket, for the runner log — the lane's exit code says only whether the merge happened. */
function describeClosing(closing: ClosingOutcome, pr: string): string {
  if (closing.closed) return `closed #${closing.ticket}`;
  if (closing.reason === "refused") return `#${closing.ticket} stays open: bin/close-ticket refused, noted on the ticket`;
  return `nothing to close: ${pr} names no ticket`;
}

async function main(): Promise<void> {
  const pr = process.argv[2];
  if (!pr) {
    console.error("usage: integrate.ts <pr>");
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = runIntegrate({
      git: execGit,
      gh: execGh,
      pr,
      runGauntlet: runRealGauntlet,
      closeTicket: runRealCloseTicket,
    });

    if (!outcome.merged) {
      console.error(`not merged (${outcome.reason}): ${pr}`);
      process.exitCode = 1;
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
