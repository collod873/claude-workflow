import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CODING_STANDARDS.md, "Pin a mandated copy to its source". `vitest.config.ts` excludes
 * `.claude/worktrees/**` and says there why; `eslint.config.js` has to repeat the glob because a
 * flat config cannot import a `.ts` config, and no compiler looks across that boundary. This test
 * is the thing that does: it reads both texts and asserts the worktree globs still agree.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** The string literals of the first `<key>: [ ... ]` array in a config's own source text. */
function globsIn(fileName: string, key: string): string[] {
  const text = readFileSync(resolve(REPO_ROOT, fileName), "utf8");
  const array = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(text);
  if (array === null) throw new Error(`${fileName} has no ${key}: [...] array`);
  return [...array[1].matchAll(/["']([^"']*)["']/g)].map((literal) => literal[1]);
}

const worktreeGlobs = (globs: string[]): string[] => globs.filter((glob) => glob.includes("worktrees"));

describe("eslint.config.js's worktree ignore agrees with the vitest exclude it is a copy of", () => {
  it("ignores exactly the worktree globs vitest.config.ts excludes", () => {
    expect(worktreeGlobs(globsIn("eslint.config.js", "ignores"))).toEqual(
      worktreeGlobs(globsIn("vitest.config.ts", "exclude")),
    );
  });
});
