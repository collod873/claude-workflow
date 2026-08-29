import { describe, expect, it } from "vitest";
import { NO_ROOT_MESSAGE, refusalOf, slice } from "./240-validate-graph.fixture";

/**
 * #240 — "Tighten validatePlan to exactly one unblocked root".
 *
 * Criterion, verbatim:
 *
 *   A plan with zero roots keeps its existing no-root error message — check: `npx vitest run .Workflow/agent-workflows/shared/validate-graph.test.ts`
 *
 * "Keeps" is a claim about the tightening, not about today: the point is that replacing the
 * *at least one root* predicate with *exactly one* does not fold the two defects together. So this
 * asserts the existing sentence character-for-character on a zero-root plan **and** that the
 * sentence stays reserved to that defect — a plan with two roots must be refused with something
 * else. Today the second half is red, because a two-root plan is accepted silently.
 */
describe("validatePlan, once hasUnblockedRoot demands exactly one root", () => {
  it("A plan with zero roots keeps its existing no-root error message", () => {
    // Two slices pointing at each other: neither edge is out of range or self-referential, and
    // nothing can start.
    const twoSliceRing = [slice("First", [2]), slice("Second", [1])];
    expect(refusalOf(twoSliceRing)).toBe(NO_ROOT_MESSAGE);

    // The same defect one slice wider, so the message is not an accident of a two-slice plan.
    const threeSliceRing = [slice("A", [3]), slice("B", [1]), slice("C", [2])];
    expect(refusalOf(threeSliceRing)).toBe(NO_ROOT_MESSAGE);

    // And the sentence belongs to the zero-root defect alone: a plan whose first wave is wider
    // than one root is a different defect, and must not be reported as "no unblocked root".
    const twoRoots = [slice("Root A"), slice("Root B"), slice("Leaf", [1])];
    const twoRootRefusal = refusalOf(twoRoots);
    expect(twoRootRefusal, "a plan with two unblocked roots must be refused, not accepted").not.toBeNull();

    const message = twoRootRefusal ?? "";
    expect(message).not.toBe(NO_ROOT_MESSAGE);
    expect(message).not.toMatch(/no unblocked root/);
  });
});
