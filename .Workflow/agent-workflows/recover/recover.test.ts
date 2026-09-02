import { describe, expect, it } from "vitest";
import { IMPLEMENT_DISPATCH_EVENT_TYPE } from "../implement/implement";
import { expectMachineAndTargetCheckouts } from "../shared/checkout-pair.fixture";
import { readWorkflow } from "../shared/read-workflow";
import { implementationBranch } from "../shared/ready-set";
import type { GhExec } from "../shared/gh";
import { simulateClaimRef } from "../shared/gh.fake";
import { GIT_REFS_PATH } from "../shared/gh-paths";
import type { GitExec } from "../shared/git";
import {
  attemptCommentBody,
  MAX_RECOVER_ATTEMPTS,
  priorAttemptRunIds,
  redispatchImplement,
  resolveRecoveryTarget,
  resolveTicketFromArtifacts,
  resolveTicketFromLog,
  runRecover,
  type RecoverDeps,
} from "./recover";

const TICKET = { title: "Do the thing", body: "## Acceptance criteria\n- [ ] it works\n" };

/**
 * A fake `gh` small enough to read, stateful enough to answer a claim honestly — the same shape
 * `implement.test.ts`'s own `fakeGh` uses, for the same reason: a claim test is only about
 * anything if `POST git/refs` genuinely 422s on a ref that already exists.
 */
function fakeGh(options: {
  artifacts?: string[];
  logLine?: string;
  comments?: string[];
  existingClaimBranch?: string;
  prCreateUrl?: string;
} = {}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const refs = new Set<string>();
  if (options.existingClaimBranch) refs.add(options.existingClaimBranch);

  const gh: GhExec = (args) => {
    calls.push([...args]);

    if (args[0] === "api" && args[1]?.includes("/artifacts")) {
      return JSON.stringify({ artifacts: (options.artifacts ?? []).map((name) => ({ name })) });
    }
    if (args[0] === "run" && args[1] === "view") {
      return options.logLine ?? "";
    }
    if (args[0] === "run" && args[1] === "download") {
      return "";
    }
    if (args[0] === "issue" && args[1] === "view" && args[4] === "comments") {
      return JSON.stringify({ comments: (options.comments ?? []).map((body) => ({ body })) });
    }
    if (args[0] === "issue" && args[1] === "view" && args[4] === "title,body") {
      return JSON.stringify(TICKET);
    }
    if (args[0] === "issue") return "";
    if (args[0] === "label") return "";
    const claimResult = simulateClaimRef(args, refs);
    if (claimResult !== undefined) return claimResult;
    if (args[0] === "pr" && args[1] === "list") return "[]";
    if (args[0] === "api" && args[1]?.includes("/compare/")) return JSON.stringify({ ahead_by: 0 });
    if (args[0] === "api" && args[1]?.includes("/activity?")) return JSON.stringify([]);
    if (args[0] === "pr" && args[1] === "create") return `${options.prCreateUrl ?? "https://github.com/o/r/pull/1"}\n`;
    if (args[0] === "api") return "";
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };
  return { gh, calls };
}

function fakeGit(): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push([...args]);
    if (args[0] === "rev-parse") return "deadbeef\n";
    // Non-empty porcelain output — `worktreeChanges` reads this as "the write actually changed
    // something", which is what lets the recovery-path test reach a commit and a pull request.
    if (args[0] === "status") return " M a.ts\n";
    return "";
  };
  return { git, calls };
}

function baseDeps(gh: GhExec, git: GitExec, overrides: Partial<RecoverDeps> = {}): RecoverDeps {
  return {
    gh,
    git,
    runId: 999,
    readFile: () => JSON.stringify({ files: [{ path: "a.ts", content: "x" }], summary: "did the thing" }),
    writeFile: () => {},
    downloadArtifact: () => "/tmp/fake-artifact-dir",
    log: () => {},
    ...overrides,
  };
}

describe("resolveTicketFromArtifacts", () => {
  it("reads the ticket number off an implementer-answer-<n> artifact", () => {
    const { gh } = fakeGh({ artifacts: ["implementer-answer-266", "some-other-artifact"] });
    expect(resolveTicketFromArtifacts(gh, 999)).toBe(266);
  });

  it("is undefined when no artifact matches the shape", () => {
    const { gh } = fakeGh({ artifacts: ["some-other-artifact"] });
    expect(resolveTicketFromArtifacts(gh, 999)).toBeUndefined();
  });
});

describe("resolveTicketFromLog", () => {
  it("reads the ticket number off the 'implementing #<n>' line", () => {
    const { gh } = fakeGh({ logLine: "some log noise\nimplementing #266\nmore noise\n" });
    expect(resolveTicketFromLog(gh, 999)).toBe(266);
  });

  it("takes the last match when the line appears more than once", () => {
    const { gh } = fakeGh({ logLine: "implementing #1\nimplementing #266\n" });
    expect(resolveTicketFromLog(gh, 999)).toBe(266);
  });

  it("is undefined when the run's log names no ticket", () => {
    const { gh } = fakeGh({ logLine: "nothing here\n" });
    expect(resolveTicketFromLog(gh, 999)).toBeUndefined();
  });
});

describe("resolveRecoveryTarget", () => {
  it("prefers the artifact over the log line when both are present", () => {
    const { gh } = fakeGh({ artifacts: ["implementer-answer-266"], logLine: "implementing #1\n" });
    expect(resolveRecoveryTarget(gh, 999)).toEqual({ ticket: 266, hasArtifact: true });
  });

  it("falls back to the log line when no artifact exists", () => {
    const { gh } = fakeGh({ logLine: "implementing #266\n" });
    expect(resolveRecoveryTarget(gh, 999)).toEqual({ ticket: 266, hasArtifact: false });
  });

  it("is undefined when neither source names a ticket", () => {
    const { gh } = fakeGh({});
    expect(resolveRecoveryTarget(gh, 999)).toBeUndefined();
  });
});

describe("priorAttemptRunIds / attemptCommentBody", () => {
  it("reads back the run ids every marker comment carries, in comment order", () => {
    const comments = [attemptCommentBody(111, "did a thing"), "an unrelated comment", attemptCommentBody(222, "did another thing")];
    const { gh } = fakeGh({ comments });
    expect(priorAttemptRunIds(gh, 42)).toEqual([111, 222]);
  });

  it("is empty when the ticket carries no marker comment", () => {
    const { gh } = fakeGh({ comments: ["just a note"] });
    expect(priorAttemptRunIds(gh, 42)).toEqual([]);
  });
});

describe("redispatchImplement", () => {
  it("sends the exact event and payload key implement.yml reads", () => {
    const { gh, calls } = fakeGh();
    redispatchImplement(gh, 266);
    expect(calls).toContainEqual([
      "api",
      "repos/{owner}/{repo}/dispatches",
      "-f",
      `event_type=${IMPLEMENT_DISPATCH_EVENT_TYPE}`,
      "-f",
      "client_payload[issue]=266",
    ]);
  });
});

describe("runRecover — nothing to recover", () => {
  it("exits without writing anything when neither source names a ticket", async () => {
    const { gh, calls } = fakeGh({});
    const { git } = fakeGit();
    const outcome = await runRecover(baseDeps(gh, git));

    expect(outcome).toEqual({ outcome: "nothing-to-recover" });
    expect(calls.some((call) => call[0] === "issue" || call[0] === "label")).toBe(false);
  });
});

describe("runRecover — the cap", () => {
  it("stops on the third prior attempt, labels needs-human and assigns the owner, without touching git", async () => {
    process.env.GITHUB_REPOSITORY_OWNER = "collod873";
    const comments = [1, 2, 3].map((id) => attemptCommentBody(id, `attempt ${id}`));
    const { gh, calls } = fakeGh({ artifacts: ["implementer-answer-266"], comments });
    const { git, calls: gitCalls } = fakeGit();

    const outcome = await runRecover(baseDeps(gh, git, { runId: 4 }));

    expect(outcome).toEqual({ outcome: "stopped", attempts: 3 });
    expect(gitCalls).toEqual([]);

    const labelCreate = calls.find((call) => call[0] === "label" && call[1] === "create");
    expect(labelCreate?.[2]).toBe("needs-human");

    const labelApply = calls.find((call) => call[0] === "issue" && call[1] === "edit" && call.includes("--add-label"));
    expect(labelApply).toContain("needs-human");

    const assign = calls.find((call) => call.includes("--add-assignee"));
    expect(assign).toContain("collod873");

    const comment = calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(comment?.[4]).toContain("<!-- recover-attempt:4 -->");
    expect(comment?.[4]).toContain("Stopped after 3 recovery attempts");

    delete process.env.GITHUB_REPOSITORY_OWNER;
  });

  it("MAX_RECOVER_ATTEMPTS is 3, ADR-0041's ceiling", () => {
    expect(MAX_RECOVER_ATTEMPTS).toBe(3);
  });
});

describe("runRecover — recovery path", () => {
  it("claims the branch, writes the answer's files, commits, pushes, and opens a PR, in order", async () => {
    const { gh, calls } = fakeGh({ artifacts: ["implementer-answer-266"], prCreateUrl: "https://github.com/o/r/pull/42" });
    const { git, calls: gitCalls } = fakeGit();
    const writes: Array<{ path: string; content: string }> = [];

    const outcome = await runRecover(
      baseDeps(gh, git, {
        runId: 555,
        writeFile: (path, content) => writes.push({ path, content }),
        readFile: () => JSON.stringify({ files: [{ path: "a.ts", content: "hello" }], summary: "recovered it" }),
      }),
    );

    expect(outcome).toEqual({ outcome: "opened", pr: "https://github.com/o/r/pull/42" });
    expect(writes).toEqual([{ path: "a.ts", content: "hello" }]);

    // Claim, then commit sequence, then the PR — in that order.
    const claimIndex = calls.findIndex((call) => call[0] === "api" && call[1] === GIT_REFS_PATH);
    const prIndex = calls.findIndex((call) => call[0] === "pr" && call[1] === "create");
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(prIndex).toBeGreaterThan(claimIndex);

    expect(gitCalls.map((call) => call[0])).toEqual(["rev-parse", "status", "checkout", "add", "commit", "push"]);
    const commit = gitCalls.find((call) => call[0] === "commit");
    expect(commit?.[2]).toContain(`Recover #266 from run 555`);
    expect(commit?.[2]).toContain("recovered it");
    expect(commit?.[2]).toContain("Part of #266");

    const marker = calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(marker?.[4]).toContain("<!-- recover-attempt:555 -->");
    expect(marker?.[4]).toContain("Recovered #266");
  });
});

describe("runRecover — one failed run, two doors", () => {
  it("does nothing the second time it is told about a run it already reacted to", async () => {
    const { gh, calls } = fakeGh({
      artifacts: ["implementer-answer-266"],
      comments: ["<!-- recover-attempt:555 -->\nRecovered #266 from run 555: opened a PR."],
    });
    const { git, calls: gitCalls } = fakeGit();

    const outcome = await runRecover(baseDeps(gh, git, { runId: 555 }));

    expect(outcome).toEqual({ outcome: "already-handled" });
    expect(gitCalls).toEqual([]);
    expect(calls.some((call) => call[0] === "issue" && call[1] === "comment")).toBe(false);
  });
});

describe("runRecover — an answer no pull request may land", () => {
  it("escalates without claiming a branch when the answer writes into the immutable set", async () => {
    const { gh, calls } = fakeGh({ artifacts: ["implementer-answer-275"] });
    const { git, calls: gitCalls } = fakeGit();
    const writes: string[] = [];

    const outcome = await runRecover(
      baseDeps(gh, git, {
        runId: 61,
        writeFile: (path) => writes.push(path),
        readFile: () =>
          JSON.stringify({
            files: [
              { path: ".github/workflows/shape.yml", content: "x" },
              { path: ".Workflow/agent-workflows/shape/shape.ts", content: "y" },
            ],
            summary: "wired the checkpoints",
          }),
      }),
    );

    expect(outcome).toEqual({ outcome: "immutable", files: [".github/workflows/shape.yml"] });
    expect(writes).toEqual([]);
    expect(gitCalls).toEqual([]);
    expect(calls.some((call) => call[0] === "api" && call[1] === GIT_REFS_PATH)).toBe(false);
    expect(calls).toContainEqual(["issue", "edit", "275", "--add-label", "needs-human"]);
    const marker = calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(marker?.[4]).toContain("<!-- recover-attempt:61 -->");
    expect(marker?.[4]).toContain(".github/workflows/shape.yml");
    expect(marker?.[4]).not.toContain("shape/shape.ts");
  });
});

describe("runRecover — already claimed", () => {
  it("exits without writing files or opening a PR when the branch is already claimed", async () => {
    const branch = implementationBranch(266);
    const { gh, calls } = fakeGh({ artifacts: ["implementer-answer-266"], existingClaimBranch: branch });
    const { git } = fakeGit();
    let wrote = false;

    const outcome = await runRecover(baseDeps(gh, git, { writeFile: () => (wrote = true) }));

    expect(outcome).toEqual({ outcome: "already-claimed" });
    expect(wrote).toBe(false);
    expect(calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);
    expect(calls.some((call) => call[0] === "issue" && call[1] === "comment")).toBe(false);
  });
});

describe("runRecover — re-dispatch path", () => {
  it("sends the ticket-ready dispatch and posts a marker comment, without touching git", async () => {
    const { gh, calls } = fakeGh({ logLine: "implementing #266\n" });
    const { git, calls: gitCalls } = fakeGit();

    const outcome = await runRecover(baseDeps(gh, git, { runId: 7 }));

    expect(outcome).toEqual({ outcome: "redispatched", ticket: 266 });
    expect(gitCalls).toEqual([]);

    const dispatch = calls.find((call) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches");
    expect(dispatch).toEqual([
      "api",
      "repos/{owner}/{repo}/dispatches",
      "-f",
      `event_type=${IMPLEMENT_DISPATCH_EVENT_TYPE}`,
      "-f",
      "client_payload[issue]=266",
    ]);

    const marker = calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(marker?.[4]).toContain("<!-- recover-attempt:7 -->");
    expect(marker?.[4]).toContain("Re-dispatched #266");
  });
});

interface RecoverWorkflow {
  on?: { workflow_run?: { workflows?: string[]; types?: string[] }; repository_dispatch?: { types?: string[] }; workflow_dispatch?: unknown };
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: {
    recover: {
      if?: string;
      with?: { run_id?: string };
      steps?: Array<{
        name?: string;
        run?: string;
        env?: Record<string, string>;
        with?: { path?: string; repository?: string; token?: string };
      }>;
    };
  };
}

/**
 * ADR-0055 (amended by ADR-0132) split this lane: `recover-caller.yml` carries all three doors
 * and the routing decision `recover.yml`'s own job `if:` used to make (`workflow_run` cannot be
 * parameterized through `workflow_call`), and `recover.yml` itself is the reusable workflow it
 * calls, taking only the run id that decision resolved.
 */
describe("recover-caller.yml is the listener a red Implement never had", () => {
  const { workflow } = readWorkflow<RecoverWorkflow>("recover-caller.yml");

  it("fires on a completed workflow_run of Implement, plus a hand door", () => {
    expect(workflow.on?.workflow_run?.workflows).toEqual(["Implement"]);
    expect(workflow.on?.workflow_run?.types).toEqual(["completed"]);
    expect(workflow.on?.workflow_dispatch).toBeDefined();
  });

  it("reacts only to a failed run (or the hand door)", () => {
    expect(workflow.jobs.recover.if).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(workflow.jobs.recover.if).toContain("workflow_dispatch");
  });

  /**
   * A `timeout-minutes` kill reports `cancelled`, not `failure`, so a door spelled on `failure`
   * alone excludes the death it most exists for. #342's run 33687023105 was killed at 45 minutes
   * having written no answer, reached Recover through neither door, and left an orphaned claim ref
   * that made the ticket unbuildable — `reconcile.ts` reads a claim ref as started, and the
   * stale-claim takeover only runs inside a dispatch that would never come. Pinned on both doors
   * because they failed together and a fix to one alone leaves the other's gap open.
   */
  it("reacts to a cancelled run too, which is what a timeout reports", () => {
    expect(workflow.jobs.recover.if).toContain("github.event.workflow_run.conclusion == 'cancelled'");
  });

  /**
   * The second door. `workflow_run` arrived minutes late for two Verify runs and not at all for
   * Implement run 33326295612 on 2026-08-30; the dispatch lane 05 sends from its own
   * `if: failure()` step is the wire the rest of the pipeline chains on and did not miss once.
   * The names are pinned on both ends so neither file can rename the event alone (ADR-0090).
   */
  it("also answers the implement-failed dispatch lane 05 sends itself, keyed on the failed run", () => {
    expect(workflow.on?.repository_dispatch?.types).toEqual(["implement-failed"]);
    expect(workflow.jobs.recover.if).toContain("github.event.action == 'implement-failed'");
    expect(workflow.jobs.recover.with?.run_id).toContain("github.event.client_payload.run_id");

    const implement = readWorkflow<{ jobs: { implement: { steps: Array<{ if?: string; run?: string }> } } }>("implement.yml");
    const ring = implement.workflow.jobs.implement.steps.find((step) => step.run?.includes("event_type=implement-failed"));
    expect(ring?.if).toBe("failure() || cancelled()");
    expect(ring?.run).toContain("client_payload[run_id]=$GITHUB_RUN_ID");
  });
});

/**
 * The loop, not the listener: what runs once `recover-caller.yml` has already decided a run is
 * worth reacting to and handed this workflow the run id it resolved.
 */
describe("recover.yml, the reusable workflow recover-caller.yml calls", () => {
  const { workflow, source } = readWorkflow<RecoverWorkflow>("recover.yml");

  it("takes workflow_call, never a trigger of its own — that lives on the caller", () => {
    expect(Object.keys(workflow.on ?? {})).toEqual(["workflow_call"]);
  });

  it("grants the writes recover.ts performs: contents, pull-requests and issues, plus actions:read to resolve a run", () => {
    expect(workflow.permissions?.contents).toBe("write");
    expect(workflow.permissions?.["pull-requests"]).toBe("write");
    expect(workflow.permissions?.issues).toBe("write");
    expect(workflow.permissions?.actions).toBe("read");
  });

  it("never cancels a run in flight", () => {
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("runs recover.ts, which is the whole of what wiring this lane means", () => {
    expect(source).toContain(".Workflow/agent-workflows/recover/recover.ts");
  });

  it("installs no Claude CLI and binds no model secret — this lane never runs a model", () => {
    expect(source).not.toContain("npm install -g @anthropic-ai/claude-code");
    expect(source).not.toContain("secrets.CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("separates the machine it runs from the target a recovered answer lands in", () => {
    expectMachineAndTargetCheckouts({ workflow: "recover.yml", job: "recover", runs: "recover.ts" });
  });
});

describe("implement.yml still echoes the line recover.ts reads as a fallback", () => {
  const implement = readWorkflow("implement.yml");

  it("echoes 'implementing #<n>' before running implement.ts", () => {
    expect(implement.source).toContain('echo "implementing #$TICKET_NUMBER"');
  });
});
