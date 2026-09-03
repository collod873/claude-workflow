/**
 * Finding one job by name on an Actions run, in a world where the run might have been reached
 * through `uses:` (ADR-0055, amended by ADR-0132).
 *
 * A run reached through `uses:` is recorded against the **caller's** file, and every job in it
 * comes back named `<caller job key> / <job name>` rather than the bare name the reusable
 * workflow's own `jobs.<key>.name:` declares — confirmed on run 33649164483, where every job of
 * `verify-caller.yml` reports as `verify / Immutability`, `verify / Verify`,
 * `verify / Signal the fixer`. Every lane in this pipeline
 * now has that shape, so code that matched a job by bare `===` stopped matching the moment its
 * caller stub started carrying the trigger.
 *
 * One shared matcher, so the fix is made once rather than once per reader — `integrate.ts` and
 * `bin/close-ticket` both look up `Immutability` and `Verify` on the same
 * `verify.yml` jobs list, and a matcher restated at each call site could drift from the other.
 */
export function findJobByName<T extends { name: string }>(
  jobs: readonly T[],
  wanted: string,
): T | undefined {
  return jobs.find((job) => job.name === wanted || job.name.endsWith(` / ${wanted}`));
}
