import { describe, expect, it } from "vitest";
import { laneSuiteReport } from "./327-enrol.fixture";

/**
 * Criterion 3 names `npx vitest run .Workflow/agent-workflows/enrol/enrol.test.ts` as its check, so
 * that is what this runs — from the checkout root, out of process, with the runner's own markers
 * stripped from the child's environment. Green is the criterion; the run's output is the failure
 * message, because it is the only thing that says which half of the reconciliation the lane got
 * wrong.
 */
describe("#327 — reconciling a target's labels", () => {
  // Given a target whose labels already match, the lane writes no label; given one whose colour
  it("writes nothing for a matching label and corrects a differing one", () => {
    expect(laneSuiteReport()).toBe("");
  }, 900_000);
});
