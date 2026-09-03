import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import tsconfig from "../../../tsconfig.json";
import vitestConfig from "../../../vitest.config.ts";

const worktreeGlobs = (globs: readonly string[] | undefined): string[] =>
  (globs ?? []).filter((glob) => glob.includes("worktrees"));

const source = worktreeGlobs((vitestConfig as { test?: { exclude?: string[] } }).test?.exclude);

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
