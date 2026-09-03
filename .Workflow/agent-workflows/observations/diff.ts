import type { GitExec } from "../shared/git";

export interface SessionRangeDiffOptions {
  git: GitExec;
  repoDir: string;
  base: string;
  head: string;
  touchedPaths?: string[];
}

export function sessionRangeDiff(options: SessionRangeDiffOptions): string {
  const { git, repoDir, base, head, touchedPaths = [] } = options;
  const pathspec = touchedPaths.length > 0 ? ["--", ...touchedPaths] : [];
  return git(["-C", repoDir, "diff", "--no-color", base, head, ...pathspec]);
}
