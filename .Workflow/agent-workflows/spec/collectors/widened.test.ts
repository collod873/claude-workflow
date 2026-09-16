import { expect, test } from "vitest";
import { coldDoorGh } from "../issue-doors.fixture";
import { readSourceMarker, sourceMarker, type SpecSource } from "../publish";
import { planSpecRun } from "../spec";
import { mapTrackerGh } from "./map-gh.fixture";
import { collectWidenedContext } from "./widened";

test(
  "#600.1: planSpecRun returns a widened author plan for an issue carrying the sent-to-spec marker and no decision sheet",
  () => {
    const { gh } = coldDoorGh({ comments: ["<!-- sent-to-spec:v1 -->"] });

    const plan = planSpecRun(gh, { trigger: "to-spec", issueNumber: 538 });

    expect(plan).toMatchObject({
      path: "author",
      input: { kind: "widened", issueNumber: 538 },
      target: { kind: "widened", issue: 538 },
    });
  },
);

test(
  "#600.2: the widened collector returns the issue body as ownerWords and does not throw with no Decisions so far section",
  () => {
    const body = "Its `## Files claimed` names more paths than lane 04 can author against in one budget.";
    const gh = mapTrackerGh(538, body);

    const context = collectWidenedContext(gh, 538);

    expect(context.ownerWords).toBe(body);
  },
);

test("#600.3: readSourceMarker round-trips a widened source", () => {
  const widenedSource = { kind: "widened", issue: 538 } as unknown as SpecSource;

  expect(readSourceMarker(sourceMarker(widenedSource))).toEqual({ kind: "widened", issue: 538 });
});
