import { describe, expect, it } from "vitest";
import { SPEC_DISPATCH_EVENT_TYPE } from "../spec/open-questions";
import { readWorkflow } from "./read-workflow";

/**
 * `to-tickets.yml`'s trigger moved from the `prd` label to lane 02's `repository_dispatch`
 * (PRD #145 move 6, ADR-0062: "the gate is a count… at zero the chain applies `sliceable` and
 * sends a `repository_dispatch`. Lane 03 fires on that dispatch, never on a label."). This reads
 * the workflow's own YAML back — `on:` and the job's `if:` — rather than grepping the file for a
 * string, so a reformatting that preserves meaning does not fail it and one that loses meaning
 * does. It checks the job-level `if:` against the same `SPEC_DISPATCH_EVENT_TYPE` constant lane
 * 02 sends, the way `run-watchdog.yml`'s test holds its own `if:` to `WATCHDOG_DISPATCH_ACTION`.
 */

interface Step {
  name: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
}

const { workflow } = readWorkflow<{
  on: { repository_dispatch?: unknown; issues?: unknown; workflow_call?: unknown };
  jobs: { "to-tickets": { if?: string; steps: Step[] } };
}>("to-tickets.yml");

// #315 (ADR-0055): to-tickets.yml is a reusable workflow now — the trigger itself lives in
// to-tickets-caller.yml, and to-tickets.yml carries only `workflow_call`.
const { workflow: caller } = readWorkflow<{
  on: { repository_dispatch?: unknown; issues?: unknown };
}>("to-tickets-caller.yml");

const job = workflow.jobs["to-tickets"];
const condition = job.if ?? "";

describe("to-tickets.yml's trigger, moved from the prd label to lane 02's dispatch", () => {
  it("is a reusable workflow, triggered by to-tickets-caller.yml's own trigger", () => {
    expect(workflow.on).toHaveProperty("workflow_call");
  });

  it("fires on repository_dispatch instead of the issues/labeled event", () => {
    expect(caller.on).toHaveProperty("repository_dispatch");
    expect(caller.on.issues).toBeUndefined();
  });

  it("scopes the job on the dispatch action lane 02 sends, not the prd label", () => {
    expect(condition).not.toContain("label.name == 'prd'");
    expect(condition).toContain(`github.event.action == '${SPEC_DISPATCH_EVENT_TYPE}'`);
  });
});

describe("to-tickets.yml's existing refusal steps are structurally unchanged", () => {
  const bySubstring = (needle: string) => job.steps.find((step) => step.name.includes(needle));

  it("still refuses a PRD that already has sub-issues, exactly as before", () => {
    const step = bySubstring("PRD already has sub-issues");
    expect(step).toBeDefined();
    expect(step!.id).toBe("refuse-sub-issues");
    expect(step!.run).toContain('sub_count=$(gh api "repos/${GH_REPO}/issues/${PRD_NUMBER}/sub_issues" --jq \'length\')');
    expect(step!.run).toContain("gh issue edit \"$PRD_NUMBER\" --add-label slice-failed");
    expect(step!.run).toContain('echo "refused=true" >> "$GITHUB_OUTPUT"');
  });

  it("still refuses a PRD that is itself a sub-issue, exactly as before", () => {
    const step = bySubstring("PRD is itself a sub-issue");
    expect(step).toBeDefined();
    expect(step!.id).toBe("refuse-nested-prd");
    expect(step!.run).toContain("issue(number: $num) { parent { number } }");
    expect(step!.run).toContain("gh issue edit \"$PRD_NUMBER\" --add-label slice-failed");
    expect(step!.run).toContain('echo "refused=true" >> "$GITHUB_OUTPUT"');
  });

  it("keeps the two refusals in their original order, before every other step", () => {
    const names = job.steps.map((step) => step.name);
    const subIndex = names.findIndex((name) => name.includes("PRD already has sub-issues"));
    const nestedIndex = names.findIndex((name) => name.includes("PRD is itself a sub-issue"));
    expect(subIndex).toBeGreaterThan(-1);
    expect(nestedIndex).toBe(subIndex + 1);
  });

  it("still guards the shared failure report on both refusals' outputs", () => {
    const report = bySubstring("Report failure");
    expect(report).toBeDefined();
    expect(report!.if).toContain("steps.refuse-sub-issues.outputs.refused != 'true'");
    expect(report!.if).toContain("steps.refuse-nested-prd.outputs.refused != 'true'");
  });
});
