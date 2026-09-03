import type { GitExec } from "../shared/git.ts";

export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface DeriveRangeOptions {
  git: GitExec;
  repoDir: string;
  since: string;
  until: string;
}

export interface CommitRange {
  base: string;
  head: string;
}

export function deriveRange(options: DeriveRangeOptions): CommitRange | undefined {
  const { git, repoDir, since, until } = options;

  if (Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until))) return undefined;

  const log = git(["-C", repoDir, "log", `--since=${since}`, `--until=${until}`, "--format=%H"]);
  const shas = log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (shas.length === 0) return undefined;

  const head = shas[0]; 
  const oldest = shas[shas.length - 1];

  let base: string;
  try {
    base = git(["-C", repoDir, "rev-parse", `${oldest}^`]).trim();
  } catch {
    base = EMPTY_TREE_HASH;
  }

  return { base, head };
}
