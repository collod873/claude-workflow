/**
 * touched-paths.ts — turns the workstation-absolute file paths a transcript reports into the
 * repo-relative pathspec a `git diff` can be given anywhere, and refuses the ones that were never
 * in the repo at all.
 *
 * A `SessionRecord`'s `touchedPaths` is read on a GitHub runner, in a fresh checkout, months and
 * one machine away from the session that wrote it (`observations/diff.ts` passes it straight to
 * `git diff -- …`). The transcript, though, reports what the agent edited on the workstation:
 * absolute paths like `/home/collin/Claude Projects/Workflow/.claude/hooks/session-capture.sh`,
 * mixed with genuinely out-of-repo edits — `~/.claude/settings.json`, a scratchpad file under
 * `/tmp`. Neither survives the trip: the runner's checkout is at `/home/runner/work/…`, so an
 * absolute path is not merely wrong, it makes `git diff` exit non-zero with
 * `fatal: Invalid path '/home/collin'` and takes the whole audit down with it (#107).
 *
 * The split is deliberate. `toRepoRelative` is the **emitter's** half and needs the worktree root
 * the session actually ran in — which is not necessarily this pipeline's own checkout, since the
 * repo is worked in from more than one path on the machine (`repo-scope.ts`'s own note). It is
 * where the out-of-repo edits are dropped, because that is the only place there is enough
 * information to tell an out-of-repo edit from an in-repo one.
 *
 * `repoScoped` is the **consumer's** half, and exists because the records already on
 * `refs/notes/sessions` are immutable: fourteen of them were written before this module and carry
 * absolute paths forever. It cannot recover what those paths meant, so it drops what would fatal
 * and lets the lens read the unrestricted range diff — a superset of the right answer, which is
 * the failure worth having when the alternative is no run at all.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GitExec } from "../shared/git.ts";

/**
 * The worktree root `sessionCwd` belongs to, as git itself resolves it — `undefined`, never a
 * throw, when it is not a work tree, matching `repo-scope.ts`'s fail-closed convention. Resolved
 * from git rather than assumed to be `repoDir` because a session may have run in a different
 * clone or worktree of the same repository.
 */
export function worktreeRoot(git: GitExec, sessionCwd: string): string | undefined {
  try {
    const root = git(["-C", sessionCwd, "rev-parse", "--show-toplevel"]).trim();
    return root || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The paths from `paths` that live inside `root`, each rewritten relative to it with `/`
 * separators, deduped, in the order first seen. Everything else — a path outside the tree, the
 * root itself — is dropped rather than rewritten: an edit to `~/.claude/settings.json` is a real
 * edit that this repo's history simply does not contain, and a pathspec that names it can only
 * ever be a `git diff` failure. Relative paths pass through as-is (already what's wanted), so
 * this is safe to apply to a mixed list.
 */
export function toRepoRelative(paths: readonly string[], root: string): string[] {
  const rootResolved = resolve(root);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const candidate = isAbsolute(path) ? insideRoot(path, rootResolved) : path;
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/**
 * The subset of `paths` a `git diff` in any checkout can be handed: relative, and not escaping
 * the repo root via `..`. Absolute paths are dropped, not repaired — see the module header on why
 * the consumer has no way to repair them. Order and duplicates are preserved as given, since a
 * pathspec's own shape is not this function's concern.
 */
export function repoScoped(paths: readonly string[]): string[] {
  return paths.filter((path) => !isAbsolute(path) && !path.split(/[\\/]/).includes(".."));
}

/** `path` relative to `root` with `/` separators, or `undefined` when it is not under `root`. */
function insideRoot(path: string, root: string): string | undefined {
  const rel = relative(root, resolve(path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}
