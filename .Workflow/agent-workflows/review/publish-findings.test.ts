import { describe, expect, it } from "vitest";
import { trackerMemory } from "../shared/tracker-memory";
import type { CreateIssueInput } from "../shared/tracker";
import { FINDING_LABEL } from "./counter";
import type { Finding } from "./structural-refusal";
import { publishFinding, publishFindings } from "./publish-findings";

function fakeTracker(firstIssueNumber?: number) {
  const createdIssues: CreateIssueInput[] = [];
  const tracker = trackerMemory({ createdIssues, firstIssueNumber });
  return { tracker, createdIssues };
}

describe("publishFinding", () => {
  it("creates exactly one issue, carrying the finding label and the assignee", () => {
    const { tracker, createdIssues } = fakeTracker(899);
    const finding: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };

    const issue = publishFinding(tracker, finding, "collod873");

    expect(issue).toBe(900);
    expect(createdIssues.length).toBe(1);
    expect(createdIssues[0].label).toBe(FINDING_LABEL);
    expect(createdIssues[0].assignee).toBe("collod873");
  });

  it("carries the finding's full message as the issue body", () => {
    const { tracker, createdIssues } = fakeTracker();
    const finding: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };

    publishFinding(tracker, finding, "collod873");

    expect(createdIssues[0].body).toBe(finding.message);
  });
});

describe("publishFindings", () => {
  it("files one issue per finding, in order, and returns their numbers in the same order", () => {
    const { tracker, createdIssues } = fakeTracker(100);

    const findings: Finding[] = [
      { message: "src/a.ts:1 first finding" },
      { message: "src/b.ts:2 second finding" },
      { message: "src/c.ts:3 third finding" },
    ];

    const issues = publishFindings(tracker, findings, "collod873");

    expect(issues).toEqual([101, 102, 103]);
    expect(createdIssues.length).toBe(3);
  });

  it("creates no issues at all for an empty survivor list", () => {
    const { tracker, createdIssues } = fakeTracker();

    expect(publishFindings(tracker, [], "collod873")).toEqual([]);
    expect(createdIssues.length).toBe(0);
  });

  it("carries the finding label on every issue created for a batch of survivors", () => {
    const { tracker, createdIssues } = fakeTracker();
    const findings: Finding[] = [
      { message: "src/a.ts:1 first finding" },
      { message: "src/b.ts:2 second finding" },
    ];

    publishFindings(tracker, findings, "collod873");

    for (const issue of createdIssues) {
      expect(issue.label).toBe(FINDING_LABEL);
    }
  });
});
