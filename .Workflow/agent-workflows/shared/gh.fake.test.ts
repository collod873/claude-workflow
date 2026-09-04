import { describe, expect, it } from "vitest";
import { blockedByPath, GIT_REFS_PATH, issuePath, subIssuesPath } from "./gh-paths";
import { createFakeGh, createRecordingGh, simulateClaimRef, type FakeGhOptions } from "./gh.fake";
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

function fakeWithIssues(count: number, options: Omit<FakeGhOptions, "firstIssueNumber"> = {}) {
  const fake = createFakeGh({ firstIssueNumber: 500, ...options });
  const created = Array.from({ length: count }, (_, i) => {
    const number = parseIssueNumber(fake.gh(["issue", "create", "--title", `slice ${i + 1}`, "--body", "…"]));
    const id = parseId(fake.gh(["api", issuePath(number), "--jq", ".id"]));
    return { number, id };
  });
  return { ...fake, created };
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

  it("--jq .id prints a bare integer that is not the issue number", () => {
    const { created } = fakeWithIssues(1);

    expect(Number.isInteger(created[0].id)).toBe(true);
    expect(created[0].id).not.toBe(created[0].number);
  });

  it("--jq .id refuses an issue nothing created, rather than inventing an id", () => {
    const fake = createFakeGh();

    expect(() => fake.gh(["api", issuePath(999), "--jq", ".id"])).toThrow(/no issue #999/);
  });

  it("GET blocked_by prints the ids the wiring writes recorded, in the shape [.[].id] projects", () => {
    const { gh, created } = fakeWithIssues(3);
    const [root, other, blocked] = created;
    gh(["api", blockedByPath(blocked.number), "-F", `issue_id=${root.id}`]);
    gh(["api", blockedByPath(blocked.number), "-F", `issue_id=${other.id}`]);

    expect(parseBlockedByIds(gh(["api", blockedByPath(blocked.number), "--jq", "[.[].id]"]))).toEqual([root.id, other.id]);
    expect(parseBlockedByIds(gh(["api", blockedByPath(root.number), "--jq", "[.[].id]"]))).toEqual([]);
  });

  it("dropEdges accepts a wiring write but leaves it out of the read-back, the failure a verification exists to catch", () => {
    const { gh, calls, created } = fakeWithIssues(2, { dropEdges: [{ blockedNumber: 501, blockerNumber: 500 }] });
    const [root, blocked] = created;

    expect(gh(["api", blockedByPath(blocked.number), "-F", `issue_id=${root.id}`])).toBe("");
    expect(parseBlockedByIds(gh(["api", blockedByPath(blocked.number), "--jq", "[.[].id]"]))).toEqual([]);
    expect(calls.filter((call) => call.includes("-F"))).toHaveLength(1);
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

  it("sub_issues attaches the -F sub_issue_id under the parent, by REST id", () => {
    const { gh, created, subIssuesByParent } = fakeWithIssues(2);

    for (const { id } of created) gh(["api", subIssuesPath(360), "-F", `sub_issue_id=${id}`]);

    expect(subIssuesByParent.get(360)).toEqual(created.map(({ id }) => id));
  });

  it.each([
    ["sub_issues", subIssuesPath(360), "sub_issue_id=1"],
    ["blocked_by", blockedByPath(360), "issue_id=1"],
  ])("refuses -f on %s, naming the flag the real API wants", (_endpoint, path, field) => {
    const fake = createFakeGh();

    expect(() => fake.gh(["api", path, "-f", field])).toThrow(/must be -F/);
  });

  it("refuses an argv it does not model out loud, and records every call it was asked", () => {
    const fake = createFakeGh();

    expect(() => fake.gh(["pr", "view", "7"])).toThrow(/unhandled argv/);
    expect(fake.calls).toEqual([["pr", "view", "7"]]);
  });
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

describe("simulateClaimRef", () => {
  const post = (branch: string) => ["api", GIT_REFS_PATH, "-f", `ref=refs/heads/${branch}`, "-f", "sha=abc"];
  const del = (branch: string) => ["api", "--method", "DELETE", `${GIT_REFS_PATH}/heads/${branch}`];

  it("creates a ref once, 422s on the second claim, and releases it on DELETE", () => {
    const refs = new Set<string>();

    expect(simulateClaimRef(post("implement/issue-9"), refs)).toBe("");
    expect(() => simulateClaimRef(post("implement/issue-9"), refs)).toThrow(/HTTP 422/);
    expect(simulateClaimRef(del("implement/issue-9"), refs)).toBe("");
    expect(refs.has("implement/issue-9")).toBe(false);
    expect(simulateClaimRef(post("implement/issue-9"), refs)).toBe("");
  });

  it("answers undefined for any other call, so a caller composes it with a plain if", () => {
    const refs = new Set<string>(["implement/issue-9"]);

    expect(simulateClaimRef(["issue", "view", "9"], refs)).toBeUndefined();
    expect(simulateClaimRef(["api", issuePath(9)], refs)).toBeUndefined();
    expect(refs).toEqual(new Set(["implement/issue-9"]));
  });
});
