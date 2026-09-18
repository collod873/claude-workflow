import type { GitExec } from "./git.ts";

export interface SessionInThisRepoOptions {
  git: GitExec;
  sessionCwd: string;
  repoDir: string;
}

export function sessionIsInThisRepo(options: SessionInThisRepoOptions): boolean {
  const { git, sessionCwd, repoDir } = options;
  const sessionOrigin = originUrl(git, sessionCwd);
  if (!sessionOrigin) return false;
  const thisOrigin = originUrl(git, repoDir);
  if (!thisOrigin) return false;
  return sessionOrigin === thisOrigin;
}

function originUrl(git: GitExec, dir: string): string | undefined {
  try {
    const url = git(["-C", dir, "remote", "get-url", "origin"]).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

interface OwnerRepo {
  owner: string;
  repo: string;
}

