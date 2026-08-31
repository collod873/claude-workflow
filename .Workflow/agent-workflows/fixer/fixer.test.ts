import { createRecordingGh } from "../shared/gh.fake";
import { beforeEach, describe, expect, it } from "vitest";
import { isolateCheckpointsPerTest } from "../shared/isolate-checkpoints.setup";
import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { readWorkflow } from "../shared/read-workflow";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { SPEC_GAP_LABEL } from "../shared/spec-gap";
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

/**
 * The ticket the fixer reads on a no-progress stop, to find the PRD a `spec/gap` is routed at
 * (ADR-0119). `parentPrd: undefined` models a hand-written ticket entering at lane 06 (#184), which
 * has no spec to amend and so has no route.
 */
function ticketBody(parentPrd: number | undefined): string {
  const parent = parentPrd === undefined ? "" : `## Parent PRD\n#${parentPrd}\n\n`;
  return `${parent}## Acceptance criteria\n\n- [ ] It adds two numbers — check: \`npm test\`\n`;
}

/**
 * `createRecordingGh` answers nothing, which is the point of it — but the no-progress stop now
 * reads the ticket and creates an issue, and both of those are parsed. This answers exactly those
 * two and records everything, so a test still asserts on `calls` rather than on a simulated GitHub.
 */
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
  writes: Array<{ path: string; content: string }>;
} {
  const { parentPrd, ...withoutPrd } = overrides;
  const { gh, calls: ghCalls } = recordingGhWithTicket("parentPrd" in overrides ? parentPrd : 41);
  const { git, calls: gitCalls } = fakeGit();
  const writes: Array<{ path: string; content: string }> = [];
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

// Every one of these tests drives the lane against fixed fixtures and canned
// responses, so more than one call can render the identical substituted prompt
// for the one stage name this lane now carries (#274) — without a fresh
// CHECKPOINTS_DIR per test, a later test would silently reuse an earlier
// test's checkpointed answer. See `isolateCheckpointsPerTest`'s own comment.
beforeEach(() => {
  isolateCheckpointsPerTest();
});

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

/**
 * ADR-0119. The two stops are two different events, and until now they reached one place. A test
 * that does not move under two independent attempts is not being failed by the diff — it is asking
 * for something the ticket did not decide — and #278's whole complaint is that the pipeline had no
 * way to say so: a red acceptance test means *the implementation is wrong*, whichever side is.
 */
describe("runFixer — where a stop is routed", () => {
  function specGapCall(calls: string[][]): string[] | undefined {
    return calls.find((call) => call[0] === "issue" && call[1] === "create" && call.includes(SPEC_GAP_LABEL));
  }

  /**
   * Two attempts leaving the identical signature — the stop this whole describe is about.
   * `null` is "the ticket names no parent PRD": passing `undefined` here would re-trigger the
   * default rather than override it.
   */
  async function stoppedWithNoProgress(parentPrd: number | null = 41) {
    const stage = fakeStage([answer(1), answer(2)]);
    const deps = baseDeps({
      exec: stage.exec,
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

    // Routed at the PRD the ticket names, not at the ticket — lane 02 amends a spec.
    const body = filed![filed!.indexOf("--body") + 1];
    expect(body).toContain("#41");
    // Carries the immovable signature itself: it is both the evidence and the thing the spec
    // author has to read a decision out of.
    expect(body).toContain("adds two numbers");
    expect(body).toContain("expected 3, got 4");

    // The label is created before it is used, for `escalateToOwner`'s reason.
    const labelCreate = deps.ghCalls.findIndex((call) => call[0] === "label" && call[1] === "create" && call[2] === SPEC_GAP_LABEL);
    expect(labelCreate).toBeGreaterThanOrEqual(0);
    expect(labelCreate).toBeLessThan(deps.ghCalls.indexOf(filed!));
  });

  it("still labels the ticket needs-human, because a spec/gap may refuse", async () => {
    // ADR-0079 lets the spec author refuse a gap only new scope could repair. A ticket whose label
    // was dropped on the strength of that repair would be stalled in nobody's list.
    const { deps } = await stoppedWithNoProgress();

    expectEscalatedToOwner(deps.ghCalls, "42", "collod873");
  });

  it("names the filed gap in the comment, so the PR says where the stop went", async () => {
    const { deps } = await stoppedWithNoProgress();

    const comment = deps.ghCalls.find((call) => call[0] === "pr" && call[1] === "comment");
    expect(comment?.[4]).toContain("#500");
    expect(comment?.[4]).toContain("spec/gap");
  });

  it("files nothing on a capped stop, where every attempt moved the failure", async () => {
    // Three attempts that each changed the failure is evidence the diff is in play and the
    // contract is not. Filing here would make the label mean "the fixer gave up".
    const third: FailureSignature = [{ testName: "multiplies", errorMessage: "expected 6, got 5" }];
    const stage = fakeStage([answer(1), answer(2), answer(3)]);
    const deps = baseDeps({
      exec: stage.exec,
      runTestsSequence: [{ failures: IDENTICAL_A }, { failures: DIFFERENT }, { failures: third }],
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
    expect(comment).toContain("Restore and run acceptance");
    expect(comment).toContain("::error::vitest.config.ts touches the immutable set");
  });
});

interface FixerWorkflow {
  on?: {
    workflow_run?: { workflows?: string[]; types?: string[] };
    repository_dispatch?: { types?: string[] };
    workflow_dispatch?: unknown;
    pull_request?: unknown;
  };
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
 * The second door (#285). `workflow_run` went missing three times over 2026-08-30/31 — the last of
 * them run 33346638810 on PR #284, red at 01:07:58, reaching this lane only when a person
 * dispatched it by hand — so `verify.yml` now rings `fixer-needed` from a job of its own, the same
 * shape lane 05 opened for Recover under ADR-0114. These pin both ends: neither file can rename the
 * event alone, and neither can drop the two things that make a second door safe to add — the wait
 * for the run to finish, and the marker that makes the later arrival a no-op.
 */
describe("the door a red Verify rings itself", () => {
  const { workflow, source } = readWorkflow<FixerWorkflow>("fixer.yml");
  const verify = readWorkflow<{
    jobs: Record<string, { name?: string; if?: string; needs?: string[]; permissions?: Record<string, string>; steps?: Array<{ run?: string }> }>;
  }>("verify.yml");

  const signal = Object.values(verify.workflow.jobs).find((job) => job.steps?.some((step) => step.run?.includes("event_type=fixer-needed")));

  it("answers the fixer-needed dispatch verify.yml sends, keyed on the failed run", () => {
    expect(workflow.on?.repository_dispatch?.types).toEqual(["fixer-needed"]);
    expect(workflow.jobs.fixer.if).toContain("github.event.action == 'fixer-needed'");
    expect(source).toContain("github.event.client_payload.run_id");

    expect(signal, "verify.yml sends no fixer-needed dispatch").toBeDefined();
    const ring = signal?.steps?.find((step) => step.run?.includes("event_type=fixer-needed"));
    expect(ring?.run).toContain("client_payload[run_id]=$GITHUB_RUN_ID");
  });

  it("is rung only for the dispatch Verify judges a pull request on, never for a red push to trunk", () => {
    // The sending side of this lane's own `event != 'push'`: a red `push: main` run is trunk being
    // broken, with no pull request to fix. Both doors have to agree on that or the new one reopens
    // a hole the old one closes.
    expect(signal?.if).toContain("github.event.action == 'implementation-opened'");
  });

  it("is rung on a red run and not on a cancelled one, which the workflow_run door also ignores", () => {
    // `always()` is what gets the signal job past three `needs:` a red run left in mixed states,
    // and once it is in, `cancelled` has to be excluded by name. A cancelled run's conclusion is
    // not `failure`, so `workflow_run` would not open for it either.
    expect(signal?.if).toContain("always()");
    expect(signal?.needs).toEqual(["immutability", "restore-and-run-acceptance", "verify"]);
    for (const job of signal?.needs ?? []) {
      expect(signal?.if, `the signal job ignores a red ${job}`).toContain(`needs.${job}.result == 'failure'`);
    }
    expect(signal?.if).not.toContain("cancelled");
  });

  it("sends from a job holding contents: write, which verify.yml's judging jobs deliberately do not", () => {
    // A job-level block replaces the workflow default rather than narrowing it, so the three jobs
    // that judge a pull request keep the `contents: read` at the top of the file and only this one
    // can write.
    expect(signal?.permissions?.contents).toBe("write");
    expect(verify.workflow.jobs.verify.permissions).toBeUndefined();
  });

  it("waits for the run to finish before reading its log, because this door is rung from inside it", () => {
    // `verify.yml`'s signal job is the last job of the run this lane resolves from, so the run is
    // still `in_progress` when the dispatch lands — and `gh run view --log` refuses an in-progress
    // run. Without the wait the grep below resolves nothing and this lane exits 0, which is the
    // silence #285 exists to end.
    const resolve = (workflow.jobs.fixer.steps ?? []).find((step) => step.run?.includes("--json jobs"));
    expect(resolve?.run).toContain('gh run view "$RUN_ID" --json status');
    expect(resolve?.run).toContain('[ "$STATUS" = "completed" ]');
    // And refuses out loud rather than exiting 0: a run it cannot read is a red Verify it could not
    // reach, not "nothing to work on".
    expect(resolve?.run).toMatch(/is still \\"\$STATUS\\" after five minutes[\s\S]*?\n\s*exit 1/);
  });

  it("reacts once per Verify run, whichever door named it", () => {
    // Both doors ring for one failure whenever `workflow_run` does arrive, and the concurrency
    // group makes the late one queue behind the dispatch rather than race it — so without the
    // marker every red Verify buys a second attempt loop at the same ticket.
    expect(workflow.concurrency?.group).toContain("github.event.client_payload.run_id");

    const resolve = (workflow.jobs.fixer.steps ?? []).find((step) => step.run?.includes("--json jobs"));
    expect(resolve?.run).toContain('MARKER="<!-- fixer-run:$RUN_ID -->"');
    expect(resolve?.run).toContain('gh pr view "$PR" --json comments');
    expect(resolve?.run).toContain('gh pr comment "$PR" --body');
  });

  it("writes the marker before it spends anything, so a fixer that dies is not retried into", () => {
    const resolve = (workflow.jobs.fixer.steps ?? []).find((step) => step.run?.includes("--json jobs"));
    const steps = workflow.jobs.fixer.steps ?? [];
    // The marker is written in the resolve step, which is the first step of the job — everything
    // that costs money (the checkout, the rebase, the stage) comes after it.
    expect(steps.indexOf(resolve as (typeof steps)[number])).toBe(0);
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
