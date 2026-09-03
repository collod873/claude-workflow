import type { GitExec } from "../shared/git.ts";

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

export interface OwnerRepo {
  owner: string;
  repo: string;
}

export function ownerAndRepoFromOrigin(url: string): OwnerRepo | undefined {
  const match = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) return undefined;
  const [, owner, repo] = match;
  if (!owner || !repo) return undefined;
  return { owner, repo };
}
