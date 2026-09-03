import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { childEnv } from "./child-env.ts";
import { scratchDir } from "./scratch.fixture.ts";

const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * @fixture Reached only from the suite, by design.
 */
export interface TempRepo {
  dir: string;
  write: (path: string, contents: string) => void;
  remove: (path: string) => void;
  commit: (message: string, options?: CommitOptions) => string;
  git: (...args: string[]) => string;
  head: () => string;
}

export interface CommitOptions {
  date?: string;
}

export interface TempRepoOptions {
  origin?: string;
}

function runGit(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    env: { ...childEnv(), ...env },
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function setIdentity(dir: string): void {
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
}

/**
 * @fixture Reached only from the suite, by design.
 */
export function repoAt(dir: string): TempRepo {
  const git = (...args: string[]) => runGit(dir, args);
  return {
    dir,
    git,
    write(path, contents) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), contents, "utf8");
    },
    remove(path) {
      unlinkSync(join(dir, path));
    },
    commit(message, { date } = {}) {
      git("add", "-A");
      const env = date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
      runGit(dir, ["commit", "-q", "-m", message], env);
      return git("rev-parse", "HEAD");
    },
    head: () => git("rev-parse", "HEAD"),
  };
}

/**
 * @fixture Reached only from the suite, by design.
 */
export function makeTempRepo(prefix: string, { origin }: TempRepoOptions = {}): TempRepo {
  const dir = scratchDir(prefix);
  runGit(dir, ["init", "-q", "-b", "main"]);
  setIdentity(dir);
  if (origin !== undefined) runGit(dir, ["remote", "add", "origin", origin]);
  return repoAt(dir);
}

/**
 * @fixture Reached only from the suite, by design.
 */
export function makeBareRepo(prefix: string): string {
  const dir = scratchDir(prefix);
  runGit(dir, ["init", "-q", "--bare", "-b", "main"]);
  return dir;
}

/**
 * @fixture Reached only from the suite, by design.
 */
export function cloneRepo(bareDir: string, prefix: string): TempRepo {
  const dir = scratchDir(prefix);
  runGit(dir, ["clone", "-q", bareDir, "."]);
  setIdentity(dir);
  return repoAt(dir);
}

/**
 * @fixture Reached only from the suite, by design.
 */
export function noteOnRemote(bareDir: string, ref: string, sha: string): string {
  const verify = cloneRepo(bareDir, "note-on-remote");
  verify.git("fetch", "-q", "origin", `+refs/notes/${ref}:refs/notes/${ref}`);
  return verify.git("notes", `--ref=${ref}`, "show", sha);
}
