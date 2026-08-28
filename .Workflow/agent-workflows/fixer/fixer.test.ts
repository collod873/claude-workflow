import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import type { StageExec } from "../shared/stage";
import {
  assembleFixBrief,
  BLOCKED_LABEL,
  MAX_ATTEMPTS,
  runFixer,
  signaturesEqual,
  type FailureSignature,
  type FixerDeps,
  type FixerTestResult,
} from "./fixer";

/** A fake `GhExec` that records every call verbatim, in order, answering nothing. */
function fakeGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return "";
  };
  return { gh, calls };
}

/** A fake `GitExec` that records every call and answers nothing. */
function fakeGit(): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push([...args]);
    return "";
  };
  return { git, calls };
}

/**
 * A fake `StageExec` that hands back one canned answer per call, in order,
 * and counts how many times it was invoked — the number a "no third stage
 * invocation" assertion reads.
 */
function fakeStage(answers: Array<{ files: Array<{ path: string; content: string }>; summary: string }>): {
  exec: StageExec;
  callCount: () => number;
} {
  let calls = 0;
  const exec: StageExec = async () => {
    const answer = answers[calls] ?? answers.at(-1);
    calls += 1;
    return JSON.stringify(answer);
  };
  return { exec, callCount: () => calls };
}

const IDENTICAL_A: FailureSignature = [{ testName: "adds two numbers", errorMessage: "expected 3, got 4" }];
const IDENTICAL_B: FailureSignature = [{ testName: "adds two numbers", errorMessage: "expected 3, got 4" }];
const DIFFERENT: FailureSignature = [{ testName: "subtracts two numbers", errorMessage: "expected 1, got 0" }];

function answer(n: number) {
  return { files: [{ path: `fix-${n}.ts`, content: `// attempt ${n}` }], summary: `attempt ${n} tried something` };
}

function baseDeps(overrides: Partial<FixerDeps> & { runTestsSequence: FixerTestResult[] }): FixerDeps & {
  ghCalls: string[][];
  gitCalls: string[][];
  writes: Array<{ path: string; content: string }>;
} {
  const { gh, calls: ghCalls } = fakeGh();
  const { git, calls: gitCalls } = fakeGit();
  const writes: Array<{ path: string; content: string }> = [];
  let testCall = 0;
  const { runTestsSequence, ...rest } = overrides;

  return {
    gh,
    exec: async () => "",
    git,
    runTests: () => {
      const result = runTestsSequence[testCall] ?? runTestsSequence.at(-1) ?? { failures: [] };
      testCall += 1;
      return result;
    },
    writeFile: (path, content) => writes.push({ path, content }),
    initialFailure: IDENTICAL_A,
    prNumber: 7,
    branch: "implement/issue-42",
    issueNumber: 42,
    ...rest,
    ghCalls,
    gitCalls,
    writes,
  };
}

describe("signaturesEqual", () => {
  it("is true for the same tests failing with the same messages, regardless of order", () => {
    const a: FailureSignature = [
      { testName: "a", errorMessage: "x" },
      { testName: "b", errorMessage: "y" },
    ];
    const b: FailureSignature = [
      { testName: "b", errorMessage: "y" },
      { testName: "a", errorMessage: "x" },
    ];
    expect(signaturesEqual(a, b)).toBe(true);
  });

  it("is false when a message differs", () => {
    expect(signaturesEqual(IDENTICAL_A, DIFFERENT)).toBe(false);
  });

  it("is false when the set of failing tests differs in size", () => {
    const a: FailureSignature = [{ testName: "a", errorMessage: "x" }];
    const b: FailureSignature = [
      { testName: "a", errorMessage: "x" },
      { testName: "b", errorMessage: "y" },
    ];
    expect(signaturesEqual(a, b)).toBe(false);
  });
});

describe("assembleFixBrief", () => {
  it("names the attempt number, the currently-failing signature, and every prior summary", () => {
    const brief = assembleFixBrief(IDENTICAL_A, 2, ["first attempt tried X"]);
    expect(brief).toContain("Attempt 2 of 3");
    expect(brief).toContain("adds two numbers");
    expect(brief).toContain("expected 3, got 4");
    expect(brief).toContain("first attempt tried X");
  });

  it("renders '(none)' sections for a first attempt with nothing prior", () => {
    const brief = assembleFixBrief([], 1, []);
    expect(brief).toContain("(none)");
    expect(brief).toContain("first attempt");
  });
});

describe("runFixer — no-progress stop", () => {
  it("stops after exactly 2 stage invocations when attempts 1 and 2 report the identical signature, and applies blocked + a comment", async () => {
    const stage = fakeStage([answer(1), answer(2)]);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: IDENTICAL_B }],
    });

    const outcome = await runFixer(deps);

    expect(stage.callCount()).toBe(2);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 2, stopReason: "no-progress" });

    const labelCall = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "edit");
    expect(labelCall).toEqual(["pr", "edit", "7", "--add-label", BLOCKED_LABEL]);

    const commentCall = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "comment");
    expect(commentCall?.[0]).toBe("pr");
    expect(commentCall?.[1]).toBe("comment");
    expect(commentCall?.[2]).toBe("7");
    expect(commentCall?.[4]).toContain("attempt 1 tried something");
    expect(commentCall?.[4]).toContain("attempt 2 tried something");
  });
});

describe("runFixer — capped stop", () => {
  it("stops after exactly 3 stage invocations when every attempt reports a different signature, and applies blocked + a comment", async () => {
    const thirdSignature: FailureSignature = [{ testName: "multiplies two numbers", errorMessage: "expected 6, got 5" }];
    const stage = fakeStage([answer(1), answer(2), answer(3)]);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: DIFFERENT }, { failures: thirdSignature }],
    });

    const outcome = await runFixer(deps);

    expect(stage.callCount()).toBe(MAX_ATTEMPTS);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 3, stopReason: "capped" });

    const labelCall = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "edit");
    expect(labelCall).toEqual(["pr", "edit", "7", "--add-label", BLOCKED_LABEL]);
    const commentCall = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "comment");
    expect(commentCall?.[4]).toContain("attempt 3 tried something");
  });
});

describe("runFixer — goes green", () => {
  it("stops as soon as an attempt leaves nothing failing, applying neither blocked nor a comment", async () => {
    const stage = fakeStage([answer(1)]);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: [] }],
    });

    const outcome = await runFixer(deps);

    expect(stage.callCount()).toBe(1);
    expect(outcome).toEqual({ verdict: "green", attempts: 1 });
    expect(deps.ghCalls).toHaveLength(0);
    expect(deps.writes).toEqual([{ path: "fix-1.ts", content: "// attempt 1" }]);
    expect(deps.gitCalls.some((call) => call[0] === "push")).toBe(true);
  });
});
