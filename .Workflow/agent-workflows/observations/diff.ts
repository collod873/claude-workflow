import type { GitExec } from "../shared/git";

/**
 * Inputs to `sessionRangeDiff`. `base`/`head` are commit-ish refs, not
 * derived here — deriving a session's own range from its transcript window
 * is capture's job (spec #36 slice 1), not this helper's.
 */
export interface SessionRangeDiffOptions {
  /** The injected git executor. Never invoked against the working tree. */
  git: GitExec;
  /** The repo to diff, threaded through argv as `-C <repoDir>` (see git.ts) — never baked into `git`'s closure. */
  repoDir: string;
  /** The commit the session's range starts after (exclusive) — the diff is `base..head`. */
  base: string;
  /** The last commit in the session's own range. */
  head: string;
  /**
   * Paths the transcript shows this session touching. Parallel sessions in
   * the same checkout commit into the same reachable history, so a SHA
   * range alone cannot separate "this session's commits" from a sibling's —
   * only the paths its own transcript names can (ported from Lumaria
   * d4ab813/0ddfb09, #719/#720). An empty list restricts nothing: a
   * transcript that names no paths means the extraction told us nothing,
   * not that the session touched nothing, so the diff should show more
   * rather than less. The gap this inherits (ADR 0069, upstream): a file a
   * Bash command writes without naming it is not attributable this way and
   * falls outside the restriction regardless.
   */
  touchedPaths?: string[];
}

/**
 * The diff for one session's own commit range, restricted to the paths its
 * transcript shows it touching — always `base..head`, never the working
 * tree (a session that committed its work leaves nothing there to diff).
 */
export function sessionRangeDiff(options: SessionRangeDiffOptions): string {
  const { git, repoDir, base, head, touchedPaths = [] } = options;
  const pathspec = touchedPaths.length > 0 ? ["--", ...touchedPaths] : [];
  return git(["-C", repoDir, "diff", "--no-color", base, head, ...pathspec]);
}
