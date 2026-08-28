import { execFileSync } from "node:child_process";
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

export type IntegrateOutcome =
  | { merged: true }
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
}

/** The PR's own head branch name, read through `gh` — the one read this lane makes before it writes anything. */
function prHeadBranch(gh: GhExec, pr: string): string {
  const raw = gh(["pr", "view", pr, "--json", "headRefName", "--jq", ".headRefName"]);
  return raw.trim();
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

/**
 * The whole flow: read the PR's branch, rebase it onto current trunk,
 * re-run the gauntlet against the rebased tree, merge only when that
 * run *completed* reporting green — and then ring the doorbell.
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
  const branch = prHeadBranch(deps.gh, deps.pr);
  rebaseOntoTrunk(deps.git, branch);

  const result = deps.runGauntlet();

  if (result.exitCode === 0) {
    mergePr(deps.gh, deps.pr);
    announceGraphChanged(deps.gh, deps.pr);
    return { merged: true };
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
    });

    if (!outcome.merged) {
      console.error(`not merged (${outcome.reason}): ${pr}`);
      process.exitCode = 1;
      return;
    }
    console.log(`merged ${pr}`);
  } catch (err) {
    console.error(`integrate failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
