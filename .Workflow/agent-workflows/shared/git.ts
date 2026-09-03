import { execFileSync } from "node:child_process";
import { childEnv } from "./child-env.ts";

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
 *
 * `env` strips the `GIT_*` location variables (see `./child-env`) from the
 * child's environment. Git honors an inherited `GIT_DIR` over an argv
 * `-C <dir>` — and git sets `GIT_DIR` on every hook it invokes, including
 * `pre-push` — so without this, a caller's `-C <dir>` is only a suggestion
 * a hook-spawned `git` is free to ignore in favor of whatever repo the
 * outer git process happened to be running against.
 */
/**
 * `stdio` is the default in every respect except that it does not echo. `execFileSync` otherwise
 * writes the child's stderr to this process's own fd 2 on top of capturing it, and git reports
 * routine progress there — every push ref, every "Overwriting existing notes". That is 76 lines of
 * a green suite's log, unlabelled, because the bytes never pass through the vitest worker that
 * would name the test they came from. The echo only ever adds output on success: a failing git
 * still carries its stderr in the thrown `Error`'s message, which is what every caller reports.
 */
export const execGit: GitExec = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
