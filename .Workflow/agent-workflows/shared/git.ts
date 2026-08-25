import { execFileSync } from "node:child_process";

/**
 * One `git` invocation, as its argv, returning stdout as a string. Mirrors
 * `GhExec`'s shape (./gh.ts) — the only seam through which this pipeline
 * touches git, so injecting a fake here is what lets a test assert on a
 * diff computed against a fixture repo instead of trusting the real one.
 */
export type GitExec = (args: string[]) => string;

/**
 * The real `GitExec`: shells out to the `git` CLI. Unlike `execGh`, this
 * carries no working directory of its own — `git` accepts `-C <dir>` as an
 * argument in its own right, so every caller threads the repo it means
 * through argv rather than through this function's closure. That keeps one
 * `GitExec` usable against any number of repos (a fixture repo in a test,
 * the real checkout in production) without rebinding it per repo.
 */
export const execGit: GitExec = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
