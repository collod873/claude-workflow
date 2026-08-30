import { describe, expect, it } from "vitest";
import { expectVitestPasses } from "./261-spec-sweep.fixture";
import { LANES, allSteps, describeSteps, workflowText } from "./275-checkpoint-wiring.fixture";

/**
 * #275, criterion 4.
 *
 * The criterion, verbatim from the issue body:
 *
 * - [ ] Both 'Upload the refused raw response' if: failure() steps are removed from to-tickets.yml and shape.yml — check: `npx vitest run .Workflow/agent-workflows/shared/checkpoint-wiring.test.ts`
 *
 * Every job of each workflow is read, not just the lane's own: "removed from to-tickets.yml and
 * shape.yml" is a claim about the file, and a step moved into a neighbouring job is not a step that
 * was deleted.
 *
 * Two shapes are refused — the step by its name, and any upload step still carrying a raw response
 * whatever it is called — because renaming the step would satisfy the first assertion alone while
 * leaving the duplicated upload exactly where the ticket says it must not be. The step count is
 * asserted first so a workflow that stopped parsing into steps at all cannot read as a deletion.
 */

const WIRING_TEST = ".Workflow/agent-workflows/shared/checkpoint-wiring.test.ts";

describe("#275 — the refused-raw-response uploads are gone", () => {
  it("Both 'Upload the refused raw response' if: failure() steps are removed from to-tickets.yml and shape.yml", () => {
    for (const lane of LANES) {
      const steps = allSteps(workflowText(lane.workflow));
      expect(steps.length, `${lane.workflow} declares no steps at all`).toBeGreaterThan(0);

      const named = steps.filter((step) =>
        step.name.toLowerCase().includes("upload the refused raw response"),
      );
      expect(
        describeSteps(named),
        `${lane.workflow} still declares the refused-raw-response upload step`,
      ).toBe("(none)");

      const rawUploads = steps.filter(
        (step) =>
          /uses\s*:\s*["']?actions\/upload-artifact/.test(step.text) &&
          step.text.includes("raw-response"),
      );
      expect(
        describeSteps(rawUploads),
        `${lane.workflow} still uploads a raw response of its own`,
      ).toBe("(none)");
    }

    expectVitestPasses(WIRING_TEST);
  }, 600_000);
});
