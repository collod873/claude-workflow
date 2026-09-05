import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "./scratch.fixture";
import { suiteLayout, walkTree } from "./suite-layout";

function checkoutWith(paths: string[]): string {
  const root = scratchDir("suite-layout");
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "export const a = 1;\n", "utf8");
  }
  return root;
}

const NO_RUNNER = () => undefined;

describe("suiteLayout, when the target's own runner answers", () => {
  it("takes the runner's file list as the suite, roots and suffixes and all", () => {
    const root = checkoutWith([]);
    const listed = ["src/one.test.ts", "src/two.test.tsx", "scripts/three.proc.test.mjs"];

    const layout = suiteLayout(root, () => listed.map((path) => join(root, path)));

    expect(layout.roots).toEqual(["scripts", "src"]);
    expect(layout.suffixes).toEqual([".test.mjs", ".test.ts", ".test.tsx"]);
  });

  it("believes the runner over the tree, so a test the runner excludes is not in the suite", () => {
    const root = checkoutWith([".Workflow/kept.test.ts", "legacy/dropped.test.ts"]);

    const layout = suiteLayout(root, () => [join(root, ".Workflow/kept.test.ts")]);

    expect(layout.roots).toEqual([".Workflow"]);
    expect(layout.files).toEqual([".Workflow/kept.test.ts"]);
  });

  it("counts a suffix once however many files carry it", () => {
    const root = checkoutWith([]);
    const layout = suiteLayout(root, () => ["a", "b", "c"].map((name) => join(root, `src/${name}.test.ts`)));

    expect(layout.suffixes).toEqual([".test.ts"]);
  });
});

describe("suiteLayout, when there is no runner to ask", () => {
  it("believes the tree: every directory holding a test is a root", () => {
    const root = checkoutWith([".claude/hooks/a.test.ts", "src/b.test.tsx", "docs/note.md"]);

    const layout = suiteLayout(root, NO_RUNNER);

    expect(layout.roots).toEqual([".claude", "src"]);
    expect(layout.suffixes).toEqual([".test.ts", ".test.tsx"]);
  });

  it("reads a spec file as a test too", () => {
    expect(suiteLayout(checkoutWith(["src/a.spec.ts"]), NO_RUNNER).suffixes).toEqual([".spec.ts"]);
  });

  it("skips node_modules, worktrees and .git rather than calling them roots", () => {
    const root = checkoutWith([
      "src/a.test.ts",
      "node_modules/dep/dep.test.ts",
      ".claude/worktrees/other/copy.test.ts",
      ".git/hooks/thing.test.ts",
    ]);

    expect(suiteLayout(root, NO_RUNNER).roots).toEqual(["src"]);
  });

  it("names no root for a checkout with no test in it", () => {
    expect(suiteLayout(checkoutWith(["README.md"]), NO_RUNNER)).toEqual({ files: [], roots: [], suffixes: [] });
  });

  it("does not make a root out of a test sitting loose at the top of the checkout", () => {
    const layout = suiteLayout(checkoutWith(["loose.test.ts"]), NO_RUNNER);

    expect(layout.roots).toEqual([]);
    expect(layout.suffixes).toEqual([".test.ts"]);
  });
});

describe("walkTree", () => {
  it("returns every file the caller keeps, at any depth", () => {
    const root = checkoutWith(["a/b/c/deep.ts", "a/shallow.ts", "a/skip.md"]);

    expect(walkTree(root, (name) => name.endsWith(".ts")).sort()).toEqual(
      ["a/b/c/deep.ts", "a/shallow.ts"].map((path) => join(root, path)).sort(),
    );
  });

  it("returns nothing, not a throw, for a directory that is not there", () => {
    expect(walkTree(join(scratchDir("suite-layout-missing"), "no-such-directory"), () => true)).toEqual([]);
  });
});
