import { beforeEach, describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGit } from "../shared/git.fake";
import { isolateCheckpointsPerTest } from "../shared/isolate-checkpoints.setup";
import { createFakeStage } from "../shared/stage.fake";
import { countCriteria } from "../shared/ticket-shape";
import { runSpecAmendment, type SpecGapReport } from "./amend";

// Every test in this file feeds `runSpecAmendment` the same `GAP`, so every
// call renders the same substituted prompt for the "amend" stage — without a
// fresh CHECKPOINTS_DIR per test, the second test to run would silently reuse
// whichever canned response the first test's checkpoint happened to record.
// See `isolateCheckpointsPerTest`'s own comment.
beforeEach(() => {
  isolateCheckpointsPerTest();
});

const PRD_BODY = [
  "## What to build",
  "Some prose.",
  "",
  "## Acceptance criteria",
  "- [ ] returns 400 on a malformed request",
  "- [ ] logs the rejection reason",
].join("\n");

const GAP: SpecGapReport = {
  prdIssueNumber: 42,
  prdBody: PRD_BODY,
  criterion: "returns 400 on a malformed request",
  gapReport: "An acceptance test expected a 422, the spec says 400 — the two disagree.",
  slice: "#87",
};

/** An in-memory `GhExec` recording every call, answering `issue create` with an incrementing issue URL. */
function createFakeGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  let nextIssueNumber = 500;
  const gh: GhExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "create") {
      return `https://github.com/owner/repo/issues/${nextIssueNumber++}\n`;
    }
    return "";
  };
  return { gh, calls };
}

/** A `GitExec` handler good enough for `syncNotesRef`'s ls-remote/notes/push sequence. */
function fakeGitHandler(args: string[]): string {
  if (args.includes("ls-remote")) return "";
  if (args.includes("notes")) return "";
  if (args.includes("push")) return "";
  throw new Error(`fake git: unhandled argv: ${JSON.stringify(args)}`);
}

const CLARIFIED_RESPONSE = JSON.stringify({
  verdict: "clarified",
  clarifiedCriterion: "returns 400 on a malformed request body, before any write to the database",
  reason: "The original wording named no observable check on ordering.",
});

const NEEDS_SCOPE_RESPONSE = JSON.stringify({
  verdict: "needs-scope",
  clarifiedCriterion: "",
  reason: "The gap asks for a retry policy the PRD never claimed at all.",
});

describe("runSpecAmendment — clarified", () => {
  it("updates the PRD body in place and leaves the criteria count unchanged", async () => {
    const stage = createFakeStage(CLARIFIED_RESPONSE);
    const gh = createFakeGh();
    const git = createFakeGit(fakeGitHandler);

    const result = await runSpecAmendment(
      { exec: stage.exec, gh: gh.gh, git: git.git, repoDir: "/repo" },
      GAP,
    );

    expect(result).toEqual({
      verdict: "clarified",
      prdBody: expect.stringContaining(
        "returns 400 on a malformed request body, before any write to the database",
      ),
    });
    if (result.verdict !== "clarified") throw new Error("expected clarified");
    expect(result.prdBody).not.toContain("- [ ] returns 400 on a malformed request\n");
    expect(countCriteria(result.prdBody)).toBe(countCriteria(PRD_BODY));

    // Never a body edit (`intake.test.ts` refuses that, repo-wide) — the
    // clarification lands as a comment, and this asserts the new wording
    // reached the PRD issue that way.
    const commentCall = gh.calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(commentCall).toBeDefined();
    const commentBody = commentCall?.[commentCall.indexOf("--body") + 1] ?? "";
    expect(commentBody).toContain(
      "returns 400 on a malformed request body, before any write to the database",
    );
    expect(gh.calls.some((call) => call[0] === "issue" && call[1] === "edit")).toBe(false);
  });

  it("pushes the amendment commit via a fake GitExec, with zero pr create calls on the fake GhExec", async () => {
    const stage = createFakeStage(CLARIFIED_RESPONSE);
    const gh = createFakeGh();
    const git = createFakeGit(fakeGitHandler);

    await runSpecAmendment({ exec: stage.exec, gh: gh.gh, git: git.git, repoDir: "/repo" }, GAP);

    expect(git.calls.some((call) => call.includes("push"))).toBe(true);
    expect(gh.calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);
  });

  it("refuses, before any write, when the model's wording would add a criterion", async () => {
    const growingResponse = JSON.stringify({
      verdict: "clarified",
      clarifiedCriterion: "returns 400 on a malformed request\n- [ ] and retries once",
      reason: "widened it",
    });
    const stage = createFakeStage(growingResponse);
    const gh = createFakeGh();
    const git = createFakeGit(fakeGitHandler);

    await expect(
      runSpecAmendment({ exec: stage.exec, gh: gh.gh, git: git.git, repoDir: "/repo" }, GAP),
    ).rejects.toThrow(/never add one/);

    expect(gh.calls).toHaveLength(0);
    expect(git.calls).toHaveLength(0);
  });
});

describe("runSpecAmendment — needs-scope", () => {
  it("produces zero PRD edits and files exactly one idea issue naming the slice", async () => {
    const stage = createFakeStage(NEEDS_SCOPE_RESPONSE);
    const gh = createFakeGh();
    const git = createFakeGit(fakeGitHandler);

    const result = await runSpecAmendment(
      { exec: stage.exec, gh: gh.gh, git: git.git, repoDir: "/repo" },
      GAP,
    );

    expect(result.verdict).toBe("refused");

    const editCalls = gh.calls.filter((call) => call[0] === "issue" && call[1] === "edit");
    expect(editCalls).toHaveLength(0);

    const createCalls = gh.calls.filter((call) => call[0] === "issue" && call[1] === "create");
    expect(createCalls).toHaveLength(1);
    const [createCall] = createCalls;
    expect(createCall).toContain("--label");
    expect(createCall[createCall.indexOf("--label") + 1]).toBe("idea");
    const body = createCall[createCall.indexOf("--body") + 1];
    expect(body).toContain(GAP.slice);

    // Nothing to commit when the amendment refused — the PRD was never touched.
    expect(git.calls).toHaveLength(0);
  });

  it("makes zero pr create calls on the fake GhExec", async () => {
    const stage = createFakeStage(NEEDS_SCOPE_RESPONSE);
    const gh = createFakeGh();
    const git = createFakeGit(fakeGitHandler);

    await runSpecAmendment({ exec: stage.exec, gh: gh.gh, git: git.git, repoDir: "/repo" }, GAP);

    expect(gh.calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);
  });
});
