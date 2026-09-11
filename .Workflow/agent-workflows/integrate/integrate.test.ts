import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, test } from "vitest";
import { RATIFIER_MERGED_DISPATCH_ACTION, RATIFIER_PR_TITLE } from "../shared/ratification-dispatch";
import { GRAPH_CHANGED_DISPATCH_ACTION, type IntegrateDeps, runIntegrate } from "./integrate";
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

  it("rings ratifier-merged too when the merged PR is the ratifier's, after the merge and before the graph bell", () => {
    const { calls, deps, dispatches } = integrateHarness({ title: RATIFIER_PR_TITLE, body: "Ratified things." });

    runIntegrate(deps);

    expect(dispatches).toEqual([
      { eventType: RATIFIER_MERGED_DISPATCH_ACTION, payload: { pr: PR } },
      { eventType: GRAPH_CHANGED_DISPATCH_ACTION, payload: { pr: PR } },
    ]);
    const mergeIndex = calls.findIndex((call) => call[0] === "pr" && call[1] === "merge");
    expect(calls.findIndex(isBell)).toBeGreaterThan(mergeIndex);
  });

  it("rings no ratifier-merged for a ratifier PR that did not merge", () => {
    const { dispatches, deps } = integrateHarness({ title: RATIFIER_PR_TITLE, gauntlet: { exitCode: 1 } });

    runIntegrate(deps);

    expect(dispatches).toEqual([]);
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

describe("runIntegrate rings the merged trunk's own CI", () => {
  const emptyCheckout = () => mkdtempSync(join(tmpdir(), "integrate-target-"));

  const checkoutWithCi = () => {
    const dir = emptyCheckout();
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "on: [push, workflow_dispatch]\n");
    return dir;
  };

  const at = (deps: IntegrateDeps, repoDir: string) => Object.assign({}, deps, { repoDir });

  const ciRings = (calls: string[][]) => calls.filter((call) => call[0] === "workflow" && call[1] === "run");

  const MERGED = { merged: true, closing: { closed: true, ticket: TICKET } };

  test(
    "#474.1: after a merge Integrate runs gh workflow run ci.yml --ref main when the target has .github/workflows/ci.yml, skips the ring when the file is absent, and reports merged: true either way and when the ring throws",
    () => {
      const present = integrateHarness({ closeTicket: CLOSED });

      const rung = runIntegrate(at(present.deps, checkoutWithCi()));

      const rings = ciRings(present.calls);
      expect(rings).toHaveLength(1);
      expect(rings[0].slice(0, 3)).toEqual(["workflow", "run", "ci.yml"]);
      expect(rings[0][rings[0].indexOf("--ref") + 1]).toBe("main");
      expect(present.calls.findIndex((call) => call[0] === "workflow")).toBeGreaterThan(
        present.calls.findIndex((call) => call[0] === "pr" && call[1] === "merge"),
      );
      expect(rung).toEqual(MERGED);

      const absent = integrateHarness({ closeTicket: CLOSED });

      const skipped = runIntegrate(at(absent.deps, emptyCheckout()));

      expect(ciRings(absent.calls)).toEqual([]);
      expect(mergeCalls(absent.calls)).toHaveLength(1);
      expect(skipped).toEqual(MERGED);

      const refused = integrateHarness({ closeTicket: CLOSED });
      const refusingGh = (args: string[]): string => {
        if (args[0] === "workflow") throw new Error("could not dispatch ci.yml");
        return refused.deps.gh(args);
      };

      const stood = runIntegrate(Object.assign({}, refused.deps, { gh: refusingGh, repoDir: checkoutWithCi() }));

      expect(stood).toEqual(MERGED);
      expect(mergeCalls(refused.calls)).toHaveLength(1);
      expect(refused.dispatches).toEqual([{ eventType: GRAPH_CHANGED_DISPATCH_ACTION, payload: { pr: PR } }]);
    },
  );

  test("#474.2: the ring reaches the fixture as an argv, not a shell string", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(at(deps, checkoutWithCi()));

    const rings = ciRings(calls);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toContain("ci.yml");
    expect(rings[0]).toContain("--ref");
    for (const arg of rings[0]) expect(arg).not.toMatch(/\s/);
    expect(calls.filter((call) => call.some((arg) => /workflow\s+run/.test(arg)))).toEqual([]);
  });

  test(
    "#474.3: docs/agents/integrate-lane-edges.md names the ring between mergePr() and announceGraphChanged() and says why a bot merge needs it",
    async () => {
      const doc = await readFile(new URL("../../../docs/agents/integrate-lane-edges.md", import.meta.url), "utf8");

      expect(doc).toMatch(/workflow_dispatch/i);

      const merge = doc.indexOf("mergePr()");
      const bell = doc.lastIndexOf("announceGraphChanged()");
      const ring = doc.indexOf("ci.yml", merge);
      expect(merge).toBeGreaterThan(-1);
      expect(bell).toBeGreaterThan(merge);
      expect(ring).toBeGreaterThan(merge);
      expect(ring).toBeLessThan(bell);
    },
  );
});
