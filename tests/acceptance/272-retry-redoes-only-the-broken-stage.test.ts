import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  RESUME_TEST_SOURCE,
  cleanUp,
  fixturePlan,
  makeTmp,
  runLaneProbe,
} from "./272-checkpoint.fixture";

/**
 * #272's first criterion, quoted verbatim in the test name below.
 *
 * The run and the retry are two child processes against one checkpoint directory, pinned to one
 * GITHUB_SHA - which is what makes the second one a retry "at the same commit" rather than an
 * unrelated run. Every stage in the retry is offered a different answer from the one it was offered
 * the first time, so a value that comes back unchanged can only have come from a checkpoint.
 */

const SEAM = "the seam only the first run's model could have found";
const RETRY_SEAM = "a seam the retry's own model invented";
const DEAD_AUDITOR = "the auditor's session died mid-answer";

const tmps: string[] = [];
afterAll(() => cleanUp(tmps));

describe("a retry redoes only the part that actually broke", () => {
  it("A retry after audit-and-publish failed spawns a model only for it, reading seam-sweep and slice back from checkpoints — check: `npx vitest run .Workflow/agent-workflows/to-tickets/resume.test.ts`", () => {
    const tmp = makeTmp();
    tmps.push(tmp);
    const plan = fixturePlan(SEAM);

    const first = runLaneProbe(tmp, [
      { stage: "seam-sweep", response: JSON.stringify({ entries: [SEAM] }) },
      { stage: "slice", response: JSON.stringify({ slices: plan }) },
      { stage: "audit-and-publish", fail: DEAD_AUDITOR },
    ]);

    expect(first.error, "the first run could not be driven at all").toBeNull();
    expect(first.steps[0].error, "seam-sweep failed in the first run").toBeNull();
    expect(first.steps[1].error, "slice failed in the first run").toBeNull();
    expect(first.steps[2].error, "audit-and-publish was supposed to die here").not.toBeNull();
    expect(first.steps[2].execCalls).toBe(1);

    const retry = runLaneProbe(tmp, [
      { stage: "seam-sweep", response: JSON.stringify({ entries: [RETRY_SEAM] }) },
      { stage: "slice", response: JSON.stringify({ slices: fixturePlan(RETRY_SEAM) }) },
      { stage: "audit-and-publish", fail: DEAD_AUDITOR },
    ]);

    expect(retry.error, "the retry could not be driven at all").toBeNull();
    expect(retry.steps[0].error, "seam-sweep failed on the retry").toBeNull();
    expect(retry.steps[1].error, "slice failed on the retry").toBeNull();

    expect(retry.steps[0].execCalls, "seam-sweep spawned a model on the retry").toBe(0);
    expect(retry.steps[1].execCalls, "slice spawned a model on the retry").toBe(0);
    expect(
      retry.steps[2].execCalls,
      "audit-and-publish, the stage that broke, did not spawn a model on the retry",
    ).toBe(1);

    expect(retry.steps[0].result, "seam-sweep did not come back from its checkpoint").toEqual([
      SEAM,
    ]);
    expect(retry.steps[1].result, "slice did not come back from its checkpoint").toEqual(plan);

    expect(
      existsSync(RESUME_TEST_SOURCE),
      "the criterion's own check command names resume.test.ts, which is not there",
    ).toBe(true);
  }, 900_000);
});
