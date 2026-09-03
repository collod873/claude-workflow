import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { childEnv } from "./child-env.ts";
import { scratchDir } from "./scratch.fixture.ts";

/** Matches `./git.ts`'s, and for the same reason: Node's 1 MB default exits `ENOBUFS` naming neither command nor size. */
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * A throwaway git repo for one test — the unit every seam that reads real git
 * rather than an argv-recording fake is built from. Removed when the test
 * finishes, pass or fail, so the caller keeps no `afterEach` of its own (see
 * `./scratch.fixture.ts` for why `onTestFinished` rather than `afterEach`).
 *
 * It exists because the same twenty lines had been retyped in four test files
 * by the time the clone gate caught the fourth, each copy trimmed slightly
 * differently — and in eleven by the time the gate lost its baseline (#360).
 * `write` and `commit` are separate so a test can stage several files, a
 * deletion, or nothing at all into one commit — the shape a copy that only
 * took `(path, contents, message)` could not express.
 *
 * `git` is the one door for anything else: it runs in this repo with the
 * location variables (`GIT_DIR` and friends, see `./child-env.ts`) removed
 * from the child's environment, so the repo it touches is this one whatever
 * the worker inherited — the same guarantee `execGit` gives production, which
 * a fixture spelling `execFileSync("git", …)` itself does not get.
 *
 * `main` is named explicitly rather than left to `init.defaultBranch`, so a
 * test that fetches trunk by name does not depend on the runner's git config.
 *
 * @fixture Reached only from the suite, by design.
 */
export interface TempRepo {
  /** The repo's directory — for `-C`, `repoDir`, and whatever the subject wants to be pointed at. */
  dir: string;
  /** Writes one file, creating parent directories. Nothing is staged until `commit`. */
  write: (path: string, contents: string) => void;
  /** Deletes one file from the working tree. Nothing is staged until `commit`. */
  remove: (path: string) => void;
  /** Commits everything in the tree, including deletions, and returns the new commit's SHA. */
  commit: (message: string, options?: CommitOptions) => string;
  /** Runs `git` in this repo and returns its stdout, trimmed. */
  git: (...args: string[]) => string;
  /** The SHA `HEAD` resolves to. */
  head: () => string;
}

export interface CommitOptions {
  /**
   * An ISO timestamp for both author and committer date. For a subject that reads dates back out
   * of `git log`, which has to control them precisely rather than let them fall out of "whenever
   * the test happened to run".
   */
  date?: string;
}

export interface TempRepoOptions {
  /** A repository to register as the `origin` remote, for a subject that pushes to or fetches from one. */
  origin?: string;
}

function runGit(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    env: { ...childEnv(), ...env },
  }).trim();
}

function setIdentity(dir: string): void {
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
}

/**
 * A `TempRepo` over a directory that is already a repository — one a fixture in this file made,
 * handed around as a path. No `git init` and no teardown of its own: those belong to whichever
 * fixture made the directory.
 *
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
 * Creates a `TempRepo`. `prefix` names the temp directory, so a stray one says which test left it.
 *
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
 * A bare repository standing in for a remote — no working tree, just refs — so a test's push
 * lands somewhere it can be read back from (`noteOnRemote`, or a `cloneRepo` of it) and never
 * on the real `origin`.
 *
 * @fixture Reached only from the suite, by design.
 */
export function makeBareRepo(prefix: string): string {
  const dir = scratchDir(prefix);
  runGit(dir, ["init", "-q", "--bare", "-b", "main"]);
  return dir;
}

/**
 * Clones `bareDir` into a fresh `TempRepo` with `origin` pointing back at it, identity configured
 * so the clone can make commits of its own — one side of the two-pusher shape a
 * non-fast-forward race needs.
 *
 * @fixture Reached only from the suite, by design.
 */
export function cloneRepo(bareDir: string, prefix: string): TempRepo {
  const dir = scratchDir(prefix);
  runGit(dir, ["clone", "-q", bareDir, "."]);
  setIdentity(dir);
  return repoAt(dir);
}

/**
 * The note a *fresh* clone of `bareDir` sees for `sha` on `refs/notes/<ref>` — read through a new
 * clone rather than the pusher's own checkout, since what a push test asserts is what reached the
 * remote, not what the local ref says.
 *
 * @fixture Reached only from the suite, by design.
 */
export function noteOnRemote(bareDir: string, ref: string, sha: string): string {
  const verify = cloneRepo(bareDir, "note-on-remote");
  verify.git("fetch", "-q", "origin", `+refs/notes/${ref}:refs/notes/${ref}`);
  return verify.git("notes", `--ref=${ref}`, "show", sha);
}
