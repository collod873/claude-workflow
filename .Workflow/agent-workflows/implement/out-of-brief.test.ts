import { describe, expect, it } from "vitest";
import { checkoutReporting } from "../shared/claim-host.fixture";
import { createFakeStage } from "../shared/stage.fake";
import { runImplement } from "./implement";
import { markedCount, recordOutOfBrief, TRACKER_TITLE } from "./out-of-brief";
import { trackerWith } from "./out-of-brief-tracker.fixture";

/**
 * ADR-0042: an out-of-brief read is recorded on the standing tracker issue and nothing else. The
 * tracker the scenarios run against is `trackerWith` (`./out-of-brief-tracker.fixture.ts`).
 */

/** A single module's current count across the fake tracker's body and comments — test-side helper, not the module under test's own aggregation. */
function currentCount(
  issue: { body: string; comments: string[] },
  module: string,
): number | undefined {
  const values = [issue.body, ...issue.comments].map((text) => markedCount(text, module)).filter((each): each is number => each !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

/** The ordinary checkout, where the implementer's file changed — the tracker is the subject here, not the landing. */
const fakeGit = () => checkoutReporting().git;

/**
 * The `ImplementDeps` every scenario here builds — same inert filesystem, same ticket number, and
 * `failingTests` as a thunk. One builder rather than four copies: a one-token edit made them
 * identical enough for the clone gate to refuse them, and the duplication was the real finding.
 */
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

describe("runImplement — out-of-brief reads", () => {
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

    // Scenario 1: recordOutOfBrief, twice, same module.
    const s1 = trackerWith();
    recordOutOfBrief(s1.gh, "shape");
    recordOutOfBrief(s1.gh, "shape");
    allCalls.push(...s1.calls);

    // Scenario 2: recordOutOfBrief across two modules.
    const s2 = trackerWith();
    recordOutOfBrief(s2.gh, "shape");
    recordOutOfBrief(s2.gh, "close-gate");
    allCalls.push(...s2.calls);

    // Scenario 3: runImplement with two out-of-brief reads of the same module.
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

    // Scenario 4: runImplement with no out-of-brief reads at all.
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
