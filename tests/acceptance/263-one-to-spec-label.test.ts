import { describe, expect, it } from "vitest";
import {
  acceptedIdeaIssue,
  closedMapIssue,
  COLD_TRIGGERS,
  runProbe,
  sourceKindOf,
} from "./263-lane-02.fixture";

/**
 * #263, criterion 5. One hand label starts the lane whatever the source, so the collector cannot
 * be read off the label any more - it has to be read off the issue.
 *
 * That is asserted as the property it is: there is one trigger which, run against an accepted idea
 * carrying its sheet and its accept, plans the sheet collector, and, run against a closed map
 * carrying neither, plans the map collector. One label, two collectors, chosen by what the issue
 * is. A lane that reads the label instead has no such trigger - every trigger it has plans the
 * same collector for both issues.
 */
describe("#263 - one label starts the lane and the issue picks the collector", () => {
  // "One to-spec label starts the lane and the collector is picked from the issue, not the label — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`"
  it("One to-spec label starts the lane and the collector is picked from the issue, not the label — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`", () => {
    const onIdea = runProbe({
      entry: "plan",
      issueNumber: 143,
      triggers: COLD_TRIGGERS,
      scenario: { issues: [acceptedIdeaIssue(143)] },
      sheetMarked: [143],
    });
    const onMap = runProbe({
      entry: "plan",
      issueNumber: 144,
      triggers: COLD_TRIGGERS,
      scenario: { issues: [closedMapIssue(144)] },
    });

    expect(onIdea.error, "the probe itself failed").toBeNull();
    expect(onMap.error, "the probe itself failed").toBeNull();

    const picked: Record<string, { idea: string | null; map: string | null }> = {};
    for (const trigger of COLD_TRIGGERS) {
      const idea = onIdea.triggers[trigger];
      const map = onMap.triggers[trigger];
      if (idea === undefined || map === undefined) continue;
      if (idea.accepted === false || map.accepted === false) continue;
      picked[trigger] = { idea: sourceKindOf(idea.plan), map: sourceKindOf(map.plan) };
    }

    const readsTheIssue = Object.keys(picked).filter(
      (trigger) => picked[trigger].idea === "sheet" && picked[trigger].map === "map",
    );

    expect(
      readsTheIssue.length,
      "no single trigger picked its collector from the issue: " + JSON.stringify(picked),
    ).toBeGreaterThan(0);
  }, 300_000);
});
