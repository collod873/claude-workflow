import { describe, expect, it } from "vitest";
import { expectVitestPasses } from "./261-spec-sweep.fixture";
import {
  LANES,
  type Step,
  describeSteps,
  isStageStep,
  laneSteps,
  stepValue,
} from "./275-checkpoint-wiring.fixture";

/**
 * #275, criterion 1.
 *
 * The criterion, verbatim from the issue body:
 *
 * - [ ] Both workflows restore before their first stage step and upload with if: always() after their last — check: `npx vitest run .Workflow/agent-workflows/shared/checkpoint-wiring.test.ts`
 *
 * Read off the workflow text rather than off a mock: "before" and "after" are positions in a job's
 * step list, and the step list is the only place they exist. The criterion's own check is run too —
 * the wiring test the ticket claims has to exist and be green, not merely be named.
 *
 * The readers are deliberately tolerant about spelling: `with: {phase: restore}` and a block
 * `with:` mapping are the same wiring, and `if: always()` and `if: ${{ always() }}` are the same
 * guard. What is asserted is the ordering, which is what the criterion is about.
 */

const WIRING_TEST = ".Workflow/agent-workflows/shared/checkpoint-wiring.test.ts";

/** Whether a step invokes the composite action this ticket adds. */
function usesCheckpointsAction(step: Step): boolean {
  return /uses\s*:\s*["']?\.\/\.github\/actions\/checkpoints/.test(step.text);
}

/** The `phase` the step asks for, in either the inline or the block `with:` form. */
function phaseOf(step: Step): string | null {
  const match = step.text.match(/phase\s*:\s*["']?([A-Za-z][A-Za-z-]*)/);
  return match === null ? null : match[1];
}

/** Whether the step is guarded to run whatever happened before it. */
function runsAlways(step: Step): boolean {
  return stepValue(step, "if") !== null && step.text.includes("always()");
}

describe("#275 — the checkpoint action is wired into both lanes", () => {
  it("Both workflows restore before their first stage step and upload with if: always() after their last", () => {
    for (const lane of LANES) {
      const steps = laneSteps(lane);
      const where = `${lane.workflow} (${describeSteps(steps)})`;

      const stageAt = steps
        .map((step, index) => (isStageStep(lane, step) ? index : -1))
        .filter((index) => index >= 0);
      expect(stageAt.length, `${where} runs no ${lane.script} stage step`).toBeGreaterThan(0);

      const restoreAt = steps.findIndex(
        (step) => usesCheckpointsAction(step) && phaseOf(step) === "restore",
      );
      expect(restoreAt, `${where} has no checkpoints restore step`).toBeGreaterThanOrEqual(0);
      expect(
        restoreAt,
        `${where} restores at step ${restoreAt}, after its first stage step at ${Math.min(...stageAt)}`,
      ).toBeLessThan(Math.min(...stageAt));

      const uploadAt = steps.findIndex(
        (step) => usesCheckpointsAction(step) && phaseOf(step) === "upload",
      );
      expect(uploadAt, `${where} has no checkpoints upload step`).toBeGreaterThanOrEqual(0);
      expect(
        uploadAt,
        `${where} uploads at step ${uploadAt}, not after its last stage step at ${Math.max(...stageAt)}`,
      ).toBeGreaterThan(Math.max(...stageAt));
      expect(
        runsAlways(steps[uploadAt]),
        `${where} uploads without an always() guard:\n${steps[uploadAt].text}`,
      ).toBe(true);
    }

    expectVitestPasses(WIRING_TEST);
  }, 600_000);
});
