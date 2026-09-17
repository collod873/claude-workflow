import { expect, test } from "vitest";
import { readSourceMarker, sourceMarker, type SpecSource } from "../publish";
import { planSpecRun } from "../spec";
import { collectWidenedContext } from "./widened";
import { trackerGh } from "../../shared/tracker-gh";
import { trackerMemory } from "../../shared/tracker-memory";
import { createIssueGh } from "../../shared/gh.fake";

test(
  "#600.1: planSpecRun returns a widened author plan for an issue carrying the sent-to-spec marker and no decision sheet",
  () => {
    const { gh } = createIssueGh((fields) =>
      fields === "comments" ? JSON.stringify({ comments: [{ body: "<!-- sent-to-spec:v1 -->" }] }) : undefined,
    );

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
    const tracker = trackerMemory({ issues: { 538: { body } } });

    const context = collectWidenedContext(tracker, 538);

    expect(context.ownerWords).toBe(body);
  },
);

test("#600.3: readSourceMarker round-trips a widened source", () => {
  const widenedSource = { kind: "widened", issue: 538 } as unknown as SpecSource;

  expect(readSourceMarker(sourceMarker(widenedSource))).toEqual({ kind: "widened", issue: 538 });
});

test("#615.4: the widened collector reads the issue body through a Tracker built over trackerGh, not a bare GhExec", () => {
  const body = "Its `## Files claimed` names more paths than lane 04 can author against in one budget.";
  const { gh } = createIssueGh((fields) => (fields === "body" ? JSON.stringify({ body }) : undefined));
  const tracker = trackerGh(gh) as unknown as Parameters<typeof collectWidenedContext>[0];

  const context = collectWidenedContext(tracker, 538);

  expect(context.ownerWords).toBe(body);
});
