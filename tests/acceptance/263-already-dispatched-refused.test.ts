import { describe, expect, it } from "vitest";
import {
  acceptedIdeaIssue,
  addedLabels,
  COLD_TRIGGERS,
  createdIssues,
  runProbe,
  STAGE_RESPONSE,
} from "./263-lane-02.fixture";

/**
 * #263, criterion 4. The same source issue is run twice: once with nothing on the tracker behind
 * it, and once with a spec already carrying `sliceable` that records this issue as its source.
 *
 * The first run is what proves a door works at all - a trigger that spent a model there is a door
 * that is open. The claim is that every door that works refuses the second run, and refuses it
 * before it spends anything: no stage call, nothing published, no label.
 *
 * Two already-dispatched specs stand behind the source, one recorded under each source kind, so
 * the refusal cannot turn on which collector the lane would have picked.
 */
describe("#263 - a source whose spec already dispatched is refused", () => {
  // "A source issue whose spec already carries sliceable is refused before a model runs — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`"
  it("A source issue whose spec already carries sliceable is refused before a model runs — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`", () => {
    const scenario = { issues: [acceptedIdeaIssue(143)] };

    const fresh = runProbe({
      entry: "lane",
      issueNumber: 143,
      triggers: COLD_TRIGGERS,
      scenario,
      sheetMarked: [143],
      stageResponse: STAGE_RESPONSE,
    });
    expect(fresh.error, "the probe itself failed").toBeNull();

    const alreadyDispatched = runProbe({
      entry: "lane",
      issueNumber: 143,
      triggers: COLD_TRIGGERS,
      scenario,
      sheetMarked: [143],
      sliceableSpecs: [
        { number: 900, sourceKind: "sheet", sourceIssue: 143 },
        { number: 901, sourceKind: "map", sourceIssue: 143 },
      ],
      stageResponse: STAGE_RESPONSE,
    });
    expect(alreadyDispatched.error, "the probe itself failed").toBeNull();

    const working = Object.keys(fresh.triggers).filter(
      (trigger) => fresh.triggers[trigger].stageCalls.length > 0,
    );
    expect(
      working.length,
      "no cold door spent a model on a source with no spec behind it: " + JSON.stringify(fresh.triggers),
    ).toBeGreaterThan(0);

    for (const trigger of working) {
      const run = alreadyDispatched.triggers[trigger];
      const why = trigger + " " + JSON.stringify({ error: run.error, calls: run.calls });
      expect(run.stageCalls.length, why).toBe(0);
      expect(createdIssues(run.calls), why).toEqual([]);
      expect(addedLabels(run.calls), why).not.toContain(alreadyDispatched.constants.sliceableLabel);
    }
  }, 300_000);
});
