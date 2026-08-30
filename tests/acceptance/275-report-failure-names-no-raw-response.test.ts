import { describe, expect, it } from "vitest";
import { expectVitestPasses } from "./261-spec-sweep.fixture";
import { LANES, describeSteps, laneSteps } from "./275-checkpoint-wiring.fixture";

/**
 * #275, criterion 5.
 *
 * The criterion, verbatim from the issue body:
 *
 * - [ ] Both lanes' Report failure step no longer names refused-raw-response — check: `npx vitest run .Workflow/agent-workflows/shared/checkpoint-wiring.test.ts`
 *
 * The step is required to still be there before its text is read: deleting the shared failure
 * surface would satisfy "no longer names" while removing the comment the criterion is about.
 *
 * Comments are already dropped by the job reader this file's fixture builds on, so a note in the
 * YAML recording what the step used to point at is not a failure — what the criterion is about is
 * what the comment the lane posts says.
 */

const WIRING_TEST = ".Workflow/agent-workflows/shared/checkpoint-wiring.test.ts";

describe("#275 — the failure comment points at the checkpoint artifact", () => {
  it("Both lanes' Report failure step no longer names refused-raw-response", () => {
    for (const lane of LANES) {
      const steps = laneSteps(lane);
      const reports = steps.filter((step) => /^report failure/i.test(step.name));
      expect(
        reports.length,
        `${lane.workflow} declares no Report failure step (${describeSteps(steps)})`,
      ).toBeGreaterThan(0);

      for (const step of reports) {
        expect(
          step.text,
          `${lane.workflow}'s Report failure step still names refused-raw-response`,
        ).not.toContain("refused-raw-response");
      }
    }

    expectVitestPasses(WIRING_TEST);
  }, 600_000);
});
