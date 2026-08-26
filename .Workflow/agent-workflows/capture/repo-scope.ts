/**
 * repo-scope.ts — decides whether a session's own working directory is this pipeline's one scoped
 * repo (spec #63 §Solution 1, "runs only when the session's working directory is this repo"),
 * which is ADR-0018's split enforced in code rather than assumed. Session capture itself is
 * global; the publish half that follows it (a git note, a push, a `repository_dispatch`) is not,
 * and this is the single check `session-capture-hook.mjs`'s second half gates on before it runs
 * any of that.
 *
 * Scope is decided by comparing `origin` remotes, not paths: the session's own `cwd` may be a
 * different clone or worktree of the same repository than the checkout this hook's own module
 * lives in (this repo is worked in from more than one path on the machine), and a path comparison
 * would wrongly call that "a different repo". Reading `origin` from both sides survives that.
 *
 * Fails closed on anything unreadable: a `cwd` that is not a git repo, one with no `origin`
 * remote, or a `repoDir` in the same shape, all resolve to "out of scope" rather than throwing —
 * the caller never needs to guard a call here with its own try/catch.
 */
import type { GitExec } from "../shared/git.ts";

export interface SessionInThisRepoOptions {
  /** The injected git executor — see `GitExec`'s own note on why this is never invoked directly. */
  git: GitExec;
  /** The session's own working directory, as reported by the hook's payload (`cwd`). */
  sessionCwd: string;
  /** This pipeline's own checkout — what the publish step reads and writes. */
  repoDir: string;
}

/**
 * True when `sessionCwd` and `repoDir` resolve to the same `origin` remote — i.e. the session
 * that just ended ran inside this repo (or another clone/worktree of it) rather than some other
 * repo on the machine. False, never a throw, on anything unreadable — see the module header.
 */
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

/** This repo's own `owner`/`repo`, parsed from `repoDir`'s `origin` remote. */
export interface OwnerRepo {
  owner: string;
  repo: string;
}

/**
 * Parses `owner`/`repo` out of a git remote URL — `https://github.com/owner/repo.git`,
 * `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git`, with or without the
 * trailing `.git` — for the one call in the publish step (the `repository_dispatch`) that needs
 * a literal `repos/{owner}/{repo}` path rather than `gh`'s own cwd-resolved placeholder: the
 * process this runs in has no reliable cwd of its own to resolve that placeholder from (its cwd
 * is whatever the shell that launched it happened to have, not necessarily `repoDir`). Returns
 * `undefined` on a URL shaped in a way this doesn't recognise, rather than guessing.
 */
export function ownerAndRepoFromOrigin(url: string): OwnerRepo | undefined {
  const match = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) return undefined;
  const [, owner, repo] = match;
  if (!owner || !repo) return undefined;
  return { owner, repo };
}
