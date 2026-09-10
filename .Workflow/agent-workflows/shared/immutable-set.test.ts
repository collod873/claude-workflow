import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test } from "vitest";
import { IMMUTABLE_SET, touchesImmutableSet, touchesWorkstation } from "./immutable-set";

const sharedListPath = resolve(dirname(fileURLToPath(import.meta.url)), "immutable-set.json");

describe("touchesImmutableSet", () => {
  it("flags vitest.config.ts itself", () => {
    expect(touchesImmutableSet(["vitest.config.ts"])).toBe(true);
  });

  it("flags a path under .github/", () => {
    expect(touchesImmutableSet([".github/workflows/verify.yml"])).toBe(true);
  });

  it("does not flag a path outside all three entries", () => {
    expect(touchesImmutableSet([".Workflow/agent-workflows/shared/immutable-set.ts"])).toBe(false);
  });

  it("flags the set when only one of several paths is inside it", () => {
    expect(touchesImmutableSet(["src/thing.ts", "vitest.config.ts", "README.md"])).toBe(true);
  });

  it("does not flag an empty change list", () => {
    expect(touchesImmutableSet([])).toBe(false);
  });
});

test("#425.2: the Python and TypeScript sides agree on the immutable set", () => {
  const shared = JSON.parse(readFileSync(sharedListPath, "utf8")) as string[];

  expect(Array.isArray(shared)).toBe(true);
  expect(shared.length).toBeGreaterThan(0);
  expect([...IMMUTABLE_SET]).toEqual(shared);
});

test.fails("#437.4: touchesWorkstation classifies a home-directory or `.claude/` settings path, independent of the immutable-set check", () => {
  expect(touchesWorkstation(["~/.claude/settings.json"])).toBe(true);
  expect(touchesWorkstation(["~/bin/hook-report"])).toBe(true);
  expect(touchesWorkstation([".claude/settings.json"])).toBe(true);
  expect(touchesWorkstation([".Workflow/agent-workflows/shared/immutable-set.ts"])).toBe(false);
  expect(touchesWorkstation([])).toBe(false);

  expect(touchesImmutableSet(["~/.claude/settings.json"])).toBe(false);
});
