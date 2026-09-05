import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { suiteTestFiles } from "./affected-tests";
import { suiteLayout } from "./suite-layout";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("this checkout's own suite, read through its own vitest", () => {
  it("names the trees this repository's config collects, and no other tree it holds", () => {
    const { roots } = suiteLayout(REPO_ROOT);

    expect(roots).toEqual([".Workflow", ".claude"]);
    expect(roots).not.toContain("bin");
    expect(roots).not.toContain("docs");
  });

  it("names the one test suffix this repository writes", () => {
    expect(suiteLayout(REPO_ROOT).suffixes).toEqual([".test.ts"]);
  });

  it("defaults to this checkout, so the file you are reading is one of its results", () => {
    expect(suiteTestFiles()).toContain(fileURLToPath(import.meta.url));
  });
});
