import { describe, expect, it } from "vitest";
import { touchesImmutableSet } from "./immutable-set";

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
