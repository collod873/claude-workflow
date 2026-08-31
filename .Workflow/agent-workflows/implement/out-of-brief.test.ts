import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { createFakeStage } from "../shared/stage.fake";
import { runImplement } from "./implement";
import { markedCount, recordOutOfBrief, TRACKER_TITLE } from "./out-of-brief";


/**
 * An in-memory `gh` issue tracker: `issue create`/`issue comment`/`issue
 * list`/`issue view --json comments` against one array of issues, each
 * carrying its own comments, plus `issue view` (title/body) for a fixed
 * ticket and `pr create`/`api` stubs for `runImplement`'s own flow —
 * everything the scenarios below call through one `GhExec`, so the "no
 * `dependencies/blocked_by` write, ever" test can scan every call any of
 * them made. Deliberately has no `issue edit --body` branch: the module
 * under test must never call it.
 */
function fakeGhWithTracker(ticket?: { title: string; body: string }): {
  gh: GhExec;
  calls: string[][];
  issues: Array<{ number: number; title: string; body: string; state: string; comments: string[] }>;
} {
  const calls: string[][] = [];
  const issues: Array<{ number: number; title: string; body: string; state: string; comments: string[] }> = [];
  let nextNumber = 1;

  const gh: GhExec = (args) => {
    calls.push([...args]);

    if (args[0] === "issue" && args[1] === "view" && args.includes("--json") && args[args.indexOf("--json") + 1] === "comments") {
      const number = Number(args[2]);
      const issue = issues.find((each) => each.number === number);
      if (!issue) throw new Error(`fake gh: issue view on unknown #${number}`);
      return JSON.stringify({ comments: issue.comments.map((body) => ({ body })) });
    }
    if (args[0] === "issue" && args[1] === "view") {
      if (!ticket) throw new Error("fake gh: no ticket configured for `issue view`");
      return JSON.stringify(ticket);
    }
    if (args[0] === "issue" && args[1] === "list") {
      return JSON.stringify(issues.map(({ number, body, state }) => ({ number, body, state })));
    }
    if (args[0] === "issue" && args[1] === "create") {
      const titleIdx = args.indexOf("--title");
      const bodyIdx = args.indexOf("--body");
      const number = nextNumber++;
      issues.push({ number, title: args[titleIdx + 1], body: args[bodyIdx + 1], state: "OPEN", comments: [] });
      return `https://github.com/owner/repo/issues/${number}\n`;
    }
    if (args[0] === "issue" && args[1] === "comment") {
      const number = Number(args[2]);
      const bodyIdx = args.indexOf("--body");
      const issue = issues.find((each) => each.number === number);
      if (!issue) throw new Error(`fake gh: issue comment on unknown #${number}`);
      issue.comments.push(args[bodyIdx + 1]);
      return "";
    }
    if (args[0] === "pr" && args[1] === "create") return "https://github.com/owner/repo/pull/42\n";
    if (args[0] === "api") return "";
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, issues };
}

/** A single module's current count across the fake tracker's body and comments — test-side helper, not the module under test's own aggregation. */
function currentCount(
  issue: { body: string; comments: string[] },
  module: string,
): number | undefined {
  const values = [issue.body, ...issue.comments].map((text) => markedCount(text, module)).filter((each): each is number => each !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

/** A fake `GitExec` that records every call and answers nothing. */
function fakeGit(): GitExec {
  return () => "";
}

describe("recordOutOfBrief", () => {
  it("creates the standing tracker issue on the first call and marks the module's count at 1", () => {
    const { gh, issues } = fakeGhWithTracker();

    const count = recordOutOfBrief(gh, "shape");

    expect(count).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe(TRACKER_TITLE);
    expect(currentCount(issues[0], "shape")).toBe(1);
  });

  it("two calls for the same module leave its marked count at 2, on the same tracker issue", () => {
    const { gh, issues } = fakeGhWithTracker();

    recordOutOfBrief(gh, "shape");
    const second = recordOutOfBrief(gh, "shape");

    expect(second).toBe(2);
    expect(issues).toHaveLength(1);
    expect(currentCount(issues[0], "shape")).toBe(2);
  });

  it("keeps each module's count separate on the one tracker issue", () => {
    const { gh, issues } = fakeGhWithTracker();

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
    const { gh, issues } = fakeGhWithTracker(ticket);
    const git = fakeGit();
    const stage = createFakeStage(
      JSON.stringify({
        files: [{ path: "a/b.ts", content: "x" }],
        summary: "Built the thing, having read shape/CONTEXT.md twice for vocabulary.",
        outOfBriefReads: ["shape", "shape"],
      }),
    );

    await runImplement({
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [],
    });

    const tracker = issues.find((issue) => issue.title === TRACKER_TITLE);
    expect(tracker).toBeDefined();
    expect(currentCount(tracker!, "shape")).toBe(2);
  });

  it("an implementer trace naming no out-of-brief reads never creates or touches the tracker issue", async () => {
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const { gh, issues } = fakeGhWithTracker(ticket);
    const git = fakeGit();
    const stage = createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "Built the thing." }));

    await runImplement({
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [],
    });

    expect(issues.find((issue) => issue.title === TRACKER_TITLE)).toBeUndefined();
  });
});

describe("no scenario in this file ever writes the dependency graph", () => {
  it("scans every recorded call on the fake GhExec across every scenario above and finds no `dependencies/blocked_by` write", async () => {
    const allCalls: string[][] = [];

    // Scenario 1: recordOutOfBrief, twice, same module.
    const s1 = fakeGhWithTracker();
    recordOutOfBrief(s1.gh, "shape");
    recordOutOfBrief(s1.gh, "shape");
    allCalls.push(...s1.calls);

    // Scenario 2: recordOutOfBrief across two modules.
    const s2 = fakeGhWithTracker();
    recordOutOfBrief(s2.gh, "shape");
    recordOutOfBrief(s2.gh, "close-gate");
    allCalls.push(...s2.calls);

    // Scenario 3: runImplement with two out-of-brief reads of the same module.
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const s3 = fakeGhWithTracker(ticket);
    const stage = createFakeStage(
      JSON.stringify({
        files: [{ path: "a/b.ts", content: "x" }],
        summary: "s",
        outOfBriefReads: ["shape", "shape"],
      }),
    );
    await runImplement({
      gh: s3.gh,
      exec: stage.exec,
      git: fakeGit(),
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [],
    });
    allCalls.push(...s3.calls);

    // Scenario 4: runImplement with no out-of-brief reads at all.
    const s4 = fakeGhWithTracker(ticket);
    const stage2 = createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "s" }));
    await runImplement({
      gh: s4.gh,
      exec: stage2.exec,
      git: fakeGit(),
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [],
    });
    allCalls.push(...s4.calls);

    expect(allCalls.length).toBeGreaterThan(0);
    for (const call of allCalls) {
      const joined = call.join(" ");
      expect(joined).not.toContain("dependencies/blocked_by");
      expect(joined).not.toContain("blocked_by");
    }
  });
});
