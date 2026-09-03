import { isAbsolute } from "node:path";

/**
 * The subset of `paths` a `git diff` in any checkout can be handed: relative, and not escaping
 * the repo root via `..`. Absolute paths are dropped, not repaired — a consumer reading a session's
 * touched-path list has no way to know which checkout an absolute path was relative to (see
 * `capture/touched-paths.ts`'s header). Order and duplicates are preserved as given, since a
 * pathspec's own shape is not this function's concern.
 *
 * Here rather than in `capture/` because two lanes filter with it: the capture hook's own writer
 * and `observations/run-audit.ts`, which reads the list back to scope an audit.
 */
export function repoScoped(paths: readonly string[]): string[] {
  return paths.filter((path) => !isAbsolute(path) && !path.split(/[\\/]/).includes(".."));
}
