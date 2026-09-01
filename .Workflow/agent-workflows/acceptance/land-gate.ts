import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { childEnv } from "../shared/child-env";
import { BASELINE_RELATIVE_PATH, repairAcceptanceBaseline, type AcceptanceRepairOutcome } from "../shared/clone-gate";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { ACCEPTANCE_TEST_DIR } from "./acceptance";

/**
 * The gate `land` (`.github/workflows/acceptance.yml`) runs on the fully rebased tree, right before
 * `git push origin HEAD:main` — the one gap #274 fell through. `push-gate.ts` judges a freshly
 * authored suite in isolation, against `npx vitest run <dir>` and eslint over the files it wrote;
 * nothing in that job ever ran the clone gate, and the `land` job that does the actual push ran no
 * check at all. A `GITHUB_TOKEN` push fires no `Verify` run either (ADR-0053's whole reason for
 * being no-exemption also makes it invisible), so main went red on `bin/clone-gate` for an hour
 * with nobody watching — and the first the pipeline heard of it was #272's implementer losing a
 * push to a duplicate in two files it is forbidden to touch.
 *
 * **Judged by the same gauntlet a human push is, not a second mechanism.** `bin/gauntlet push` is
 * exactly what `.husky/pre-push` runs on a workstation, so reusing it here — rather than
 * hand-rolling a second "does this pass" for the acceptance lane — is what keeps this lane's bar
 * identical to everyone else's. One thing it does not cover: rule 6 of `docs/agents/clone-gate.md`
 * keeps the clone gate out of every `bin/gauntlet` venue on purpose (it is a several-second scan,
 * and `stop` reuses the same `test` slot `push` does — see `bin/gauntlet`'s own `GAUNTLET_VENUE`
 * comment), so `npm run check`, not `bin/gauntlet push` alone, is what a human's pre-push hook
 * actually runs. This function runs both halves explicitly: `bin/gauntlet push` first, and
 * `repairAcceptanceBaseline` — this lane's own targeted clone-gate call — second, so the one
 * mechanical repair this lane is allowed to make sits in front of a real clone-gate run rather than
 * beside a second, looser one.
 *
 * **The repair, and why it stops where it stops.** `repairAcceptanceBaseline` (`../shared/clone-gate.ts`)
 * baselines a clone only when every file on both sides of it is under `tests/acceptance/` — this
 * lane's own output, immutable to every pull request, so nobody else could ever have deduped it.
 * Anything else red — a real clone touching a file outside that directory, or any other
 * `bin/gauntlet push` finding — refuses the whole push. `CONTEXT.md`'s **Gate bypass** is defined by
 * what reaches `main`, not by how much of the batch was fixable, so this never pushes a tree with
 * *some* of its findings silently left unrepaired.
 */

/** What one run of the gate decided. */
export type LandGateOutcome =
  | { verdict: "clear" }
  | { verdict: "repaired"; added: number; carried: number }
  | { verdict: "refused"; reason: string };

export interface LandGateDeps {
  /** `bin/gauntlet push` against the tree at `cwd` — everything but the clone gate (see the header). */
  runGauntletPush: () => { ok: true } | { ok: false; report: string };
  /** Injected so a test can hand this a scratch tree instead of scanning the real repo. */
  repairAcceptanceBaseline: () => AcceptanceRepairOutcome;
  git: GitExec;
  /**
   * Reaches a reader when this refuses — the one push in this pipeline that fires no `Verify` run
   * (ADR-0053), so a refusal that only printed to the job log would be exactly the silent-red-main
   * hole this exists to close. Defaults to commenting on `issueNumber` via `gh`; a no-op when
   * `issueNumber` is `undefined`, which a caller with nowhere to write should not have to fake.
   */
  reportRefusal: (message: string) => void;
  /**
   * Reaches the same reader when this *repairs* rather than refuses.
   *
   * A repair is the quieter half of the same silence. `repairAcceptanceBaseline` absorbs a clone
   * found entirely inside `tests/acceptance/` and lets the push through, correctly — nobody but
   * lane 04 may ever edit that directory, so nobody else could have deduped it — but the absorption
   * is unattended, unreviewed, and lands on `main` with no `Verify` run behind it. Its only trace
   * was a baseline file growing by a few entries per authoring run. A machine that may add to a
   * ratchet without asking should at least say what it added.
   */
  reportRepair: (message: string) => void;
}

/** CLAUDE.md: why, not what. */
function repairCommitMessage(added: number, carried: number): string {
  const recut =
    carried === 0
      ? ""
      : `\n\n${carried} of the entries changed fingerprint without the duplication changing: jscpd re-cut a
clone this lane already carried, because content beside it became shared (#282). Those are
substituted one for one, never added to.`;
  return `Baseline ${added} clone(s) between this lane's own acceptance tests

tests/acceptance/ is immutable to every pull request, so a clone found entirely inside it is
lane 04's own overlap and nobody else could ever have deduped it — mechanical, not a judgement
call, and the same reasoning that already carries #261's overlap with #274's
(see clone-gate.baseline.json's own history). Baselined here, before the push, so main never
carries a tree bin/clone-gate refuses.${recut}

Part of #162`;
}

/**
 * Runs `deps.runGauntletPush`, then `deps.repairAcceptanceBaseline`, and returns what may reach
 * `main`. Never touches git except to commit a baseline repair — the push itself is the caller's
 * (`land`'s own `git push origin HEAD:main`, run only when this returns `"clear"` or `"repaired"`).
 */
export function runLandGate(deps: LandGateDeps): LandGateOutcome {
  const gauntlet = deps.runGauntletPush();
  if (!gauntlet.ok) {
    const message = `bin/gauntlet push refused this batch before it reached main:\n${gauntlet.report}`;
    deps.reportRefusal(message);
    return { verdict: "refused", reason: message };
  }

  const repair = deps.repairAcceptanceBaseline();
  if (repair.verdict === "refused") {
    deps.reportRefusal(repair.reason);
    return repair;
  }
  if (repair.verdict === "clean") {
    return { verdict: "clear" };
  }

  deps.git(["add", BASELINE_RELATIVE_PATH]);
  deps.git(["commit", "-m", repairCommitMessage(repair.added, repair.carried)]);
  deps.reportRepair(
    `This lane baselined ${repair.added} clone(s) among its own acceptance tests and pushed, ` +
      `carrying ${repair.carried} across a re-cut. Nothing was deduplicated — the duplication is ` +
      `still there, and ${BASELINE_RELATIVE_PATH} now measures tests/acceptance/ by that much ` +
      `less. Only lane 04 writes that directory, so only lane 04's author prompt can stop it ` +
      `growing.\n\n${repair.report}`,
  );
  return repair;
}

/** The real `runGauntletPush`: shells out to the script every venue runs. */
function runGauntletPushReal(root: string): { ok: true } | { ok: false; report: string } {
  try {
    // Absolute, not `"bin/gauntlet"` relative to `cwd` — `execFileSync` resolves a path containing a
    // `/` against the calling process's own working directory, not the `cwd` option, on a relative
    // spelling.
    execFileSync(join(root, "bin/gauntlet"), ["push"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, report: reason(err) };
  }
}

/**
 * The real reporters: one comment on the ticket the push was for, via `gh`.
 *
 * One factory for both outcomes rather than two near-identical ones — they differ in the sentence
 * that opens the comment and in whether the console line is an error, and in nothing else.
 */
function reportToTicket(
  gh: GhExec,
  issueNumber: number | undefined,
  kind: { label: string; opener: string; toStderr: boolean },
): (message: string) => void {
  return (message) => {
    const console_ = kind.toStderr ? console.error : console.log;
    console_(`land gate: ${kind.label} —\n${message}`);
    if (issueNumber === undefined || !Number.isFinite(issueNumber)) return;
    try {
      gh([
        "issue",
        "comment",
        String(issueNumber),
        "--body",
        `${kind.opener}\n\n\`\`\`\n${message}\n\`\`\``,
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
  // has to judge and `git push origin HEAD:main` has already targeted — the same seam `shape.ts`,
  // `run-audit.ts` and `run-accept.ts` read for the same reason. Falling back to `process.cwd()` is
  // what lets a local run (or a test driving this file as a real subprocess) hand in a different
  // one without needing to run from inside it too.
  const root = process.env.TARGET_WORKSPACE || process.cwd();
  const issueEnv = process.env.ISSUE_NUMBER;
  const issueNumber = issueEnv ? Number(issueEnv) : undefined;

  const outcome = runLandGate({
    runGauntletPush: () => runGauntletPushReal(root),
    repairAcceptanceBaseline: () => repairAcceptanceBaseline(root, ACCEPTANCE_TEST_DIR),
    git: execGit,
    reportRefusal: reportToTicket(execGh, issueNumber, {
      label: "refused",
      opener: "This lane's push to `main` was refused before it happened — nothing landed.",
      toStderr: true,
    }),
    reportRepair: reportToTicket(execGh, issueNumber, {
      label: "repaired",
      opener:
        "This lane pushed to `main` after quietly widening the clone baseline for its own tests.",
      toStderr: false,
    }),
  });

  if (outcome.verdict === "refused") {
    process.exitCode = 1;
    return;
  }
  console.log(
    outcome.verdict === "repaired"
      ? `land gate: baselined ${outcome.added} clone(s) among this lane's own output, carried ${outcome.carried} across a re-cut`
      : "land gate: clear",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
