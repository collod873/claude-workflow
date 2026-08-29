import { describe, expect, it } from "vitest";
import { readWorkflow } from "../shared/read-workflow";
import { TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION } from "../to-tickets/slice-and-publish";

/**
 * #201: lane 04 had only its `issues: edited` re-fire, so `tests/acceptance/` had never existed
 * on `main` and lane 06/08's immutability check ran against a directory nothing had written. This
 * reads `acceptance.yml`'s own YAML back — the same approach `to-tickets/slice-and-publish.test.ts`
 * and `to-tickets-workflow.test.ts` take — rather than grepping the file for a string, so a
 * reformatting that preserves meaning does not fail it and one that loses meaning does.
 */

interface Step {
  name: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
}

interface Job {
  if?: string;
  needs?: string[];
  steps: Step[];
}

const { workflow } = readWorkflow<{
  on: { repository_dispatch?: { types?: string[] }; issues?: unknown };
  jobs: Record<string, Job>;
}>("acceptance.yml");

describe("acceptance.yml authors a slice's tests the first time, not only on re-fire", () => {
  it("fires on the acceptance-wanted dispatch lane 03 sends, alongside the issues:edited re-fire", () => {
    expect(workflow.on.issues).toBeDefined();
    expect(workflow.on.repository_dispatch?.types).toEqual([ACCEPTANCE_WANTED_DISPATCH_ACTION]);
  });

  it("scopes the author job on that dispatch's action", () => {
    expect(workflow.jobs.author.if).toContain(`github.event.action == '${ACCEPTANCE_WANTED_DISPATCH_ACTION}'`);
  });

  it("runs acceptance.ts's single-issue mode, not --refire, against the dispatched issue", () => {
    const step = workflow.jobs.author.steps.find((s) => s.run?.includes("acceptance.ts"));
    expect(step?.run).toContain('acceptance.ts "$TICKET_NUMBER"');
    expect(step?.run).not.toContain("--refire");
  });

  it("lands from either refire or author, and only when one of them actually authored something", () => {
    expect(workflow.jobs.land.needs).toEqual(expect.arrayContaining(["refire", "author"]));
    expect(workflow.jobs.land.if).toContain("needs.refire.outputs.authored == 'true'");
    expect(workflow.jobs.land.if).toContain("needs.author.outputs.authored == 'true'");
  });

  it("sends ticket-ready only for a slice lane 03 marked ready, after landing its tests", () => {
    const step = workflow.jobs.land.steps.find((s) => s.run?.includes("dispatches"));
    expect(step?.run).toContain(`event_type=${TICKET_READY_DISPATCH_ACTION}`);
    expect(step?.if).toContain(`github.event.action == '${ACCEPTANCE_WANTED_DISPATCH_ACTION}'`);
    expect(step?.if).toContain("github.event.client_payload.ready == '1'");
  });

  it("names the same action implement.yml's job gates on", () => {
    const { workflow: implementWorkflow } = readWorkflow<{ jobs: { implement: { if: string } } }>("implement.yml");
    expect(implementWorkflow.jobs.implement.if).toContain(
      `github.event.action == '${TICKET_READY_DISPATCH_ACTION}'`,
    );
  });

  it("re-uses one bundle-and-upload composite action rather than a second copy of the same steps", () => {
    const refireBundle = workflow.jobs.refire.steps.find((s) => s.id === "bundle");
    const authorBundle = workflow.jobs.author.steps.find((s) => s.id === "bundle");
    expect(refireBundle?.uses).toBe("./.github/actions/acceptance-bundle");
    expect(authorBundle?.uses).toBe("./.github/actions/acceptance-bundle");
  });
});
