import { describe, expect, it } from "vitest";
import { checkoutReporting } from "../shared/claim-host.fixture";
import { createFakeStage } from "../shared/stage.fake";
import { runImplement } from "./implement";
import { markedCount, recordOutOfBrief, TRACKER_TITLE } from "./out-of-brief";
import { trackerWith } from "./out-of-brief-tracker.fixture";

function currentCount(
  issue: { body: string; comments: string[] },
  module: string,
): number | undefined {
  const values = [issue.body, ...issue.comments].map((text) => markedCount(text, module)).filter((each): each is number => each !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

const fakeGit = () => checkoutReporting().git;

function outOfBriefDeps(gh: Parameters<typeof runImplement>[0]["gh"], git: Parameters<typeof runImplement>[0]["git"], exec: Parameters<typeof runImplement>[0]["exec"]) {
  return {
    gh,
    exec,
    git,
    readFile: () => "# CONTEXT\n",
    fileExists: () => false,
    writeFile: () => {},
    issueNumber: 167,
    failingTests: () => [],
  };
}

describe("recordOutOfBrief", () => {
  it("creates the standing tracker issue on the first call and marks the module's count at 1", () => {
    const { gh, issues } = trackerWith();

    const count = recordOutOfBrief(gh, "shape");

    expect(count).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe(TRACKER_TITLE);
    expect(currentCount(issues[0], "shape")).toBe(1);
  });

  it("two calls for the same module leave its marked count at 2, on the same tracker issue", () => {
    const { gh, issues } = trackerWith();

    recordOutOfBrief(gh, "shape");
    const second = recordOutOfBrief(gh, "shape");

    expect(second).toBe(2);
    expect(issues).toHaveLength(1);
    expect(currentCount(issues[0], "shape")).toBe(2);
  });

  it("keeps each module's count separate on the one tracker issue", () => {
    const { gh, issues } = trackerWith();

    recordOutOfBrief(gh, "shape");
    recordOutOfBrief(gh, "shape");
    recordOutOfBrief(gh, "close-gate");

    expect(issues).toHaveLength(1);
    expect(currentCount(issues[0], "shape")).toBe(2);
    expect(currentCount(issues[0], "close-gate")).toBe(1);
  });
});

describe("runImplement: out-of-brief reads", () => {
  it("an implementer trace naming two out-of-brief reads of the same module leaves the tracker issue's marked count at 2 for that module", async () => {
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const { gh, issues } = trackerWith(ticket);
    const git = fakeGit();
    const stage = createFakeStage(
      JSON.stringify({
        files: [{ path: "a/b.ts", content: "x" }],
        summary: "Built the thing, having read shape/CONTEXT.md twice for vocabulary.",
        outOfBriefReads: ["shape", "shape"],
      }),
    );

    await runImplement(outOfBriefDeps(gh, git, stage.exec));

    const tracker = issues.find((issue) => issue.title === TRACKER_TITLE);
    expect(tracker).toBeDefined();
    expect(currentCount(tracker!, "shape")).toBe(2);
  });

  it("an implementer trace naming no out-of-brief reads never creates or touches the tracker issue", async () => {
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const { gh, issues } = trackerWith(ticket);
    const git = fakeGit();
    const stage = createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "Built the thing." }));

    await runImplement(outOfBriefDeps(gh, git, stage.exec));

    expect(issues.find((issue) => issue.title === TRACKER_TITLE)).toBeUndefined();
  });
});

describe("no scenario in this file ever writes the dependency graph", () => {
  it("scans every recorded call on the fake GhExec across every scenario above and finds no `dependencies/blocked_by` write", async () => {
    const allCalls: string[][] = [];

    const s1 = trackerWith();
    recordOutOfBrief(s1.gh, "shape");
    recordOutOfBrief(s1.gh, "shape");
    allCalls.push(...s1.calls);

    const s2 = trackerWith();
    recordOutOfBrief(s2.gh, "shape");
    recordOutOfBrief(s2.gh, "close-gate");
    allCalls.push(...s2.calls);

    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const s3 = trackerWith(ticket);
    const stage = createFakeStage(
      JSON.stringify({
        files: [{ path: "a/b.ts", content: "x" }],
        summary: "s",
        outOfBriefReads: ["shape", "shape"],
      }),
    );
    await runImplement(outOfBriefDeps(s3.gh, fakeGit(), stage.exec));
    allCalls.push(...s3.calls);

    const s4 = trackerWith(ticket);
    const stage2 = createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "s" }));
    await runImplement(outOfBriefDeps(s4.gh, fakeGit(), stage2.exec));
    allCalls.push(...s4.calls);

    expect(allCalls.length).toBeGreaterThan(0);
    for (const call of allCalls) {
      const joined = call.join(" ");
      expect(joined).not.toContain("dependencies/blocked_by");
      expect(joined).not.toContain("blocked_by");
    }
  });
});
