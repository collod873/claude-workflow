import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { readWorkflow } from "../shared/read-workflow";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import type { StageExec } from "../shared/stage";
import {
  applyUnfixable,
  assembleFixBrief,
  MAX_ATTEMPTS,
  runFixer,
  signaturesEqual,
  unfixableComment,
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

/**
 * The one assertion both stop paths share: `needs-human` is created before it is applied, applied
 * to the *ticket*, the owner is assigned, and nothing labels or edits the pull request itself — the
 * escalation moved there. Shared so `runFixer`'s two stop describes and `applyUnfixable`'s own test
 * assert the identical shape rather than three copies of it drifting apart.
 */
function expectEscalatedToOwner(calls: string[][], issueNumber: string, assignee: string): void {
  const labelCall = calls.find((call) => call[0] === "issue" && call[1] === "edit" && call.includes("--add-label"));
  expect(labelCall).toEqual(["issue", "edit", issueNumber, "--add-label", NEEDS_HUMAN_LABEL]);

  const assignCall = calls.find((call) => call[0] === "issue" && call[1] === "edit" && call.includes("--add-assignee"));
  expect(assignCall).toEqual(["issue", "edit", issueNumber, "--add-assignee", assignee]);

  // The label is created (idempotently, `--force`) before it is ever applied — `gh issue edit
  // --add-label` fails outright on a label nobody has created yet.
  const labelCreateIndex = calls.findIndex((call) => call[0] === "label" && call[1] === "create");
  const labelApplyIndex = calls.indexOf(labelCall!);
  expect(labelCreateIndex).toBeGreaterThanOrEqual(0);
  expect(labelCreateIndex).toBeLessThan(labelApplyIndex);

  // Nothing labels or edits the pull request itself — the escalation moved to the ticket.
  expect(calls.some((call) => call[0] === "pr" && call[1] === "edit")).toBe(false);
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
    assignee: "collod873",
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
  it("stops after exactly 2 stage invocations when attempts 1 and 2 report the identical signature, and applies needs-human + a comment", async () => {
    const stage = fakeStage([answer(1), answer(2)]);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: IDENTICAL_B }],
    });

    const outcome = await runFixer(deps);

    expect(stage.callCount()).toBe(2);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 2, stopReason: "no-progress" });

    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");

    const commentCall = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "comment");
    expect(commentCall?.[0]).toBe("pr");
    expect(commentCall?.[1]).toBe("comment");
    expect(commentCall?.[2]).toBe("7");
    expect(commentCall?.[4]).toContain("attempt 1 tried something");
    expect(commentCall?.[4]).toContain("attempt 2 tried something");
  });
});

describe("runFixer — capped stop", () => {
  it("stops after exactly 3 stage invocations when every attempt reports a different signature, and applies needs-human + a comment", async () => {
    const thirdSignature: FailureSignature = [{ testName: "multiplies two numbers", errorMessage: "expected 6, got 5" }];
    const stage = fakeStage([answer(1), answer(2), answer(3)]);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: DIFFERENT }, { failures: thirdSignature }],
    });

    const outcome = await runFixer(deps);

    expect(stage.callCount()).toBe(MAX_ATTEMPTS);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 3, stopReason: "capped" });

    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");

    const commentCall = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "comment");
    expect(commentCall?.[4]).toContain("attempt 3 tried something");
  });
});

describe("runFixer — goes green", () => {
  it("stops as soon as an attempt leaves nothing failing, applying neither needs-human nor a comment, and sends the PR back to Verify", async () => {
    const stage = fakeStage([answer(1)]);
    // A `gh` that answers the two reads `rejudge` makes — the PR's url and whole diff, and the
    // ticket's body — and records everything, so the dispatch can be checked field by field.
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

    expect(stage.callCount()).toBe(1);
    expect(outcome).toEqual({ verdict: "green", attempts: 1 });
    expect(deps.writes).toEqual([{ path: "fix-1.ts", content: "// attempt 1" }]);
    expect(deps.gitCalls.some((call) => call[0] === "push")).toBe(true);

    // No escalation of any kind on a green.
    expect(ghCalls.filter((call) => call[0] === "issue" && call[1] === "edit")).toEqual([]);
    expect(ghCalls.filter((call) => call[0] === "pr" && call[1] === "comment")).toEqual([]);

    // The same dispatch lane 05 sends when it opens a PR: the whole diff, the ticket's criteria.
    const dispatch = ghCalls.find((call) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches");
    expect(dispatch).toContain("event_type=implementation-opened");
    expect(dispatch).toContain("client_payload[pr]=https://example/pull/7");
    expect(dispatch).toContain("client_payload[changed_files]=a.ts,fix-1.ts");
    expect(dispatch).toContain("client_payload[criteria][]=it works — check: `true`");
  });
});

/**
 * The escalate path: `fixer.yml`'s resolve step reaches `applyUnfixable` (via `fixer.ts escalate`)
 * when Verify's red job was not `Restore and run acceptance` — no test signature exists for a
 * model to work from, so this is the whole write, with no attempt loop above it.
 */
describe("applyUnfixable — the escalate path's one write", () => {
  it("creates needs-human before applying it, applies it to the ticket, assigns the owner, and comments the PR naming what failed", () => {
    const { gh, calls } = fakeGh();

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
    expect(comment).toContain("Restore and run acceptance");
    expect(comment).toContain("::error::vitest.config.ts touches the immutable set");
  });
});

interface FixerWorkflow {
  on?: { workflow_run?: { workflows?: string[]; types?: string[] }; workflow_dispatch?: unknown; pull_request?: unknown };
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: { fixer: { if?: string; steps?: Array<{ name?: string; run?: string; with?: { ref?: string } }> } };
}

/**
 * The lane this file's code had never been part of (#169, #234) — `fixer.yml`'s own header comment
 * is the home for why it exists. These assert the listener, not the loop: the trigger, the
 * conclusion it reacts to, and the one coupling that decides whether any of it resolves a PR.
 */
describe("fixer.yml is the listener a red Verify never had", () => {
  const { workflow, source } = readWorkflow<FixerWorkflow>("fixer.yml");

  it("fires on a completed workflow_run of Verify, the same trigger review.yml carries", () => {
    expect(workflow.on?.workflow_run?.workflows).toEqual(["Verify"]);
    expect(workflow.on?.workflow_run?.types).toEqual(["completed"]);
    expect(workflow.on?.pull_request, "a pull_request trigger runs the PR's own copy of this file").toBeUndefined();
  });

  it("reacts to the conclusion review.yml turns away, and only that one", () => {
    expect(workflow.jobs.fixer.if).toContain("github.event.workflow_run.conclusion == 'failure'");
  });

  it("leaves a red push run on trunk alone, which has no pull request to fix", () => {
    expect(workflow.jobs.fixer.if).toContain("github.event.workflow_run.event != 'push'");
  });

  it("grants the writes fixer.ts performs: a push to the branch, a PR comment, and needs-human plus an assignee on the ticket", () => {
    // Every attempt is committed onto the pull request's own branch (`commitAndPushAttempt`), a
    // stopped fixer always comments the PR (`applyBlocked`, `applyUnfixable`), and both stop paths
    // apply `needs-human` plus an assignee to the *ticket* (`escalateToOwner`). A `permissions:`
    // block replaces the default token rather than adding to it, so an omitted scope is `none`.
    expect(workflow.permissions?.contents).toBe("write");
    expect(workflow.permissions?.["pull-requests"]).toBe("write");
    expect(workflow.permissions?.issues).toBe("write");
    // The resolve step reads the failed run's jobs and one job's log.
    expect(workflow.permissions?.actions).toBe("read");
  });

  it("never cancels a run in flight, because an attempt it already pushed is not undone", () => {
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("checks out the pull request's own branch, which is where every attempt is pushed", () => {
    const checkout = (workflow.jobs.fixer.steps ?? []).find((step) => step.with?.ref !== undefined);
    expect(checkout?.with?.ref).toContain("steps.target.outputs.branch");
  });

  it("runs fixer.ts, which is the whole of what wiring this lane means", () => {
    expect(source).toContain(".Workflow/agent-workflows/fixer/fixer.ts");
  });

  it("points the fixer at the gauntlet's own test target, never at tests/acceptance/", () => {
    // An acceptance test is expected red until the ticket it names is built (vitest.config.ts), so
    // a fixer aimed there would chase other tickets' unbuilt criteria and block every pull request.
    const step = (workflow.jobs.fixer.steps ?? []).find((each) => each.run?.includes("npx tsx"));
    expect(step?.run).toContain(".Workflow");
    expect(step?.run).not.toContain("tests/acceptance");
  });
});

/**
 * The one coupling that decides whether this lane resolves anything: `fixer.yml`'s resolve step
 * reads the pull request out of the line `verify.yml`'s checkout step echoes, and that step's own
 * comment is the home for why. These tests are what keep the two spellings from drifting.
 *
 * The same split, for the same reason, as `integrate.ts`'s lane 06 job names — the Actions API
 * answers strings, and `shared/` may not import a workflow file.
 */
describe("fixer.yml reads the pull request out of the line verify.yml actually echoes", () => {
  const fixer = readWorkflow<FixerWorkflow>("fixer.yml");
  const verify = readWorkflow("verify.yml");

  /** The pattern `fixer.yml`'s resolve step greps the job log with, read off the workflow itself. */
  const grepped = /grep -oE '([^']+)'/.exec(fixer.source)?.[1];

  it("greps for a pattern, rather than having quietly stopped doing so", () => {
    expect(grepped).toBeDefined();
  });

  it("matches what verify.yml would print for a real pull request on a claim branch", () => {
    const printed = "judging https://github.com/collod873/claude-workflow/pull/250 on implement/issue-241";

    expect(verify.source, "verify.yml no longer echoes the line this lane resolves from").toContain(
      'echo "judging $PR on $BRANCH"',
    );
    expect(new RegExp(grepped ?? "$^").test(printed)).toBe(true);
  });

  it("does not match the echoed command line itself, which carries the literal $PR", () => {
    expect(new RegExp(grepped ?? "$^").test('echo "judging $PR on $BRANCH"')).toBe(false);
  });

  it("does not match a branch that is not an implementation claim", () => {
    const printed = "judging https://github.com/collod873/claude-workflow/pull/250 on somebodys-branch";

    expect(new RegExp(grepped ?? "$^").test(printed)).toBe(false);
  });

  /**
   * The Immutability job's own copy of the line (#272/#277: a red `Immutability` job leaves
   * `Restore and run acceptance` skipped, so its `judging` line is never written — this one is
   * what the escalate path resolves from instead). Same shape, same echo string, so the grep above
   * resolves either job without a second pattern.
   */
  it("Immutability also echoes the line — the job that always runs, so its log is where the escalate path resolves from", () => {
    const immutability = readWorkflow<{ jobs: { immutability: { steps: Array<{ run?: string }> } } }>("verify.yml");
    const echoed = (immutability.workflow.jobs.immutability.steps ?? []).some((step) =>
      step.run?.includes('echo "judging $PR on $BRANCH"'),
    );
    expect(echoed, "Immutability carries no judging line of its own").toBe(true);

    const printed = "judging https://github.com/collod873/claude-workflow/pull/277 on implement/issue-272";
    expect(new RegExp(grepped ?? "$^").test(printed)).toBe(true);
  });
});

/**
 * The ceiling is per ticket, not per run: a green attempt is sent back to Verify, and a red Verify
 * starts a fresh fixer run, so without this the loop is fix → judge → fix with a model spend each
 * round and no end. The count is read off the branch's own `fix: attempt` commits.
 */
describe("the cap across fixer runs", () => {
  it("spends no stage when three attempts already sit on the branch, and escalates instead", async () => {
    const stage = fakeStage([answer(1)]);
    const deps = baseDeps({
      exec: stage.exec,
      git: (args) => (args[0] === "log" ? "fix: attempt 1 at #42\nfix: attempt 2 at #42\nfix: attempt 3 at #42\nImplement #42\n" : ""),
      runTestsSequence: [{ failures: [] }],
    });

    const outcome = await runFixer(deps);

    expect(stage.callCount()).toBe(0);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 0, stopReason: "capped" });
    expect(deps.ghCalls).toContainEqual(["issue", "edit", "42", "--add-label", NEEDS_HUMAN_LABEL]);
    expect(deps.writes).toEqual([]);
  });

  it("takes only the remainder when earlier runs used part of the ceiling", async () => {
    const stage = fakeStage([answer(1), answer(2), answer(3)]);
    const deps = baseDeps({
      exec: stage.exec,
      git: (args) => (args[0] === "log" ? "fix: attempt 1 at #42\nImplement #42\n" : ""),
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: DIFFERENT }],
    });

    const outcome = await runFixer(deps);

    expect(stage.callCount()).toBe(2);
    expect(outcome).toEqual({ verdict: "blocked", attempts: 2, stopReason: "capped" });
  });
});
