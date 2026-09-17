import { describe, expect, it } from "vitest";
import { test } from "vitest";
import { subIssuesPath } from "./gh-paths";
import { createFakeGh, createRecordingGh } from "./gh.fake";
import { parseIssueNumber } from "./issue-url";

const RECORDED = {
  issueCreate: "https://github.com/collod873/claude-workflow/issues/360\n",
  issueId: "533896463\n",
  blockedByNone: "[]\n",
  blockedByTwo: "[533896463,533896464]\n",
  dispatch: "",
} as const;

const parseId = (raw: string): number => Number(raw.trim());

function parseBlockedByIds(raw: string): number[] {
  const parsed: unknown = JSON.parse(raw.trim());
  if (!Array.isArray(parsed) || !parsed.every((value) => Number.isInteger(value))) {
    throw new Error(`not an array of integer ids: ${JSON.stringify(raw)}`);
  }
  return parsed as number[];
}

describe("the recorded shapes parse the way production parses them", () => {
  it("issue create: a URL whose last segment is the number", () => {
    expect(parseIssueNumber(RECORDED.issueCreate)).toBe(360);
  });

  it("--jq .id: a bare integer", () => {
    expect(Number.isInteger(parseId(RECORDED.issueId))).toBe(true);
  });

  it("blocked_by --jq [.[].id]: an array of integers, possibly empty", () => {
    expect(parseBlockedByIds(RECORDED.blockedByNone)).toEqual([]);
    expect(parseBlockedByIds(RECORDED.blockedByTwo)).toEqual([533896463, 533896464]);
  });
});

describe("createFakeGh answers in the recorded shapes", () => {
  it("issue create prints a URL parseIssueNumber reads, numbering from firstIssueNumber", () => {
    const fake = createFakeGh({ firstIssueNumber: 500 });

    const first = fake.gh(["issue", "create", "--title", "t", "--body", "b"]);
    const second = fake.gh(["issue", "create", "--title", "t", "--body", "b"]);

    expect(first).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+\n$/);
    expect(parseIssueNumber(first)).toBe(500);
    expect(parseIssueNumber(second)).toBe(501);
  });

  it("POST dispatches prints nothing, as a 204 does, and records the event and payload", () => {
    const fake = createFakeGh();

    const out = fake.gh([
      "api",
      "repos/{owner}/{repo}/dispatches",
      "-f",
      "event_type=ticket-ready",
      "-f",
      "client_payload[issue]=42",
    ]);

    expect(out).toBe(RECORDED.dispatch);
    expect(fake.dispatches).toEqual([{ eventType: "ticket-ready", payload: { issue: "42" } }]);
  });

  it("refuses an argv it does not model out loud, and records every call it was asked", () => {
    const fake = createFakeGh();

    expect(() => fake.gh(["pr", "view", "7"])).toThrow(/unhandled argv/);
    expect(fake.calls).toEqual([["pr", "view", "7"]]);
  });
});

test("#628.1: gh.fake.ts's gh throws unhandled argv on an api call, building no api argv itself", () => {
  const fake = createFakeGh();

  expect(() => fake.gh(["api", subIssuesPath(360), "-F", "sub_issue_id=1"])).toThrow(/unhandled argv/);
});

describe("createRecordingGh", () => {
  it("answers nothing and records every argv verbatim, in order", () => {
    const { gh, calls } = createRecordingGh();
    const argv = ["issue", "comment", "42", "--body", "hi"];

    expect(gh(argv)).toBe("");
    expect(gh(["issue", "close", "42"])).toBe("");
    argv.push("--mutated-after-the-call");

    expect(calls).toEqual([
      ["issue", "comment", "42", "--body", "hi"],
      ["issue", "close", "42"],
    ]);
  });
});
