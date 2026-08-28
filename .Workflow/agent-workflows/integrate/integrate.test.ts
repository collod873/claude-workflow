import { describe, expect, it } from "vitest";
import { readWorkflow } from "../shared/read-workflow";
import { createFakeGit } from "../shared/git.fake";
import {
  GRAPH_CHANGED_DISPATCH_ACTION,
  runIntegrate,
  VERIFY_DISPATCH_EVENT_TYPE,
  type GauntletResult,
} from "./integrate";

const PR = "https://github.com/owner/repo/pull/42";
const BRANCH = "implement/issue-42";

/**
 * A minimal `GhExec` stand-in for this lane's own three calls — `pr view` (read
 * the branch to rebase), `pr merge` (the one write a green run makes) and the
 * `graph-changed` doorbell that follows it.
 * `shared/gh.fake.ts`'s `FakeGh` models a different consumer's endpoints
 * (sub-issues, blocked-by edges) and would throw on either of these, so this
 * test scripts its own rather than reusing it.
 */
function integrateDeps(gauntlet: GauntletResult) {
  const fakeGit = createFakeGit(() => "");
  const calls: string[][] = [];

  const gh = (args: string[]): string => {
    calls.push(args);
    if (args[0] === "pr" && args[1] === "view") return `${BRANCH}\n`;
    if (args[0] === "pr" && args[1] === "merge") return "";
    if (args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches") return "";
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return {
    fakeGit,
    calls,
    deps: {
      git: fakeGit.git,
      gh,
      pr: PR,
      runGauntlet: () => gauntlet,
    },
  };
}

describe("runIntegrate", () => {
  it("rebases the PR's branch onto current trunk before doing anything else", () => {
    const { fakeGit, deps } = integrateDeps({ exitCode: 0 });

    runIntegrate(deps);

    expect(fakeGit.calls).toEqual([
      ["fetch", "origin", "main", BRANCH],
      ["checkout", BRANCH],
      ["rebase", "origin/main"],
      ["push", "--force-with-lease", "origin", `HEAD:${BRANCH}`],
    ]);
  });

  it("merges on a completed green verification run", () => {
    const { calls, deps } = integrateDeps({ exitCode: 0 });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: true });
    const mergeCalls = calls.filter((call) => call[0] === "pr" && call[1] === "merge");
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]).toEqual(["pr", "merge", PR, "--merge", "--delete-branch"]);
  });

  it("produces no merge call on a completed red run", () => {
    const { calls, deps } = integrateDeps({ exitCode: 1 });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "red" });
    expect(calls.some((call) => call[0] === "pr" && call[1] === "merge")).toBe(false);
  });

  it("produces no merge call when there is no completed run at all, distinct from the red case", () => {
    const { calls, deps } = integrateDeps({ exitCode: 2 });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "no-run" });
    expect(calls.some((call) => call[0] === "pr" && call[1] === "merge")).toBe(false);
    // Distinct from the red case, not merely another way to spell "no merge".
    expect(outcome).not.toEqual({ merged: false, reason: "red" });
  });
});

/**
 * The doorbell (#179).
 *
 * A merge is the thing that makes some other slice's last blocker deliver, and this lane is the only
 * thing that knows a merge happened. It says so and stops there. #178 proposed lane 08 promote its
 * successors and accepted a second lane reasoning about the graph as the cost; under a doorbell that
 * cost is not paid at all, which is what keeps ADR-0069 applied rather than amended.
 */
describe("runIntegrate announces the merge without interpreting it", () => {
  it("sends exactly one graph-changed naming the PR, after the merge", () => {
    const { calls, deps } = integrateDeps({ exitCode: 0 });

    runIntegrate(deps);

    const dispatches = calls.filter((call) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toContain(`event_type=${GRAPH_CHANGED_DISPATCH_ACTION}`);
    expect(dispatches[0]).toContain(`client_payload[pr]=${PR}`);

    const mergeIndex = calls.findIndex((call) => call[0] === "pr" && call[1] === "merge");
    expect(mergeIndex).toBeGreaterThan(-1);
    expect(calls.indexOf(dispatches[0])).toBeGreaterThan(mergeIndex);
  });

  it("rings nothing when nothing merged", () => {
    for (const exitCode of [1, 2] as const) {
      const { calls, deps } = integrateDeps({ exitCode });

      runIntegrate(deps);

      expect(calls.filter((call) => call[0] === "api")).toEqual([]);
    }
  });

  it("makes no gh call that reads the dependency graph", () => {
    const { calls, deps } = integrateDeps({ exitCode: 0 });

    runIntegrate(deps);

    expect(
      calls.filter((call) => call.some((arg) => arg.includes("dependencies/blocked_by"))),
      "the doorbell carries no graph read: ADR-0069 keeps the graph lane 03's",
    ).toEqual([]);
  });

  it("carries no payload beyond the pull request — no tracker read, no slice numbers", () => {
    const { calls, deps } = integrateDeps({ exitCode: 0 });

    runIntegrate(deps);

    const dispatch = calls.find((call) => call[1] === "repos/{owner}/{repo}/dispatches") ?? [];
    const payloadFields = dispatch.filter((arg) => arg.startsWith("client_payload["));
    expect(payloadFields).toEqual([`client_payload[pr]=${PR}`]);
  });
});

/**
 * DESIGN.md §10's "exactly one merge at a time" is a claim about every pull request this lane
 * could ever touch, not one per branch or per PR — so the concurrency group must be a single fixed
 * name, never interpolated on anything about the event, or two completed-green dispatches for two
 * different pull requests would still be free to merge in parallel.
 */
describe("integrate.yml's concurrency group", () => {
  const { workflow } = readWorkflow<{
    on?: { repository_dispatch?: unknown };
    concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    jobs: { integrate: { if?: string } };
  }>("integrate.yml");

  it("declares a concurrency group", () => {
    expect(workflow.concurrency, "no top-level concurrency: block").toBeDefined();
    expect(workflow.concurrency?.group, "no concurrency.group").toBeTruthy();
  });

  it("names a fixed group with no per-event interpolation, so two completed-green events cannot merge simultaneously", () => {
    expect(workflow.concurrency?.group).not.toMatch(/\$\{\{/);
  });

  it("does not cancel a queued run in favour of a newer one", () => {
    // Cancelling would let a second dispatch's merge preempt a first one still rebasing/gauntleting
    // — exactly the "more than one merge at a time" this group exists to rule out.
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("gates its job on the same repository_dispatch action integrate.ts re-exports", () => {
    expect(workflow.jobs.integrate.if).toBe(`github.event.action == '${VERIFY_DISPATCH_EVENT_TYPE}'`);
  });
});
