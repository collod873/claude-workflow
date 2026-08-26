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
 */
export const execGh: GhExec = (args) => execFileSync("gh", args, { encoding: "utf8", env: childEnv() });
