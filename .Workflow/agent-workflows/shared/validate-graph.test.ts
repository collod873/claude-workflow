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

  it("refuses a cycle, naming both slices involved, in a graph that has an unblocked root elsewhere", () => {
    // Slice 1 is a genuine unblocked root, so the no-root check passes and
    // the cycle between slices 2 and 3 is what has to catch this.
    const plan = [slice("Root"), slice("Cycle A", [3]), slice("Cycle B", [2])];

    expect(() => validatePlan(plan)).toThrow(/dependency cycle detected/);
    expect(() => validatePlan(plan)).toThrow(/slice 2 \("Cycle A"\)/);
  });
});
