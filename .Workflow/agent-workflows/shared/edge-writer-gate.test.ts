import { describe, expect, it } from "vitest";
import { test } from "vitest";
import { binSources, laneSources } from "./repo-sources";

const GH_PATHS_IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*\/gh-paths["']/g;

const NOT_A_MODULE = /\.(test|fixture|fake|stub)\.ts$/;

function importsBlockedByPath(source: string): boolean {
  return [...source.matchAll(GH_PATHS_IMPORT)].some((match) =>
    match[1].split(",").some((name) => name.trim().replace(/^type\s+/, "") === "blockedByPath"),
  );
}

describe("the blocked-by graph has one writer, lane 03 (ADR-0069, #601)", () => {
  const modules = laneSources().filter((file) => file.relative.endsWith(".ts") && !NOT_A_MODULE.test(file.relative));

  it("reads the lane tree and bin/ at all, so an empty scan can never pass by accident", () => {
    expect(modules.length).toBeGreaterThan(100);
    expect(binSources().map((file) => file.relative)).toContain("bin/publish-issue-graph");
  });

  it("recognises an import of blockedByPath and not of its matcher", () => {
    expect(importsBlockedByPath('import { blockedByPath, subIssuesPath } from "./gh-paths";')).toBe(true);
    expect(importsBlockedByPath('import {\n  blockedByPathMatcher,\n} from "../shared/gh-paths";')).toBe(false);
  });

  it("imports blockedByPath in exactly the slice publisher and the reader of ticket state", () => {
    const importers = modules
      .filter((file) => importsBlockedByPath(file.source))
      .map((file) => file.relative)
      .sort();

    expect(importers).toEqual([
      ".Workflow/agent-workflows/dispatch/ticket-state.ts",
      ".Workflow/agent-workflows/shared/publish-sub-issues.ts",
    ]);
  });

  it("spells the blocked-by endpoint in no file under bin/: publish-issue-graph is a shim onto lane 03 (#603)", () => {
    const spellers = binSources()
      .filter((file) => file.source.includes("dependencies/blocked_by"))
      .map((file) => file.relative);

    expect(spellers).toEqual([]);
  });
});

test.fails("#607.7: tracker-gh.ts joins ticket-state.ts and publish-sub-issues.ts as importers of blockedByPath", () => {
  const modules = laneSources().filter((file) => file.relative.endsWith(".ts") && !NOT_A_MODULE.test(file.relative));
  const importers = modules
    .filter((file) => importsBlockedByPath(file.source))
    .map((file) => file.relative)
    .sort();

  expect(importers).toEqual([
    ".Workflow/agent-workflows/dispatch/ticket-state.ts",
    ".Workflow/agent-workflows/shared/publish-sub-issues.ts",
    ".Workflow/agent-workflows/shared/tracker-gh.ts",
  ]);
});
