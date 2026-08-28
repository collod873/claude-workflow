/**
 * The three things a pull request may never touch — [ADR-0053](../../../docs/adr/0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md)
 * and [ADR-0054](../../../docs/adr/0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)
 * name exactly these three, for the same reason each time: a hole one level up from the obvious
 * boundary.
 *
 * `tests/acceptance/**` is not a boundary on its own — `vitest.config.ts` carries an explicit
 * `include` allowlist, so an implementer can leave every acceptance test byte-identical and
 * delete one line there to stop them running. `.github/` closes the same hole one level higher:
 * on a `pull_request` event GitHub runs the workflow file *from the pull request*, so an
 * implementer that never touches a test at all can delete the job that would have caught it.
 * `repository_dispatch` (ADR-0054) is the guarantee that closes that hole; this module, and the
 * Immutability job in `verify.yml` that reads it, is the alarm.
 */

/** The closed set, in the order ADR-0053 states it. Nothing outside this file revisits `.length`. */
export const IMMUTABLE_SET = ["tests/acceptance/", "vitest.config.ts", ".github/"] as const;

/**
 * The `github.event.action` value the Immutability job in `.github/workflows/verify.yml` gates
 * on — spelled here as well as in that job's `if:`, the same split `WATCHDOG_DISPATCH_ACTION` and
 * its siblings hold to, so `immutable-set.test.ts` can assert the two agree rather than trusting
 * that they were typed the same twice.
 */
export const IMMUTABILITY_DISPATCH_ACTION = "implementation-pr-opened";

/**
 * `true` when any of `paths` falls inside the immutable set: an exact match against
 * `vitest.config.ts`, or a path that starts with one of the two directory entries. A path is a
 * plain repo-relative string, exactly what a diff or a dispatch payload already carries — nothing
 * here normalises leading `./`, backslashes, or a trailing slash a caller left off, because every
 * producer in this repo (`git diff --name-only`, GitHub's changed-files API) already emits the
 * form this function expects.
 */
export function touchesImmutableSet(paths: string[]): boolean {
  return paths.some((path) => IMMUTABLE_SET.some((entry) => path === entry || path.startsWith(entry)));
}
