import { execFileSync } from "node:child_process";
import { childEnv } from "./child-env.ts";

/**
 * One `gh` invocation, as its argv, returning stdout as a string. The only
 * seam through which this pipeline touches GitHub — every write the
 * publisher makes goes through this function, so injecting a fake here is
 * what lets a test assert "refused before any write" instead of assuming
 * it.
 */
export type GhExec = (args: string[]) => string;

/**
 * The real `GhExec`: shells out to the `gh` CLI in the current working
 * directory. `gh` resolves `{owner}`/`{repo}` placeholders and the target
 * repository itself from that directory's git remote, so this carries no
 * repo argument of its own — which is exactly why an inherited `GIT_DIR`
 * (see `./child-env`) is dangerous here too: `gh` shells out to `git`
 * internally to do that resolution, and `GIT_DIR` would silently redirect
 * it at a different repository than the one in this process's cwd.
 *
 * `maxBuffer` matches `./git.ts`'s, and for the same reason: Node's default
 * is 1 MB and a child that exceeds it dies on `spawnSync <cmd> ENOBUFS` —
 * an error naming neither the command nor the size, thrown at whatever
 * caller happened to ask for one page too many. `git.ts` was given this and
 * `gh.ts` was not, so the run watchdog's first working run died reading a
 * hundred run objects (#41). One page of `gh api` output is routinely over
 * a megabyte; a listing is not an unusual thing to ask this for.
 */
export const execGh: GhExec = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, env: childEnv() });
