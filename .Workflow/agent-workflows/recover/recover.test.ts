import { describe, expect, it } from "vitest";
import { IMPLEMENT_DISPATCH_EVENT_TYPE } from "../implement/implement";
import { checkoutReporting } from "../shared/claim-host.fixture";
import type { GhExec } from "../shared/gh";
import { GIT_REFS_PATH } from "../shared/gh-paths";
import type { GitExec } from "../shared/git";
import { implementationBranch } from "../shared/ready-set";
import { failedRunWith } from "./failed-run.fixture";
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
    const { gh } = failedRunWith({ artifacts: ["implementer-answer-266", "some-other-artifact"] });
    expect(resolveTicketFromArtifacts(gh, 999)).toBe(266);
  });

  it("is undefined when no artifact matches the shape", () => {
    const { gh } = failedRunWith({ artifacts: ["some-other-artifact"] });
    expect(resolveTicketFromArtifacts(gh, 999)).toBeUndefined();
  });
});

describe("resolveTicketFromLog", () => {
  it("reads the ticket number off the 'implementing #<n>' line", () => {
    const { gh } = failedRunWith({ logLine: "some log noise\nimplementing #266\nmore noise\n" });
    expect(resolveTicketFromLog(gh, 999)).toBe(266);
  });

  it("takes the last match when the line appears more than once", () => {
    const { gh } = failedRunWith({ logLine: "implementing #1\nimplementing #266\n" });
    expect(resolveTicketFromLog(gh, 999)).toBe(266);
  });

  it("is undefined when the run's log names no ticket", () => {
    const { gh } = failedRunWith({ logLine: "nothing here\n" });
    expect(resolveTicketFromLog(gh, 999)).toBeUndefined();
  });
});

describe("resolveRecoveryTarget", () => {
  it("prefers the artifact over the log line when both are present", () => {
    const { gh } = failedRunWith({ artifacts: ["implementer-answer-266"], logLine: "implementing #1\n" });
    expect(resolveRecoveryTarget(gh, 999)).toEqual({ ticket: 266, hasArtifact: true });
  });

  it("falls back to the log line when no artifact exists", () => {
    const { gh } = failedRunWith({ logLine: "implementing #266\n" });
    expect(resolveRecoveryTarget(gh, 999)).toEqual({ ticket: 266, hasArtifact: false });
  });

  it("is undefined when neither source names a ticket", () => {
    const { gh } = failedRunWith({});
    expect(resolveRecoveryTarget(gh, 999)).toBeUndefined();
  });
});

describe("priorAttemptRunIds / attemptCommentBody", () => {
  it("reads back the run ids every marker comment carries, in comment order", () => {
    const comments = [attemptCommentBody(111, "did a thing"), "an unrelated comment", attemptCommentBody(222, "did another thing")];
    const { gh } = failedRunWith({ comments });
    expect(priorAttemptRunIds(gh, 42)).toEqual([111, 222]);
  });

  it("is empty when the ticket carries no marker comment", () => {
    const { gh } = failedRunWith({ comments: ["just a note"] });
    expect(priorAttemptRunIds(gh, 42)).toEqual([]);
  });
});

describe("redispatchImplement", () => {
  it("sends the exact event and payload key implement.yml reads", () => {
    const { gh, calls } = failedRunWith();
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

describe("runRecover: nothing to recover", () => {
  it("exits without writing anything when neither source names a ticket", async () => {
    const { gh, calls } = failedRunWith({});
    const { git } = checkoutReporting();
    const outcome = await runRecover(baseDeps(gh, git));

    expect(outcome).toEqual({ outcome: "nothing-to-recover" });
    expect(calls.some((call) => call[0] === "issue" || call[0] === "label")).toBe(false);
  });
});

describe("runRecover: the dead run's claim", () => {
  it("releases the claim before re-dispatching, so the fresh run is not refused by a dead one's ref", async () => {
    const { gh, calls } = failedRunWith({ artifacts: [], comments: [], logLine: "implementing #266" });
    const { git } = checkoutReporting();

    const outcome = await runRecover(baseDeps(gh, git, { runId: 900 }));

    expect(outcome).toMatchObject({ outcome: "redispatched" });

    const released = calls.findIndex(
      (call) => call.includes("--method") && call.includes("DELETE") && call.some((a) => a.includes("implement/issue-")),
    );
    const dispatched = calls.findIndex((call) => call.some((a) => a.includes("ticket-ready")));
    expect(released, "the dead run's claim was never released").toBeGreaterThanOrEqual(0);
    expect(dispatched, "no fresh dispatch was sent").toBeGreaterThanOrEqual(0);
    expect(released, "released the claim after re-dispatching, which is too late to help").toBeLessThan(dispatched);
  });
});

describe("runRecover: the cap", () => {
  it("stops on the third prior attempt, labels needs-human and assigns the owner, without touching git", async () => {
    process.env.GITHUB_REPOSITORY_OWNER = "collod873";
    const comments = [1, 2, 3].map((id) => attemptCommentBody(id, `attempt ${id}`));
    const { gh, calls } = failedRunWith({ artifacts: ["implementer-answer-266"], comments });
    const { git, calls: gitCalls } = checkoutReporting();

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

describe("runRecover: recovery path", () => {
  it("claims the branch, writes the answer's files, commits, pushes, and opens a PR, in order", async () => {
    const { gh, calls } = failedRunWith({ artifacts: ["implementer-answer-266"], prCreateUrl: "https://github.com/o/r/pull/42" });
    const { git, calls: gitCalls } = checkoutReporting();
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

    const claimIndex = calls.findIndex((call) => call[0] === "api" && call[1] === GIT_REFS_PATH);
    const prIndex = calls.findIndex((call) => call[0] === "pr" && call[1] === "create");
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(prIndex).toBeGreaterThan(claimIndex);

    expect(gitCalls.map((call) => call[0])).toEqual(["ls-files", "rev-parse", "status", "diff", "checkout", "add", "commit", "push"]);
    const commit = gitCalls.find((call) => call[0] === "commit");
    expect(commit?.[2]).toContain(`Recover #266 from run 555`);
    expect(commit?.[2]).toContain("recovered it");
    expect(commit?.[2]).toContain("Part of #266");

    const marker = calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(marker?.[4]).toContain("<!-- recover-attempt:555 -->");
    expect(marker?.[4]).toContain("Recovered #266");
  });
});

describe("runRecover: one failed run, two doors", () => {
  it("does nothing the second time it is told about a run it already reacted to", async () => {
    const { gh, calls } = failedRunWith({
      artifacts: ["implementer-answer-266"],
      comments: ["<!-- recover-attempt:555 -->\nRecovered #266 from run 555: opened a PR."],
    });
    const { git, calls: gitCalls } = checkoutReporting();

    const outcome = await runRecover(baseDeps(gh, git, { runId: 555 }));

    expect(outcome).toEqual({ outcome: "already-handled" });
    expect(gitCalls).toEqual([]);
    expect(calls.some((call) => call[0] === "issue" && call[1] === "comment")).toBe(false);
  });
});

describe("runRecover: an answer no pull request may land", () => {
  async function refusedAnswer(runId: number, forbidden: string) {
    const { gh, calls } = failedRunWith({ artifacts: ["implementer-answer-275"] });
    const { git, calls: gitCalls } = checkoutReporting();
    const writes: string[] = [];

    const outcome = await runRecover(
      baseDeps(gh, git, {
        runId,
        writeFile: (path) => writes.push(path),
        readFile: () =>
          JSON.stringify({
            files: [
              { path: forbidden, content: "x" },
              { path: ".Workflow/agent-workflows/shape/shape.ts", content: "y" },
            ],
            summary: "wired the checkpoints",
          }),
      }),
    );

    expect(writes).toEqual([]);
    expect(calls.some((call) => call[0] === "api" && call[1] === GIT_REFS_PATH)).toBe(false);
    expect(calls).toContainEqual(["issue", "edit", "275", "--add-label", "needs-human"]);
    const marker = calls.find((call) => call[0] === "issue" && call[1] === "comment")?.[4];
    expect(marker).toContain(`<!-- recover-attempt:${runId} -->`);
    expect(marker).toContain(forbidden);
    expect(marker).not.toContain("shape/shape.ts");
    return { outcome, gitHeads: gitCalls.map((call) => call[0]) };
  }

  it("escalates without claiming a branch when the answer writes into the immutable set", async () => {
    const { outcome, gitHeads } = await refusedAnswer(61, ".github/workflows/shape.yml");

    expect(outcome).toEqual({ outcome: "immutable", files: [".github/workflows/shape.yml"] });
    expect(gitHeads).toEqual([]);
  });

  it("escalates without claiming a branch when the answer creates a gate file", async () => {
    const { outcome, gitHeads } = await refusedAnswer(62, "bin/new-check");

    expect(outcome).toEqual({ outcome: "gate-growth", files: ["bin/new-check"] });
    expect(gitHeads).toEqual(["ls-files"]);
  });
});

describe("runRecover: already claimed", () => {
  it("exits without writing files or opening a PR when the branch is already claimed", async () => {
    const branch = implementationBranch(266);
    const { gh, calls } = failedRunWith({ artifacts: ["implementer-answer-266"], existingClaimBranch: branch });
    const { git } = checkoutReporting();
    let wrote = false;

    const outcome = await runRecover(baseDeps(gh, git, { writeFile: () => (wrote = true) }));

    expect(outcome).toEqual({ outcome: "already-claimed" });
    expect(wrote).toBe(false);
    expect(calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);
    expect(calls.some((call) => call[0] === "issue" && call[1] === "comment")).toBe(false);
  });
});

describe("runRecover: re-dispatch path", () => {
  it("sends the ticket-ready dispatch and posts a marker comment, without touching git", async () => {
    const { gh, calls } = failedRunWith({ logLine: "implementing #266\n" });
    const { git, calls: gitCalls } = checkoutReporting();

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
