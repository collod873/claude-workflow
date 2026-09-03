/**
 * The things a pull request may never touch — [ADR-0053](../../../docs/adr/0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md)
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

/** The closed set. `tests/acceptance/` left it with #360: acceptance tests live beside their subjects now. */
export const IMMUTABLE_SET = ["vitest.config.ts", ".github/"] as const;

/**
 * The `github.event.action` value ADR-0054's dispatch carries — **one wire name, one sender, three
 * readers**: `implement.ts`'s `openPrAndDispatch` sends it, and the Immutability job, the
 * Restore-and-run-acceptance job (both `.github/workflows/verify.yml`) and lane 08
 * (`.github/workflows/integrate.yml`) each gate on it. Spelled here as well as in those three
 * `if:`s, the same split `WATCHDOG_DISPATCH_ACTION` and its siblings hold to, so the workflow
 * tests can assert they agree rather than trusting they were typed the same four times.
 *
 * It lives in *this* file rather than in the lane that sends it because ADR-0054 makes the
 * dispatch and the immutable set one mechanism — "the two halves are load-bearing together" —
 * and because `shared/` may not import a lane. `implement.ts` re-exports it as
 * `VERIFY_DISPATCH_EVENT_TYPE` for the sending side, and `integrate.ts` re-exports it again from
 * there.
 *
 * It was two strings until #145's seam audit: the receiving side (#161) declared
 * `implementation-pr-opened` here while the sending side (#167) declared `implementation-opened`
 * in `implement.ts`, each slice internally tested against its own constant and nothing testing
 * the pair. Both of `verify.yml`'s jobs were therefore unreachable while `integrate.yml` merged
 * on the dispatch anyway — the acceptance guarantee unarmed and the merge actor running without
 * it. One declaration is what stops that recurring.
 */
export const IMPLEMENTATION_PR_DISPATCH_ACTION = "implementation-opened";

/**
 * `true` when any of `paths` falls inside the immutable set: an exact match against
 * `vitest.config.ts`, or a path under `.github/`. A path is a
 * plain repo-relative string, exactly what a diff or a dispatch payload already carries — nothing
 * here normalises leading `./`, backslashes, or a trailing slash a caller left off, because every
 * producer in this repo (`git diff --name-only`, GitHub's changed-files API) already emits the
 * form this function expects.
 */
export function touchesImmutableSet(paths: string[]): boolean {
  return paths.some((path) => IMMUTABLE_SET.some((entry) => path === entry || path.startsWith(entry)));
}
