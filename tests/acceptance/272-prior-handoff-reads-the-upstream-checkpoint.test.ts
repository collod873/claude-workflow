import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanUp,
  fixturePlan,
  handoffOf,
  makeTmp,
  runLaneProbe,
} from "./272-checkpoint.fixture";

/**
 * #272's fourth criterion, quoted verbatim in the test name below.
 *
 * The decoy is planted at the shared handoff path *after* seam-sweep has run, so it beats whatever
 * that stage may or may not have left there. What reaches the slice stage's SEAM_MANIFEST is then a
 * plain question about which file readPriorHandoff opened: the upstream stage's checkpoint carries
 * one string, the shared handoff carries the other, and only one of them can be in the prompt the
 * model was handed.
 */

const SEAM = "the seam that only the seam-sweep checkpoint carries";
const DECOY = "the decoy that only the shared handoff file carries";

const tmps: string[] = [];
afterAll(() => cleanUp(tmps));

describe("a downstream stage reads its upstream's named checkpoint", () => {
  it("readPriorHandoff reads the upstream stage's checkpoint file, not the shared handoff — check: `npx vitest run .Workflow/agent-workflows/to-tickets/to-tickets.test.ts`", () => {
    const tmp = makeTmp();
    tmps.push(tmp);

    const swept = runLaneProbe(tmp, [
      { stage: "seam-sweep", response: JSON.stringify({ entries: [SEAM] }) },
    ]);
    expect(swept.error, "the seam-sweep run could not be driven at all").toBeNull();
    expect(swept.steps[0].error, "seam-sweep failed").toBeNull();

    writeFileSync(handoffOf(tmp), JSON.stringify([DECOY]), "utf8");

    const sliced = runLaneProbe(tmp, [
      { stage: "slice", response: JSON.stringify({ slices: fixturePlan(SEAM) }) },
    ]);
    expect(sliced.error, "the slice run could not be driven at all").toBeNull();
    expect(
      sliced.steps[0].execCalls,
      "slice never reached its model, so nothing read a seam manifest: " +
        String(sliced.steps[0].error),
    ).toBe(1);

    const prompt = sliced.steps[0].prompts[0];
    expect(
      prompt,
      "slice's SEAM_MANIFEST did not carry the upstream stage's checkpoint",
    ).toContain(SEAM);
    expect(
      prompt,
      "slice read the shared handoff path instead of the upstream stage's checkpoint",
    ).not.toContain(DECOY);
  }, 900_000);
});
