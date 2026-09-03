import { describe, expect, it } from "vitest";
import { GRAPH_CHANGED_DISPATCH_ACTION, runIntegrate } from "./integrate";
import {
  BRANCH,
  CLOSED,
  integrateHarness,
  mergeCalls,
  PR,
  prComments,
  RANGE,
  REFUSED,
  TICKET,
} from "./integrate-harness.fixture";

describe("runIntegrate", () => {
  it("rebases the PR's branch onto current trunk before doing anything else", () => {
    const { fakeGit, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(fakeGit.calls.slice(0, 4)).toEqual([
      ["fetch", "origin", "main", BRANCH],
      ["checkout", BRANCH],
      ["rebase", "origin/main"],
      ["push", "--force-with-lease", "origin", `HEAD:${BRANCH}`],
    ]);
  });

  it("merges on a completed green verification run", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: true, ticket: TICKET } });
    expect(mergeCalls(calls)).toEqual([["pr", "merge", PR, "--merge", "--delete-branch"]]);
  });

  it("produces no merge call on a completed red run", () => {
    const { calls, deps } = integrateHarness({ gauntlet: { exitCode: 1 } });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "red" });
    expect(mergeCalls(calls)).toEqual([]);
  });

  it("produces no merge call when there is no completed run at all, distinct from the red case", () => {
    const { calls, deps } = integrateHarness({ gauntlet: { exitCode: 2 } });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "no-run" });
    expect(mergeCalls(calls)).toEqual([]);
    expect(outcome).not.toEqual({ merged: false, reason: "red" });
  });
});

describe("runIntegrate closes the ticket its merged pull request named", () => {
  const issueComments = (calls: string[][]) => calls.filter((call) => call[0] === "issue" && call[1] === "comment");

  it("closes the ticket the PR body names, against the merged commits, after the merge", () => {
    const { calls, closeCalls, deps } = integrateHarness({ closeTicket: CLOSED });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: true, ticket: TICKET } });
    expect(closeCalls).toEqual([[TICKET, RANGE]]);
    expect(issueComments(calls)).toEqual([]);
  });

  it("reads the range before the merge moves trunk", () => {
    const { fakeGit, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(fakeGit.calls.map((call) => call.join(" ")).slice(4)).toEqual([
      "rev-parse origin/main",
      "rev-parse HEAD",
    ]);
  });

  it("closes nothing when nothing merged", () => {
    for (const exitCode of [1, 2] as const) {
      const { closeCalls, deps } = integrateHarness({ gauntlet: { exitCode } });

      runIntegrate(deps);

      expect(closeCalls).toEqual([]);
    }
  });

  it("leaves the ticket open and the lane green when a criterion does not verify", () => {
    const { calls, deps } = integrateHarness({ closeTicket: REFUSED });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: false, reason: "refused", ticket: TICKET } });
    expect(mergeCalls(calls)).toHaveLength(1);
  });

  it("says so on the ticket when it refuses, quoting what close-ticket reported", () => {
    const { calls, deps } = integrateHarness({ closeTicket: REFUSED });

    runIntegrate(deps);

    const comments = issueComments(calls);
    expect(comments).toHaveLength(1);
    expect(comments[0].slice(0, 4)).toEqual(["issue", "comment", String(TICKET), "--body"]);
    expect(comments[0][4]).toContain(REFUSED.output);
    expect(comments[0][4]).toContain(PR);
  });

  it("treats a ticket whose every criterion is unverified as an ordinary refusal, not a failure", () => {
    const { deps } = integrateHarness({ closeTicket: REFUSED });

    expect(() => runIntegrate(deps)).not.toThrow();
  });

  it("stays merged and green when even the refusal comment fails", () => {
    const { deps } = integrateHarness({ closeTicket: REFUSED, commentThrows: true });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: false, reason: "refused", ticket: TICKET } });
  });

  it("merges and closes nothing when the pull request names no ticket", () => {
    const { closeCalls, deps } = integrateHarness({ body: "A branch somebody pushed by hand." });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true, closing: { closed: false, reason: "no-ticket" } });
    expect(closeCalls).toEqual([]);
  });

  it("reads the ticket out of the body rather than asking GitHub which issues the PR closes", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    const views = calls.filter((call) => call[0] === "pr" && call[1] === "view");
    expect(views).toHaveLength(1);
    expect(views[0].join(" ")).not.toContain("closingIssuesReferences");
  });
});

describe("runIntegrate announces the merge without interpreting it", () => {
  const isBell = (call: string[]) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches";

  it("sends exactly one graph-changed carrying the pull request and nothing else, after the merge", () => {
    const { calls, deps, dispatches } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(dispatches).toEqual([{ eventType: GRAPH_CHANGED_DISPATCH_ACTION, payload: { pr: PR } }]);
    const mergeIndex = calls.findIndex((call) => call[0] === "pr" && call[1] === "merge");
    expect(mergeIndex).toBeGreaterThan(-1);
    expect(calls.findIndex(isBell)).toBeGreaterThan(mergeIndex);
  });

  it("rings only after the close, so the reconciler reads the graph the doorbell announces", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });
    const wrapped = {
      ...deps,
      closeTicket: (ticket: number, range: string) => {
        calls.push(["closeTicket", String(ticket)]);
        return deps.closeTicket(ticket, range);
      },
    };

    runIntegrate(wrapped);

    const closeIndex = calls.findIndex((call) => call[0] === "closeTicket");
    expect(closeIndex).toBeGreaterThan(-1);
    expect(calls.findIndex(isBell)).toBeGreaterThan(closeIndex);
  });

  it("rings nothing when nothing merged", () => {
    for (const exitCode of [1, 2] as const) {
      const { deps, dispatches } = integrateHarness({ gauntlet: { exitCode } });

      runIntegrate(deps);

      expect(dispatches).toEqual([]);
    }
  });

  it("makes no gh call that reads the dependency graph", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(
      calls.filter((call) => call.some((arg) => arg.includes("dependencies/blocked_by"))),
      "the doorbell carries no graph read: ADR-0069 keeps the graph lane 03's",
    ).toEqual([]);
  });
});

describe("runIntegrate when the rebase onto trunk conflicts", () => {
  const CONFLICTS = [".Workflow/agent-workflows/integrate/integrate.ts", "docs/adr/README.md"];

  it("aborts the rebase and never force-pushes the branch it could not rebase", () => {
    const { fakeGit, deps } = integrateHarness({ rebaseLeavesUnmerged: CONFLICTS });

    runIntegrate(deps);

    const spelled = fakeGit.calls.map((call) => call.join(" "));
    expect(spelled).toContain("rebase --abort");
    expect(spelled.indexOf("diff --name-only --diff-filter=U")).toBeLessThan(spelled.indexOf("rebase --abort"));
    expect(spelled.some((call) => call.startsWith("push"))).toBe(false);
  });

  it("labels the ticket needs-human, assigns the owner, and comments the conflicting paths on the pull request", () => {
    const { calls, deps } = integrateHarness({ rebaseLeavesUnmerged: CONFLICTS });

    runIntegrate({ ...deps, assignee: "collod873" });

    expect(calls.filter((call) => call[0] === "pr" && call[1] === "edit")).toEqual([]);
    expect(calls.filter((call) => call[0] === "issue" && call[1] === "edit")).toEqual([
      ["issue", "edit", String(TICKET), "--add-label", "needs-human"],
      ["issue", "edit", String(TICKET), "--add-assignee", "collod873"],
    ]);

    const comments = prComments(calls);
    expect(comments).toHaveLength(1);
    for (const path of CONFLICTS) expect(comments[0][4]).toContain(path);
  });

  it("returns a conflict outcome rather than throwing, and merges nothing", () => {
    const { calls, closeCalls, deps } = integrateHarness({ rebaseLeavesUnmerged: CONFLICTS });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "conflict", paths: CONFLICTS });
    expect(mergeCalls(calls)).toEqual([]);
    expect(closeCalls).toEqual([]);
    expect(outcome).not.toEqual({ merged: false, reason: "no-run" });
  });

  it("spends no gauntlet run on a branch it never rebased", () => {
    const { deps, gauntletRuns } = integrateHarness({ rebaseLeavesUnmerged: CONFLICTS });

    runIntegrate(deps);

    expect(gauntletRuns(), "a tree that is still trunk's tells this lane nothing").toBe(0);
  });

  it("re-throws a rebase that failed with nothing left unmerged, which is not a conflict", () => {
    const { calls, deps } = integrateHarness({ rebaseLeavesUnmerged: [] });

    expect(() => runIntegrate(deps)).toThrow(/CONFLICT/);
    expect(calls.filter((call) => call[0] === "pr" && call[1] === "edit")).toEqual([]);
  });
});
