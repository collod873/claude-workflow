import { describe, expect, it } from "vitest";
import { planFire } from "./canary-fire-plan.ts";
import { laneIds } from "./read-workflow.ts";

describe("planFire", () => {
  it("chooses push for a lane whose on: block carries push, unchanged from bin/canary's old behavior", () => {
    expect(planFire("verify")).toEqual({ kind: "push" });
    expect(planFire("back-stamp")).toEqual({ kind: "push" });
    expect(planFire("missing-trailer-counter")).toEqual({ kind: "push" });
    expect(planFire("decline-on-revert")).toEqual({ kind: "push" });
  });

  it("prefers workflow_dispatch over repository_dispatch and workflow_run on the same lane", () => {
    expect(planFire("fixer")).toEqual({ kind: "workflow_dispatch", event: "workflow_dispatch" });
    expect(planFire("recover")).toEqual({ kind: "workflow_dispatch", event: "workflow_dispatch" });
    expect(planFire("dispatch-reconcile")).toEqual({ kind: "workflow_dispatch", event: "workflow_dispatch" });
  });

  it("fires the declared event_type for a repository_dispatch-only lane", () => {
    expect(planFire("implement")).toEqual({
      kind: "repository_dispatch",
      event: "repository_dispatch",
      eventType: "ticket-ready",
    });
    expect(planFire("to-tickets")).toEqual({
      kind: "repository_dispatch",
      event: "repository_dispatch",
      eventType: "prd-sliceable",
    });
  });

  it("prefers repository_dispatch over an issues:labeled door on the same lane", () => {
    expect(planFire("spec")).toEqual({
      kind: "repository_dispatch",
      event: "repository_dispatch",
      eventType: "sheet-accepted",
    });
    expect(planFire("acceptance")).toEqual({
      kind: "repository_dispatch",
      event: "repository_dispatch",
      eventType: "acceptance-wanted",
    });
  });

  it("chooses issues_labeled for a lane whose only door is issues:labeled, and reads the label its guard demands", () => {
    expect(planFire("shape")).toEqual({ kind: "issues_labeled", event: "issues", demands: { label: "idea" } });
    expect(planFire("shape-accept")).toEqual({
      kind: "issues_labeled",
      event: "issues",
      demands: { label: "approved" },
    });
    expect(planFire("lost-dispatch-counter")).toEqual({
      kind: "issues_labeled",
      event: "issues",
      demands: { label: "sliceable" },
    });
  });

  it("keeps the label that fires the lane out of the labels the seed issue is born with", () => {
    const plan = planFire("shape");
    expect(plan.kind).toBe("issues_labeled");
    if (plan.kind === "issues_labeled") expect(plan.demands?.issueLabels).toBeUndefined();
  });

  it("ignores a negated contains() so a guard that forbids a label does not demand it", () => {
    const plan = planFire("spec");
    expect(plan.kind).toBe("repository_dispatch");
  });

  it("chooses issues_closed for a lane whose only door is issues:closed, and reads the guard in the reusable workflow", () => {
    expect(planFire("ratify-on-prd-close")).toEqual({
      kind: "issues_closed",
      event: "issues",
      demands: { issueLabels: ["prd"], stateReason: "completed" },
    });
  });

  it("chooses pull_request_closed for a lane whose only door is pull_request:closed, and titles the seed PR as its guard demands", () => {
    expect(planFire("ratify-release")).toEqual({
      kind: "pull_request_closed",
      event: "pull_request",
      demands: { pullRequestTitle: "Ratified: standards from this batch" },
    });
  });

  it("refuses a workflow_run-only lane and names the upstream lane it can prove instead", () => {
    for (const lane of ["bypass-counter", "review"]) {
      const plan = planFire(lane);
      expect(plan.kind).toBe("refuse");
      if (plan.kind === "refuse") {
        expect(plan.reason).toContain("workflow_run");
        expect(plan.reason).toContain("--lane verify");
      }
    }
  });

  it("produces a plan for every real caller.yml lane in the repo without throwing", () => {
    for (const lane of laneIds()) {
      expect(() => planFire(lane)).not.toThrow();
    }
  });
});
