import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BASELINE_RELATIVE_PATH, runCloneGate } from "./clone-gate.ts";

/**
 * The clone-gate baseline as a `regenerate && diff` artifact (ADR-0056), in the CLI shape
 * `generate-contract.ts` and `generate-corpus-fixture.ts` already have, so lane 05's
 * `regenerate-artifacts.ts` and `bin/gauntlet` can treat it as one more of the same.
 *
 * Why the baseline is on that list when the wiring baseline is deliberately not: both "only ever
 * shrink", but they shrink for opposite reasons. A wiring entry disappears when someone *wires* the
 * code, which nobody should be able to do by regeneration. A clone entry disappears when the clone
 * itself is gone — the implementer paid the debt — and the only thing left to do is delete the
 * receipt. `--prune-baseline` cannot add an entry, so regenerating it lets no new duplicate through;
 * it only stops a run being refused for having *removed* one. Implement run 33324207385 (#273) died
 * at its push on exactly that: one baseline entry that no longer reproduced, in a file it had just
 * deduplicated, forty minutes in.
 *
 * Since ADR-0116 it also carries a **re-cut** entry — the same clone, in the same files, reported
 * over a different span of text because a comment inside it changed or the match grew through
 * content beside it. That is still not an add: one entry is substituted for one, and the count
 * cannot rise. Without it a tolerated clone wedged every nearby edit, which is #282.
 *
 * `node prune-clone-baseline.ts <root>`               prunes; exit 0 unless the gate could not run.
 * `node prune-clone-baseline.ts diff <root> <path>`   the scan with no write — exit 1 on a stale
 *                                                      entry *or* an unbaselined clone, which is
 *                                                      what `bin/clone-gate` says too. `<path>` is
 *                                                      accepted for the family's shape and checked
 *                                                      against the one baseline the gate reads.
 */
export const CLONE_BASELINE_PATH = BASELINE_RELATIVE_PATH;

export function pruneCloneBaseline(root: string): number {
  return runCloneGate(resolve(root), ["--prune-baseline"]);
}

export function diffCloneBaseline(root: string, committedPath: string): number {
  if (resolve(root, committedPath) !== resolve(root, CLONE_BASELINE_PATH)) {
    console.error(`prune-clone-baseline: the gate reads ${CLONE_BASELINE_PATH}, not ${committedPath}`);
    return 2;
  }
  return runCloneGate(resolve(root), []);
}

// `pathToFileURL(process.argv[1])` rather than a hand-built `file://` — this repo's own checkout
// path has a space in it, and the naive form loses the percent-encoding.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const [mode, ...rest] = process.argv.slice(2);
  const diffing = mode === "diff";
  const [root = process.cwd(), committedPath] = diffing ? rest : [mode];
  if (diffing && !committedPath) {
    console.error("usage: prune-clone-baseline.ts diff <root> <baselinePath>");
    process.exit(2);
  }
  process.exit(diffing ? diffCloneBaseline(root, committedPath as string) : pruneCloneBaseline(root));
}
