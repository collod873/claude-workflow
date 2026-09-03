import type { GitExec } from "./git";

/**
 * Where the ratifier lane last stopped — read by both of its doors. `ratify/run-ratify.ts` scopes
 * a batch from it, and `observations/run-audit.ts` reads the same ref to decide whether enough
 * work has landed since to ring the ratifier's bell. Two lanes, one fact, so it lives in `shared/`
 * rather than one lane reaching into the other for it.
 */

/**
 * The plain ref recording where the last ratifier run stopped — read as the
 * scope's `base`, absent before the first run (which `computeRatificationScope`
 * already treats as "scope from the repo root").
 *
 * **Advanced on every completed run, not only when a pull request opens.** A
 * rejected finding writes a `declined` record, so re-reading old scope would
 * only re-filter the same findings out again; advancing keeps scope bounded
 * and costs nothing a rejection did not already decide.
 *
 * A plain ref rather than a notes ref, for the reason its predecessor gave:
 * this is one fact about the pipeline's own state, with no commit to key it
 * to other than the value it points at.
 */
export const LAST_RATIFIER_REF = "refs/ratifier/last";

/** The ref the deleted release channel used, read once to seed `LAST_RATIFIER_REF` and then deleted. */
export const LEGACY_RATIFIER_REF = "refs/release/last";

/** Reads a plain ref, or `undefined` when it does not exist. */
export function readRef(git: GitExec, repoDir: string, ref: string): string | undefined {
  try {
    return git(["-C", repoDir, "rev-parse", "--verify", "--quiet", ref]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where this run scopes from: `refs/ratifier/last` if it exists, otherwise
 * whatever `refs/release/last` still points at.
 *
 * The seed is a read, not a copy — nothing here writes the new ref, because
 * the advance at the end of the run does that anyway and a seed written
 * before the run would claim a scope the run had not covered yet. The legacy
 * ref's deletion is `ratify.yml`'s, once the advance has published a real one.
 */
export function readRatifierBase(git: GitExec, repoDir: string): string | undefined {
  return readRef(git, repoDir, LAST_RATIFIER_REF) ?? readRef(git, repoDir, LEGACY_RATIFIER_REF);
}
