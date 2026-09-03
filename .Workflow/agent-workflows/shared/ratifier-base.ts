import type { GitExec } from "./git";

export const LAST_RATIFIER_REF = "refs/ratifier/last";

export const LEGACY_RATIFIER_REF = "refs/release/last";

export function readRef(git: GitExec, repoDir: string, ref: string): string | undefined {
  try {
    return git(["-C", repoDir, "rev-parse", "--verify", "--quiet", ref]).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function readRatifierBase(git: GitExec, repoDir: string): string | undefined {
  return readRef(git, repoDir, LAST_RATIFIER_REF) ?? readRef(git, repoDir, LEGACY_RATIFIER_REF);
}
