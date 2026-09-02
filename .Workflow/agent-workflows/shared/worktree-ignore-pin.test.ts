import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CODING_STANDARDS.md, "Pin a mandated copy to its source". `vitest.config.ts` excludes
 * `.claude/worktrees/**` and says there why; `eslint.config.js` and `tsconfig.json` each have to
 * repeat the glob, because neither a flat config nor a JSON config can import a `.ts` config, and
 * no compiler looks across those boundaries. This test is the thing that does: it reads all three
 * texts and asserts the worktree globs still agree.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const read = (fileName: string): string => readFileSync(resolve(REPO_ROOT, fileName), "utf8");

/** The string literals of the first `<key>: [ ... ]` array in a JS config's own source text. */
function globsIn(fileName: string, key: string): string[] {
  const array = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(read(fileName));
  if (array === null) throw new Error(`${fileName} has no ${key}: [...] array`);
  return [...array[1].matchAll(/["']([^"']*)["']/g)].map((literal) => literal[1]);
}

/** The same, for a config that is JSON — parsed rather than scanned, since it honestly is data. */
function jsonGlobsIn(fileName: string, key: string): string[] {
  const value: unknown = (JSON.parse(read(fileName)) as Record<string, unknown>)[key];
  if (!Array.isArray(value)) throw new Error(`${fileName} has no ${key} array`);
  return value as string[];
}

const worktreeGlobs = (globs: string[]): string[] => globs.filter((glob) => glob.includes("worktrees"));

const source = () => worktreeGlobs(globsIn("vitest.config.ts", "exclude"));

describe("every worktree ignore agrees with the vitest exclude it is a copy of", () => {
  it("vitest.config.ts excludes a worktree glob at all — the source the copies are pinned to", () => {
    expect(source()).not.toEqual([]);
  });

  it("eslint.config.js ignores exactly the worktree globs vitest.config.ts excludes", () => {
    expect(worktreeGlobs(globsIn("eslint.config.js", "ignores"))).toEqual(source());
  });

  it("tsconfig.json excludes exactly the worktree globs vitest.config.ts excludes", () => {
    expect(worktreeGlobs(jsonGlobsIn("tsconfig.json", "exclude"))).toEqual(source());
  });
});
