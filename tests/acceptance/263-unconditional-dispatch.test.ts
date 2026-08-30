import { describe, expect, it } from "vitest";
import {
  acceptedIdeaIssue,
  addedLabels,
  COLD_TRIGGERS,
  dispatchRequestIndex,
  publishedSpecIssue,
  runProbe,
  STAGE_RESPONSE,
} from "./263-lane-02.fixture";

/**
 * #263, criterion 1. The stage payload the probe answers with carries something the critic could
 * not settle in every field such a thing could ride out on - the author's own open questions, the
 * critic's findings, an unresolved list - which is exactly the run the old gate held. The claim is
 * that it labels and dispatches anyway.
 *
 * Both entrances are put through it: the warm one, which is the whole of the critic-only door, and
 * every cold trigger that got as far as spending a model. A cold trigger that never reached a
 * model is not a run whose critic did anything, so it is skipped rather than asserted about.
 */
describe("#263 - the gate applies sliceable unconditionally", () => {
  // "A run whose critic could not resolve everything still labels sliceable and dispatches — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`"
  it("A run whose critic could not resolve everything still labels sliceable and dispatches — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`", () => {
    const warm = runProbe({
      entry: "critique",
      issueNumber: 180,
      scenario: { issues: [publishedSpecIssue(180)] },
      stageResponse: STAGE_RESPONSE,
    });

    expect(warm.error, "the probe itself failed").toBeNull();
    const run = warm.run;
    if (run === null) throw new Error("the critic door produced no run: " + JSON.stringify(warm));

    const why = JSON.stringify({ error: run.error, calls: run.calls });
    expect(run.stageCalls.length, why).toBeGreaterThan(0);
    expect(addedLabels(run.calls), why).toContain(warm.constants.sliceableLabel);
    expect(
      dispatchRequestIndex(run.calls, warm.constants.dispatchEventType),
      why,
    ).toBeGreaterThanOrEqual(0);

    const cold = runProbe({
      entry: "lane",
      issueNumber: 143,
      triggers: COLD_TRIGGERS,
      scenario: { issues: [acceptedIdeaIssue(143)] },
      sheetMarked: [143],
      stageResponse: STAGE_RESPONSE,
    });

    expect(cold.error, "the probe itself failed").toBeNull();
    for (const [trigger, coldRun] of Object.entries(cold.triggers)) {
      if (coldRun.stageCalls.length === 0) continue;
      const detail = trigger + " " + JSON.stringify({ error: coldRun.error, calls: coldRun.calls });
      expect(addedLabels(coldRun.calls), detail).toContain(cold.constants.sliceableLabel);
      expect(
        dispatchRequestIndex(coldRun.calls, cold.constants.dispatchEventType),
        detail,
      ).toBeGreaterThanOrEqual(0);
    }
  }, 300_000);
});
