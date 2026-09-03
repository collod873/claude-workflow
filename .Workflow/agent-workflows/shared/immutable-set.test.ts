import { describe, expect, it } from "vitest";
import { touchesImmutableSet } from "./immutable-set";

/**
 * The pure half of the immutable set: whether a change list crosses it. `verify.yml`'s copy of
 * the set, the job that gates on it, and every reader of ADR-0054's dispatch are held to
 * `IMMUTABLE_SET`/`IMPLEMENTATION_PR_DISPATCH_ACTION` by `lane-wiring.test.ts`; the bash script
 * the Immutability job runs is driven as a process in `immutable-set.proc.test.ts`.
 */
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
