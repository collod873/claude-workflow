import { describe, expect, it } from "vitest";
import { validatePlan } from "../../.Workflow/agent-workflows/shared/validate-graph";
import { NO_ROOT_MESSAGE, refusalOf, slice } from "./240-validate-graph.fixture";

/**
 * #240 — "Tighten validatePlan to exactly one unblocked root".
 *
 * Criterion, verbatim:
 *
 *   A one-root plan passes; a two-plus-root plan is refused, naming both offenders by position and title — check: `npx vitest run .Workflow/agent-workflows/shared/validate-graph.test.ts`
 */

/**
 * Whether `message` names the slice at this 1-based position by both its position and its title.
 *
 * Deliberately tolerant of the sentence around them and of which comes first, because the ticket
 * fixes what a refusal must identify — position and title, the way every other refusal in
 * `validatePlan` already reports — and not the prose it identifies them in. `slice 1 ("Root A")`,
 * the shape the existing out-of-range and self-reference refusals use, satisfies this; so does a
 * bare list item. A message naming a title with no position, or a position with no title, does not.
 */
function namesSliceAt(message: string, position: number, title: string): boolean {
  const at = `\\b${position}\\b`;
  const named = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`${at}[^\\n]{0,12}${named}`).test(message) ||
    new RegExp(`${named}[^\\n]{0,12}${at}`).test(message)
  );
}

describe("validatePlan, once hasUnblockedRoot demands exactly one root", () => {
  it("A one-root plan passes; a two-plus-root plan is refused, naming both offenders by position and title", () => {
    // Exactly one unblocked root: the tracer, with everything else behind it.
    const oneRoot = [slice("Root"), slice("Depends on root", [1]), slice("Depends on both", [1, 2])];
    expect(() => validatePlan(oneRoot)).not.toThrow();

    // Two unblocked roots — a horizontal first wave, which is what the tightening exists to refuse.
    const twoRoots = [slice("Root A"), slice("Root B"), slice("Leaf", [1])];
    const twoRootRefusal = refusalOf(twoRoots);
    expect(twoRootRefusal, "a plan with two unblocked roots must be refused, not accepted").not.toBeNull();

    const twoRootMessage = twoRootRefusal ?? "";
    expect(
      namesSliceAt(twoRootMessage, 1, "Root A"),
      `expected ${JSON.stringify(twoRootMessage)} to name slice 1 ("Root A")`,
    ).toBe(true);
    expect(
      namesSliceAt(twoRootMessage, 2, "Root B"),
      `expected ${JSON.stringify(twoRootMessage)} to name slice 2 ("Root B")`,
    ).toBe(true);
    // A plan with two roots is not a plan with none, so it must not borrow that defect's message.
    expect(twoRootMessage).not.toBe(NO_ROOT_MESSAGE);

    // "Two-plus": three roots names all three, so the refusal reports the offenders it found
    // rather than the first pair of them.
    const threeRoots = [slice("Alpha"), slice("Beta"), slice("Gamma"), slice("Delta", [1])];
    const threeRootRefusal = refusalOf(threeRoots);
    expect(threeRootRefusal, "a plan with three unblocked roots must be refused, not accepted").not.toBeNull();

    const threeRootMessage = threeRootRefusal ?? "";
    for (const [position, title] of [
      [1, "Alpha"],
      [2, "Beta"],
      [3, "Gamma"],
    ] as const) {
      expect(
        namesSliceAt(threeRootMessage, position, title),
        `expected ${JSON.stringify(threeRootMessage)} to name slice ${position} ("${title}")`,
      ).toBe(true);
    }
  });
});
