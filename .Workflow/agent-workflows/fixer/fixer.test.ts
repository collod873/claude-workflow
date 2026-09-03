import { describe, expect, it, vi } from "vitest";
import type { GhExec } from "../shared/gh";
import { createRecordingGh } from "../shared/gh.fake";
import type { GitExec } from "../shared/git";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { SPEC_GAP_LABEL } from "../shared/spec-gap";
import { createFakeStages } from "../shared/stage.fake";
import { runVitestReport } from "../shared/vitest-json";
import {
  applyUnfixable,
  assembleFixBrief,
  blockedComment,
  changedPaths,
  MAX_ATTEMPTS,
  priorAttempts,
  runFixer,
  runVitestJsonForFixer,
  signaturesEqual,
  unfixableComment,
  type FailureSignature,
  type FixerDeps,
  type FixerTestResult,
} from "./fixer";

vi.mock("../shared/vitest-json", () => ({ runVitestReport: vi.fn() }));

function fakeGit(porcelain = " M fix.ts"): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push([...args]);
    return args[0] === "status" ? porcelain : "";
  };
  return { git, calls };
}

function attempts(n: number) {
  return createFakeStages(Array.from({ length: n }, (_, index) => JSON.stringify({ summary: `attempt ${index + 1} tried something` })));
}

const IDENTICAL_A: FailureSignature = [{ testName: "adds two numbers", errorMessage: "expected 3, got 4" }];
const IDENTICAL_B: FailureSignature = [{ testName: "adds two numbers", errorMessage: "expected 3, got 4" }];
const DIFFERENT: FailureSignature = [{ testName: "subtracts two numbers", errorMessage: "expected 1, got 0" }];
const THIRD: FailureSignature = [{ testName: "multiplies two numbers", errorMessage: "expected 6, got 5" }];

function expectEscalatedToOwner(calls: string[][], issueNumber: string, assignee: string): void {
  const labelCall = calls.find((call) => call[0] === "issue" && call[1] === "edit" && call.includes("--add-label"));
  expect(labelCall).toEqual(["issue", "edit", issueNumber, "--add-label", NEEDS_HUMAN_LABEL]);

  const assignCall = calls.find((call) => call[0] === "issue" && call[1] === "edit" && call.includes("--add-assignee"));
  expect(assignCall).toEqual(["issue", "edit", issueNumber, "--add-assignee", assignee]);

  const labelCreateIndex = calls.findIndex((call) => call[0] === "label" && call[1] === "create");
  const labelApplyIndex = calls.indexOf(labelCall!);
  expect(labelCreateIndex).toBeGreaterThanOrEqual(0);
  expect(labelCreateIndex).toBeLessThan(labelApplyIndex);

  expect(calls.some((call) => call[0] === "pr" && call[1] === "edit")).toBe(false);
}

const prCommentIn = (calls: string[][]): string | undefined => calls.find((call) => call[0] === "pr" && call[1] === "comment")?.[4];

function ticketBody(parentPrd: number | undefined): string {
  const parent = parentPrd === undefined ? "" : `## Parent PRD\n#${parentPrd}\n\n`;
  return `${parent}## Acceptance criteria\n\n- [ ] It adds two numbers — check: \`make test\`\n`;
}

function recordingGhWithTicket(parentPrd: number | undefined): { gh: GhExec; calls: string[][] } {
  const { gh: recording, calls } = createRecordingGh();
  const gh: GhExec = (args) => {
    recording(args);
    if (args[0] === "issue" && args[1] === "view") {
      return JSON.stringify({ title: "Adds two numbers", body: ticketBody(parentPrd) });
    }
    if (args[0] === "issue" && args[1] === "create") {
      return "https://github.com/owner/repo/issues/500\n";
    }
    return "";
  };
  return { gh, calls };
}

function baseDeps(
  overrides: Partial<FixerDeps> & { runTestsSequence: FixerTestResult[]; parentPrd?: number },
): FixerDeps & {
  ghCalls: string[][];
  gitCalls: string[][];
} {
  const { parentPrd, ...withoutPrd } = overrides;
  const { gh, calls: ghCalls } = recordingGhWithTicket("parentPrd" in overrides ? parentPrd : 41);
  const { git, calls: gitCalls } = fakeGit();
  let testCall = 0;
  const { runTestsSequence, ...rest } = withoutPrd;

  return {
    gh,
    exec: async () => "",
    git,
    runTests: () => {
      const result = runTestsSequence[testCall] ?? runTestsSequence.at(-1) ?? { failures: [] };
      testCall += 1;
      return result;
    },
    initialFailure: IDENTICAL_A,
    prNumber: 7,
    branch: "implement/issue-42",
    issueNumber: 42,
    assignee: "collod873",
    ...rest,
    ghCalls,
    gitCalls,
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

describe("blockedComment", () => {
  it("says why the loop stopped, numbers what every attempt tried, and names the spec/gap when one was filed", () => {
    const noProgress = blockedComment("no-progress", ["tried X", "tried Y"], 500);
    expect(noProgress).toContain("identical tests failing");
    expect(noProgress).toContain("1. tried X\n2. tried Y");
    expect(noProgress).toContain("`spec/gap` #500");

    const capped = blockedComment("capped", ["tried X"]);
    expect(capped).toContain(`${MAX_ATTEMPTS} attempts`);
    expect(capped).not.toContain("spec/gap");
  });
});

describe("changedPaths", () => {
  function gitReporting(porcelain: string) {
    return ((args) => (args[0] === "status" ? porcelain : "")) as GitExec;
  }

  it("asks git for the stable, config-independent format, listing new files one by one", () => {
    const calls: string[][] = [];
    changedPaths((args) => {
      calls.push([...args]);
      return "";
    });
    expect(calls).toEqual([["status", "--porcelain", "-uall"]]);
  });

  it("reads back a modified, an added and a deleted path", () => {
    expect(changedPaths(gitReporting(" M a.ts\n?? b.ts\n D c.ts"))).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("is empty for a clean tree — a stage that answered without changing anything", () => {
    expect(changedPaths(gitReporting(""))).toEqual([]);
    expect(changedPaths(gitReporting("\n"))).toEqual([]);
  });

  it("takes the destination of a rename, not the source", () => {
    expect(changedPaths(gitReporting("R  old.ts -> new.ts"))).toEqual(["new.ts"]);
  });

  it("keeps a path that contains spaces intact", () => {
    expect(changedPaths(gitReporting(" M docs/some notes.md"))).toEqual(["docs/some notes.md"]);
  });

  it("strips the quotes git puts around a non-ASCII path", () => {
    expect(changedPaths(gitReporting(' M "docs/caf\\303\\251.md"'))).toEqual(["docs/caf\\303\\251.md"]);
  });
});

describe("priorAttempts", () => {
  it("counts the `fix: attempt N` subjects on the branch ahead of trunk, and nothing else", () => {
    const calls: string[][] = [];
    const git: GitExec = (args) => {
      calls.push([...args]);
      return "fix: attempt 2 at #42\nfix up the docstring\nfix: attempt 1 at #42\nImplement #42\n";
    };

    expect(priorAttempts(git)).toBe(2);
    expect(calls).toEqual([["log", "origin/main..HEAD", "--format=%s"]]);
  });
});

describe("runFixer — no-progress stop", () => {
  it("stops after exactly 2 stage invocations when attempts 1 and 2 report the identical signature, and applies needs-human + a comment", async () => {
    const stage = attempts(2);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: IDENTICAL_B }],
    });

    const outcome = await runFixer(deps);

    expect(stage.calls).toHaveLength(2);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 2, stopReason: "no-progress" });

    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");

    const commentCall = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "comment");
    expect(commentCall?.slice(0, 3)).toEqual(["pr", "comment", "7"]);
    expect(commentCall?.[4]).toContain("attempt 1 tried something");
    expect(commentCall?.[4]).toContain("attempt 2 tried something");
  });

  it("commits nothing for an attempt that left the tree unchanged, but still records its summary", async () => {
    const { git, calls: gitCalls } = fakeGit("");
    const deps = baseDeps({
      exec: attempts(2).exec,
      git,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: IDENTICAL_B }],
    });

    const outcome = await runFixer(deps);

    expect(outcome).toEqual({ verdict: "blocked", attempts: 2, stopReason: "no-progress" });
    expect(gitCalls.some((call) => call[0] === "commit" || call[0] === "push")).toBe(false);
    expect(prCommentIn(deps.ghCalls)).toContain("attempt 1 tried something");
  });
});

describe("runFixer — where a stop is routed", () => {
  function specGapCall(calls: string[][]): string[] | undefined {
    return calls.find((call) => call[0] === "issue" && call[1] === "create" && call.includes(SPEC_GAP_LABEL));
  }

  async function stoppedWithNoProgress(parentPrd: number | null = 41) {
    const deps = baseDeps({
      exec: attempts(2).exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: IDENTICAL_B }],
      parentPrd: parentPrd ?? undefined,
    });
    const outcome = await runFixer(deps);
    return { deps, outcome };
  }

  it("files a spec/gap at the parent PRD when the signature never moved", async () => {
    const { deps } = await stoppedWithNoProgress();

    const filed = specGapCall(deps.ghCalls);
    expect(filed).toBeDefined();

    const body = filed![filed!.indexOf("--body") + 1];
    expect(body).toContain("#41");
    expect(body).toContain("adds two numbers");
    expect(body).toContain("expected 3, got 4");

    const labelCreate = deps.ghCalls.findIndex((call) => call[0] === "label" && call[1] === "create" && call[2] === SPEC_GAP_LABEL);
    expect(labelCreate).toBeGreaterThanOrEqual(0);
    expect(labelCreate).toBeLessThan(deps.ghCalls.indexOf(filed!));
  });

  it("still labels the ticket needs-human, because a spec/gap may refuse", async () => {
    const { deps } = await stoppedWithNoProgress();

    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");
  });

  it("names the filed gap in the comment, so the PR says where the stop went", async () => {
    const { deps } = await stoppedWithNoProgress();

    expect(prCommentIn(deps.ghCalls)).toContain("#500");
    expect(prCommentIn(deps.ghCalls)).toContain("spec/gap");
  });

  it("files nothing on a capped stop, where every attempt moved the failure", async () => {
    const deps = baseDeps({
      exec: attempts(3).exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: DIFFERENT }, { failures: THIRD }],
    });

    const outcome = await runFixer(deps);

    expect(outcome).toEqual({ verdict: "blocked", attempts: 3, stopReason: "capped" });
    expect(specGapCall(deps.ghCalls)).toBeUndefined();
    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");
  });

  it("files nothing for a ticket with no parent PRD, which has no spec to amend", async () => {
    const { deps } = await stoppedWithNoProgress(null);

    expect(specGapCall(deps.ghCalls)).toBeUndefined();
    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");
  });
});

describe("runFixer — capped stop", () => {
  it("stops after exactly 3 stage invocations when every attempt reports a different signature, and applies needs-human + a comment", async () => {
    const stage = attempts(3);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: DIFFERENT }, { failures: THIRD }],
    });

    const outcome = await runFixer(deps);

    expect(stage.calls).toHaveLength(MAX_ATTEMPTS);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 3, stopReason: "capped" });

    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");
    expect(prCommentIn(deps.ghCalls)).toContain("attempt 3 tried something");
  });
});

describe("runFixer — gate-growth stop", () => {
  it("commits nothing and stops when an attempt creates a gate file, naming it on the PR", async () => {
    const { git, calls: gitCalls } = fakeGit("?? .claude/hooks/pre-commit.sh\n M fix.ts");
    const deps = baseDeps({ exec: attempts(1).exec, git, runTestsSequence: [{ failures: [] }] });

    const outcome = await runFixer(deps);

    expect(outcome).toEqual({ verdict: "blocked", attempts: 1, stopReason: "gate-growth" });
    expect(gitCalls.some((call) => call[0] === "add" || call[0] === "commit" || call[0] === "push")).toBe(false);
    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");
    expect(prCommentIn(deps.ghCalls)).toContain(".claude/hooks/pre-commit.sh");
    expect(prCommentIn(deps.ghCalls)).not.toContain("fix.ts");
    expect(prCommentIn(deps.ghCalls)).toContain("attempt 1 tried something");
  });

  it("lets an attempt that only edits an existing gate file through — the size fence judges that", async () => {
    const { git, calls: gitCalls } = fakeGit(" M vitest.config.ts");
    const tracking: GitExec = (args) => (args[0] === "ls-files" ? "vitest.config.ts\n" : git(args));
    const deps = baseDeps({ exec: attempts(1).exec, git: tracking, runTestsSequence: [{ failures: [] }] });
    const { gh: recording } = deps; 
    deps.gh = (args) => (args[0] === "pr" && args[1] === "view" ? JSON.stringify({ url: "https://example/pull/7", files: [] }) : recording(args));

    expect(await runFixer(deps)).toEqual({ verdict: "green", attempts: 1 });
    expect(gitCalls).toContainEqual(["add", "vitest.config.ts"]);
  });
});

describe("runFixer — goes green", () => {
  it("stops as soon as an attempt leaves nothing failing, applying neither needs-human nor a comment, and sends the PR back to Verify", async () => {
    const stage = attempts(1);
    const ghCalls: string[][] = [];
    const gh: GhExec = (args) => {
      ghCalls.push([...args]);
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({ url: "https://example/pull/7", files: [{ path: "a.ts" }, { path: "fix-1.ts" }] });
      }
      if (args[0] === "issue" && args[1] === "view") {
        return JSON.stringify({ title: "t", body: "## Acceptance criteria\n- [ ] it works — check: `true`\n" });
      }
      return "";
    };
    const deps = baseDeps({
      gh,
      exec: stage.exec,
      runTestsSequence: [{ failures: [] }],
    });

    const outcome = await runFixer(deps);

    expect(stage.calls).toHaveLength(1);
    expect(outcome).toEqual({ verdict: "green", attempts: 1 });
    expect(deps.gitCalls).toContainEqual(["add", "fix.ts"]);
    expect(deps.gitCalls.some((call) => call[0] === "push")).toBe(true);

    expect(ghCalls.filter((call) => call[0] === "issue" && call[1] === "edit")).toEqual([]);
    expect(ghCalls.filter((call) => call[0] === "pr" && call[1] === "comment")).toEqual([]);

    const dispatch = ghCalls.find((call) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches");
    expect(dispatch).toContain("event_type=implementation-opened");
    expect(dispatch).toContain("client_payload[pr]=https://example/pull/7");
    expect(dispatch).toContain("client_payload[changed_files]=a.ts,fix-1.ts");
    expect(dispatch).toContain("client_payload[criteria][]=it works — check: `true`");
  });
});

describe("applyUnfixable — the escalate path's one write", () => {
  it("creates needs-human before applying it, applies it to the ticket, assigns the owner, and comments the PR naming what failed", () => {
    const { gh, calls } = createRecordingGh();

    applyUnfixable(gh, 42, 7, "collod873", "Immutability", "::error::vitest.config.ts touches the immutable set");

    expectEscalatedToOwner(calls, "42", "collod873");

    const labelCreateCall = calls.find((call) => call[0] === "label" && call[1] === "create");
    expect(labelCreateCall).toEqual(["label", "create", NEEDS_HUMAN_LABEL, "--color", "d93f0b", "--description", "Ticket stalled; a human decision or action is required", "--force"]);

    const commentCall = calls.find((call) => call[0] === "pr" && call[1] === "comment");
    expect(commentCall).toEqual(["pr", "comment", "7", "--body", unfixableComment("Immutability", "::error::vitest.config.ts touches the immutable set")]);
  });
});

describe("unfixableComment", () => {
  it("names the failed job and carries its error line", () => {
    const comment = unfixableComment("Immutability", "::error::vitest.config.ts touches the immutable set");
    expect(comment).toContain("Immutability");
    expect(comment).toContain("without a test failing");
    expect(comment).toContain("::error::vitest.config.ts touches the immutable set");
  });
});

describe("runVitestJsonForFixer", () => {
  it("reports each failed assertion by full name and message, and an uncollected file as one failure", () => {
    vi.mocked(runVitestReport).mockReturnValue({
      report: {
        testResults: [
          {
            name: "a.test.ts",
            status: "failed",
            assertionResults: [
              { fullName: "adds two numbers", status: "failed", failureMessages: ["AssertionError: expected 3, got 4"] },
              { fullName: "passes", status: "passed" },
            ],
          },
          { name: "b.test.ts", status: "failed", message: "SyntaxError: unexpected token", assertionResults: [] },
        ],
      },
    });

    expect(runVitestJsonForFixer([".Workflow"], "/somewhere")).toEqual({
      failures: [
        { testName: "adds two numbers", errorMessage: "AssertionError: expected 3, got 4" },
        { testName: "b.test.ts", errorMessage: "SyntaxError: unexpected token" },
      ],
    });
    expect(runVitestReport).toHaveBeenCalledWith([".Workflow"], "/somewhere");
  });

  it("reads a run that produced no report as one failure naming the targets, never as green", () => {
    vi.mocked(runVitestReport).mockReturnValue({ error: "spawn npx ENOENT" });

    expect(runVitestJsonForFixer([".Workflow", "x-"])).toEqual({
      failures: [{ testName: ".Workflow x-", errorMessage: "spawn npx ENOENT" }],
    });
  });
});

describe("the cap across fixer runs", () => {
  it("spends no stage when three attempts already sit on the branch, and escalates instead", async () => {
    const stage = attempts(1);
    const deps = baseDeps({
      exec: stage.exec,
      git: (args) => (args[0] === "log" ? "fix: attempt 1 at #42\nfix: attempt 2 at #42\nfix: attempt 3 at #42\nImplement #42\n" : ""),
      runTestsSequence: [{ failures: [] }],
    });

    const outcome = await runFixer(deps);

    expect(stage.calls).toHaveLength(0);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 0, stopReason: "capped" });
    expect(deps.ghCalls).toContainEqual(["issue", "edit", "42", "--add-label", NEEDS_HUMAN_LABEL]);
    expect(deps.gitCalls.some((call) => call[0] === "commit" || call[0] === "push")).toBe(false);
  });

  it("takes only the remainder when earlier runs used part of the ceiling", async () => {
    const stage = attempts(3);
    const deps = baseDeps({
      exec: stage.exec,
      git: (args) => (args[0] === "log" ? "fix: attempt 1 at #42\nImplement #42\n" : ""),
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: DIFFERENT }],
    });

    const outcome = await runFixer(deps);

    expect(stage.calls).toHaveLength(2);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 2, stopReason: "capped" });
  });
});
