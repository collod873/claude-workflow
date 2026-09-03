import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import tsconfig from "../../../tsconfig.json";
import vitestConfig from "../../../vitest.config.ts";

/**
 * CODING_STANDARDS.md, "Pin a mandated copy to its source". `vitest.config.ts` excludes
 * `.claude/worktrees/**` and says there why; `eslint.config.js` and `tsconfig.json` each have to
 * repeat the glob, because neither a flat config nor a JSON config can import a `.ts` config, and
 * no compiler looks across those boundaries. This test is the thing that does: it imports all
 * three configs as the values they evaluate to and asserts the worktree globs still agree.
 *
 * `eslint.config.js` is imported by a computed specifier rather than a literal one: a literal
 * import pulls the file into `tsc`'s program under `allowJs`, where its untyped rule callbacks are
 * implicit-`any` errors this repo has chosen not to annotate. The value is the same either way.
 */

const worktreeGlobs = (globs: readonly string[] | undefined): string[] =>
  (globs ?? []).filter((glob) => glob.includes("worktrees"));

/** The exclude list `vitest.config.ts`'s `defineConfig` call evaluated to — a plain object, not a function or promise. */
const source = worktreeGlobs((vitestConfig as { test?: { exclude?: string[] } }).test?.exclude);

/** Every `ignores` entry across the flat config's blocks, in order. */
async function eslintIgnores(): Promise<string[]> {
  const configPath = pathToFileURL(resolve(import.meta.dirname, "../../../eslint.config.js")).href;
  const { default: blocks } = (await import(configPath)) as { default: { ignores?: string[] }[] };
  return blocks.flatMap((block) => block.ignores ?? []);
}

describe("every worktree ignore agrees with the vitest exclude it is a copy of", () => {
  it("vitest.config.ts excludes a worktree glob at all — the source the copies are pinned to", () => {
    expect(source).not.toEqual([]);
  });

  it("eslint.config.js ignores exactly the worktree globs vitest.config.ts excludes", async () => {
    expect(worktreeGlobs(await eslintIgnores())).toEqual(source);
  });

  it("tsconfig.json excludes exactly the worktree globs vitest.config.ts excludes", () => {
    expect(worktreeGlobs(tsconfig.exclude)).toEqual(source);
  });
});
