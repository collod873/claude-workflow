import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import { runGauntlet } from "../shared/run-gauntlet";

/**
 * The gate `land` (`.github/workflows/acceptance.yml`) runs on the fully rebased tree, right before
 * `git push origin HEAD:main` — the one gap #274 fell through. `push-gate.ts` judges a freshly
 * authored suite in isolation; nothing in that job ever ran the whole gate, and the `land` job that
 * does the actual push ran no check at all. A `GITHUB_TOKEN` push fires no `Verify` run either
 * (ADR-0053), so main went red for an hour with nobody watching.
 *
 * Judged by the same gauntlet a human push is, not a second mechanism: `bin/gauntlet push` is
 * exactly what `.husky/pre-push` runs on a workstation.
 */

/** What one run of the gate decided. */
export type LandGateOutcome = { verdict: "clear" } | { verdict: "refused"; reason: string };

export interface LandGateDeps {
  /** `bin/gauntlet push` against the tree at `cwd`. */
  runGauntletPush: () => { ok: true } | { ok: false; report: string };
  /**
   * Reaches a reader when this refuses — the one push in this pipeline that fires no `Verify` run
   * (ADR-0053), so a refusal that only printed to the job log would be exactly the silent-red-main
   * hole this exists to close. Defaults to commenting on `issueNumber` via `gh`.
   */
  reportRefusal: (message: string) => void;
}

/** Runs `deps.runGauntletPush` and returns whether the tree may reach `main`. Never touches git. */
export function runLandGate(deps: LandGateDeps): LandGateOutcome {
  const gauntlet = deps.runGauntletPush();
  if (!gauntlet.ok) {
    const message = `the push venue refused this batch before it reached main:\n${gauntlet.report}`;
    deps.reportRefusal(message);
    return { verdict: "refused", reason: message };
  }
  return { verdict: "clear" };
}

/** The real `runGauntletPush`: the MACHINE's `bin/gauntlet push`, judging `root` (ADR-0139). */
function runGauntletPushReal(root: string): { ok: true } | { ok: false; report: string } {
  try {
    runGauntlet("push", root);
    return { ok: true };
  } catch (err) {
    return { ok: false, report: reason(err) };
  }
}

/** The real reporter: one comment on the ticket the push was for, via `gh`. */
function reportToTicket(gh: GhExec, issueNumber: number | undefined): (message: string) => void {
  return (message) => {
    console.error(`land gate: refused —\n${message}`);
    if (issueNumber === undefined || !Number.isFinite(issueNumber)) return;
    try {
      gh([
        "issue",
        "comment",
        String(issueNumber),
        "--body",
        `This lane's push to \`main\` was refused before it happened — nothing landed.\n\n\`\`\`\n${message}\n\`\`\``,
      ]);
    } catch (err) {
      // A failed comment must not turn a refusal into a silent one at the process level either —
      // the workflow step still exits non-zero (main below), which is what actually stops the push.
      console.error(`land gate: could not comment on #${issueNumber}: ${reason(err)}`);
    }
  };
}

async function main(): Promise<void> {
  // `TARGET_WORKSPACE` is set only by the reusable workflow (#315, ADR-0055): the machine checkout
  // this script runs from is a different directory than the target checkout `bin/gauntlet push`
  // has to judge and `git push origin HEAD:main` has already targeted.
  const root = process.env.TARGET_WORKSPACE || process.cwd();
  const issueEnv = process.env.ISSUE_NUMBER;
  const issueNumber = issueEnv ? Number(issueEnv) : undefined;

  const outcome = runLandGate({
    runGauntletPush: () => runGauntletPushReal(root),
    reportRefusal: reportToTicket(execGh, issueNumber),
  });

  if (outcome.verdict === "refused") {
    process.exitCode = 1;
    return;
  }
  console.log("land gate: clear");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
