import { afterAll, describe, expect, it } from "vitest";
import {
  PLAN_TITLE,
  checkpointOf,
  cleanUp,
  fixturePlan,
  handoffOf,
  makeTmp,
  readIfPresent,
  runLaneProbe,
} from "./272-checkpoint.fixture";

/**
 * #272's fifth criterion, quoted verbatim in the test name below.
 *
 * Two stages run green, and each carries a marker nothing else in the run does: the sweep's seam
 * and the plan's title. Neither marker may be at the shared handoff path afterwards. The second
 * half of the assertion is what keeps the first from being satisfied by a stage that simply stopped
 * writing its output anywhere: each marker has to be in that stage's own named checkpoint file.
 */

const SEAM = "the seam this green run swept up";

const tmps: string[] = [];
afterAll(() => cleanUp(tmps));

describe("the handoff path carries only a failure reason", () => {
  it("A successful stage no longer writes its output to handoffPath() — check: `npx vitest run .Workflow/agent-workflows/to-tickets/to-tickets.test.ts`", () => {
    const tmp = makeTmp();
    tmps.push(tmp);

    const run = runLaneProbe(tmp, [
      { stage: "seam-sweep", response: JSON.stringify({ entries: [SEAM] }) },
      { stage: "slice", response: JSON.stringify({ slices: fixturePlan(SEAM) }) },
    ]);
    expect(run.error, "the run could not be driven at all").toBeNull();
    expect(run.steps[0].error, "seam-sweep failed").toBeNull();
    expect(run.steps[1].error, "slice failed").toBeNull();

    const handoff = readIfPresent(handoffOf(tmp)) ?? "";
    expect(handoff, "seam-sweep wrote its output to handoffPath()").not.toContain(SEAM);
    expect(handoff, "slice wrote its output to handoffPath()").not.toContain(PLAN_TITLE);

    expect(
      readIfPresent(checkpointOf(tmp, "seam-sweep")) ?? "",
      "seam-sweep's output is not in its own named checkpoint file either",
    ).toContain(SEAM);
    expect(
      readIfPresent(checkpointOf(tmp, "slice")) ?? "",
      "slice's output is not in its own named checkpoint file either",
    ).toContain(PLAN_TITLE);
  }, 900_000);
});
