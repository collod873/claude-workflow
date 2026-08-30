import { describe, expect, it } from "vitest";
import { dispatchRequestIndex, labelAddIndex, runProbe } from "./263-lane-02.fixture";

/**
 * #263, criterion 2. `applyGate` is called twice: once with nothing but the issue, and once with a
 * count that says the run left something unresolved. Either way the label has to be written and
 * the dispatch has to be asked for, and the label has to come first - that ordering is what makes
 * a lost dispatch a countable durable trace rather than a silent stop.
 */
describe("#263 - applyGate writes the label before it asks for the dispatch", () => {
  // "sliceable is applied before the dispatch is requested — check: `npx vitest run .Workflow/agent-workflows/spec/open-questions.test.ts`"
  it("sliceable is applied before the dispatch is requested — check: `npx vitest run .Workflow/agent-workflows/spec/open-questions.test.ts`", () => {
    const probe = runProbe({ entry: "gate", issueNumber: 42, counts: [null, 3] });

    expect(probe.error, "the probe itself failed").toBeNull();
    expect(probe.runs.length).toBe(2);

    for (const run of probe.runs) {
      const why = JSON.stringify(run);
      const labelAt = labelAddIndex(run.calls, probe.constants.sliceableLabel);
      const dispatchAt = dispatchRequestIndex(run.calls, probe.constants.dispatchEventType);

      expect(labelAt, why).toBeGreaterThanOrEqual(0);
      expect(dispatchAt, why).toBeGreaterThanOrEqual(0);
      expect(labelAt, why).toBeLessThan(dispatchAt);
    }
  }, 300_000);
});
