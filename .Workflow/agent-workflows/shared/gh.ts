import { execFileSync } from "node:child_process";

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
 * repo argument of its own.
 */
export const execGh: GhExec = (args) => execFileSync("gh", args, { encoding: "utf8" });
