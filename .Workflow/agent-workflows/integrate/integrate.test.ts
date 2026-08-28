import { describe, expect, it } from "vitest";
import { readWorkflow } from "../shared/read-workflow";
import { createFakeGit } from "../shared/git.fake";
import { type GauntletResult, runIntegrate, VERIFY_DISPATCH_EVENT_TYPE } from "./integrate";

const PR = "https://github.com/owner/repo/pull/42";
const BRANCH = "implement/issue-42";

/**
 * A minimal `GhExec` stand-in for this lane's own two calls — `pr view` (read
 * the branch to rebase) and `pr merge` (the one write a green run makes.
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
