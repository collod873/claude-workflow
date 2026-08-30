import { describe, expect, it } from "vitest";
import type { Slice } from "./plan-schema";
import { validatePlan } from "./validate-graph";

function slice(title: string, dependsOn: number[] = []): Slice {
  return {
    title,
    whatToBuild: `Build ${title}.`,
    acceptanceCriteria: [`${title} works.`],
    filesClaimed: [],
    seamsConsumed: [],
    whyNotMerged: `${title} is its own vertical slice.`,
    dependsOn,
  };
}

describe("validatePlan", () => {
  it("passes silently on a well-formed plan", () => {
    const plan = [slice("Root"), slice("Depends on root", [1])];

    expect(() => validatePlan(plan)).not.toThrow();
  });

  it("refuses an out-of-range dependsOn, naming the offending slice by position and title", () => {
    const plan = [slice("Root"), slice("Points past the end", [7])];

    expect(() => validatePlan(plan)).toThrow(/slice 2 \("Points past the end"\).*out-of-range/);
  });

  it("refuses a self-reference, naming the offending slice by position and title", () => {
    const plan = [slice("Root"), slice("Depends on itself", [2])];

    expect(() => validatePlan(plan)).toThrow(/slice 2 \("Depends on itself"\).*depends on itself/);
  });

  it("refuses a graph with no unblocked root", () => {
    // Every slice declares a dependsOn, so nothing can start — even though,
    // taken alone, neither edge is out of range or self-referential.
    const plan = [slice("First", [2]), slice("Second", [1])];

    expect(() => validatePlan(plan)).toThrow(/no unblocked root/);
  });

  it("accepts a wave 0 holding several slices, since the slice stage draws one per independent start", () => {
    // `slice/prompt.md` defines wave 0 as "every slice you draw with no
    // `dependsOn`" — plural by construction. This used to throw, so a spec
    // whose work starts in several independent places could only be published
    // by inventing an edge that made the graph lie about what blocks what.
    const plan = [slice("First root"), slice("Second root"), slice("Depends on both", [1, 2])];

    expect(() => validatePlan(plan)).not.toThrow();
  });

  it("accepts a plan that is nothing but independent roots", () => {
    const plan = [slice("First"), slice("Second"), slice("Third"), slice("Fourth")];

    expect(() => validatePlan(plan)).not.toThrow();
  });

  it("refuses a cycle, naming both slices involved, in a graph that has an unblocked root elsewhere", () => {
    // Slice 1 is a genuine unblocked root, so the no-root check passes and
    // the cycle between slices 2 and 3 is what has to catch this.
    const plan = [slice("Root"), slice("Cycle A", [3]), slice("Cycle B", [2])];

    expect(() => validatePlan(plan)).toThrow(/dependency cycle detected/);
    expect(() => validatePlan(plan)).toThrow(/slice 2 \("Cycle A"\)/);
  });
});
