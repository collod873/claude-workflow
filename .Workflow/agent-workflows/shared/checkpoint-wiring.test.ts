import { describe, expect, it } from "vitest";
import { readWorkflow } from "./read-workflow";

/**
 * `to-tickets.yml` and `shape.yml` used to keep a stage's rejected raw response alive past the
 * runner only on failure (`refused-raw-response`, `if: failure()`). The checkpoints action
 * (`.github/actions/checkpoints/action.yml`) replaces that with something that survives every run,
 * not just a failing one: a lane's per-stage checkpoints, restored from the latest
 * `checkpoints-<lane>-<issue>` artifact before its first stage and uploaded back — `if: always()` —
 * after its last. This reads each workflow's own YAML back rather than grepping the file for a
 * string, the way `to-tickets-workflow.test.ts` does for the same reason: a reformatting that
 * preserves meaning should not fail this, and one that loses it should.
 *
 * Both lanes are checked through the one function below rather than two near-identical `describe`
 * blocks, since "restore before the first stage, upload after the last, and no trace of the old
 * raw-response artifact left behind" is one claim about wiring, made twice.
 */

interface Step {
  name: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

const CHECKPOINTS_ACTION = "./.github/actions/checkpoints";

function stepIndex(steps: Step[], name: string): number {
  const index = steps.findIndex((step) => step.name === name);
  if (index === -1) throw new Error(`no step named "${name}"`);
  return index;
}

function checkCheckpointWiring(
  workflowFile: string,
  jobKey: string,
  lane: string,
  firstStageName: string,
  lastStageName: string,
): void {
  const { workflow } = readWorkflow<{ jobs: Record<string, { steps: Step[] }> }>(workflowFile);
  const steps = workflow.jobs[jobKey].steps;

  const restore = steps.find((step) => step.uses === CHECKPOINTS_ACTION && step.with?.phase === "restore");
  const upload = steps.find((step) => step.uses === CHECKPOINTS_ACTION && step.with?.phase === "upload");

  it(`restores checkpoints for the ${lane} lane before its first stage step`, () => {
    expect(restore).toBeDefined();
    expect(restore!.with).toMatchObject({ lane });
    expect(steps.indexOf(restore!)).toBeLessThan(stepIndex(steps, firstStageName));
  });

  it(`uploads checkpoints for the ${lane} lane, with if: always(), after its last stage step`, () => {
    expect(upload).toBeDefined();
    expect(upload!.with).toMatchObject({ lane });
    expect(upload!.if).toBe("always()");
    expect(steps.indexOf(upload!)).toBeGreaterThan(stepIndex(steps, lastStageName));
  });

  it("no longer uploads the refused raw response as its own artifact", () => {
    expect(steps.find((step) => step.name === "Upload the refused raw response")).toBeUndefined();
    expect(steps.some((step) => step.uses === "actions/upload-artifact@v4")).toBe(false);
  });

  it("no longer names refused-raw-response in its failure report", () => {
    const report = steps.find((step) => step.name === "Report failure");
    expect(report).toBeDefined();
    expect(report!.run).not.toContain("refused-raw-response");
  });
}

describe("to-tickets.yml restores and uploads checkpoints around its stages", () => {
  checkCheckpointWiring("to-tickets.yml", "to-tickets", "to-tickets", "Seam sweep", "Audit and publish");
});

describe("shape.yml restores and uploads checkpoints around its stage", () => {
  checkCheckpointWiring("shape.yml", "shape", "shape", "Shape", "Shape");
});
