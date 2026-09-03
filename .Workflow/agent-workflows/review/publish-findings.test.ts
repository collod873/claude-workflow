import { describe, expect, it } from "vitest";
import { createFakeGh } from "../shared/gh.fake";
import { FINDING_LABEL } from "./counter";
import type { Finding } from "./structural-refusal";
import { publishFinding, publishFindings } from "./publish-findings";

const NOTIFICATION_ARGV_NEEDLES = ["pr", "comment", "notify", "slack", "webhook"];

describe("publishFinding", () => {
  it("makes exactly one gh call: issue create, carrying the finding label and the assignee", () => {
    const { gh, calls } = createFakeGh({ firstIssueNumber: 900 });
    const finding: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };

    const issue = publishFinding(gh, finding, "collod873");

    expect(issue).toBe(900);
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("issue");
    expect(calls[0][1]).toBe("create");
    expect(calls[0]).toContain("--label");
    expect(calls[0]).toContain(FINDING_LABEL);
    expect(calls[0]).toContain("--assignee");
    expect(calls[0]).toContain("collod873");
  });

  it("carries the finding's full message as the issue body", () => {
    const { gh, calls } = createFakeGh();
    const finding: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };

    publishFinding(gh, finding, "collod873");

    const bodyIndex = calls[0].indexOf("--body");
    expect(calls[0][bodyIndex + 1]).toBe(finding.message);
  });

  it("makes no call that resembles a PR comment or any other notification", () => {
    const { gh, calls } = createFakeGh();
    const finding: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };

    publishFinding(gh, finding, "collod873");

    const flat = calls.flat().map((token) => token.toLowerCase());
    for (const needle of NOTIFICATION_ARGV_NEEDLES) {
      expect(flat).not.toContain(needle);
    }
  });
});

describe("publishFindings", () => {
  it("files one issue per finding, in order, and returns their numbers in the same order", () => {
    const { gh, calls } = createFakeGh({ firstIssueNumber: 101 });

    const findings: Finding[] = [
      { message: "src/a.ts:1 first finding" },
      { message: "src/b.ts:2 second finding" },
      { message: "src/c.ts:3 third finding" },
    ];

    const issues = publishFindings(gh, findings, "collod873");

    expect(issues).toEqual([101, 102, 103]);
    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call[0]).toBe("issue");
      expect(call[1]).toBe("create");
    }
  });

  it("makes no gh calls at all for an empty survivor list", () => {
    const { gh, calls } = createFakeGh();

    expect(publishFindings(gh, [], "collod873")).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("makes only issue-create calls for a batch of survivors, never a PR comment or other notification", () => {
    const { gh, calls } = createFakeGh();
    const findings: Finding[] = [
      { message: "src/a.ts:1 first finding" },
      { message: "src/b.ts:2 second finding" },
    ];

    publishFindings(gh, findings, "collod873");

    for (const call of calls) {
      expect(call[0]).toBe("issue");
      expect(call[1]).toBe("create");
      expect(call).toContain(FINDING_LABEL);
    }
  });
});
