import { describe, expect, it } from "vitest";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "../spec/publish";
import { readWorkflow } from "./read-workflow";

/**
 * `spec.yml`'s three doors: the hand label `to-spec` starts the cold door whatever the source, the
 * label `prd` feeds the critic-only door alone (ADR-0085), and the accept's `sheet-accepted`
 * dispatch starts the cold door without a hand at all. The two label doors are `issues: labeled`
 * events gated on `github.event.sender` being the repository owner, the same shape ADR-0073 gives
 * `shape.yml`; the dispatch needs no such gate. This reads the workflow's own YAML `if:` rather
 * than grepping the file for strings, so a reformatting that preserves meaning does not fail it,
 * and a reformatting that loses meaning does.
 */

const { workflow } = readWorkflow<{
  on: Record<string, unknown>;
  jobs: { spec: { if?: string } };
}>("spec.yml");

// #315 (ADR-0055): spec.yml is a reusable workflow now — its own trigger is `workflow_call`, and
// the three doors this file's job `if:` still tells apart live in spec-caller.yml instead.
const { workflow: caller } = readWorkflow<{ on: Record<string, unknown> }>("spec-caller.yml");

const condition = workflow.jobs.spec.if ?? "";

describe("spec.yml's trigger, the owner-gated to-spec door", () => {
  it("gates the to-spec label on the sender being the repository owner", () => {
    expect(condition).toContain("github.event_name == 'issues'");
    expect(condition).toContain("github.event.label.name == 'to-spec'");
    expect(condition).toContain("github.event.sender.login == github.repository_owner");
  });

  it("ORs the branches together, rather than ANDing them into an unfireable condition", () => {
    // Every branch is parenthesized and joined by `||` at the top level — never `&&`, which would
    // require two different label names on one event. Split on the top-level `) ||` so the test
    // asserts the shape rather than the order.
    const branches = condition.split(") ||").map((branch) => branch.trim());
    expect(branches.length).toBeGreaterThanOrEqual(3);

    // Every branch names the event it fires on, and there are two of them: the two label doors, and
    // the accept's dispatch. A branch naming neither would fire on anything this file listens for.
    for (const branch of branches) {
      expect(branch).toMatch(/github\.event_name == '(issues|repository_dispatch)'/);
    }
  });

  it("gates both label doors on the sender, and the dispatch on nothing", () => {
    // A label can be applied by anyone on a public repo, so both label branches carry ADR-0073's
    // sender gate. A `repository_dispatch` can only come from something already holding a token
    // here, so its branch carries none — the same reasoning `implement.yml` records.
    const branches = condition.split(") ||").map((branch) => branch.trim());
    for (const branch of branches) {
      const gated = branch.includes("github.event.sender.login == github.repository_owner");
      expect(gated).toBe(branch.includes("github.event_name == 'issues'"));
    }
  });
});

/**
 * ADR-0085's critic-only door: the owner's own hand putting `prd` on a spec he wrote in a live
 * session.
 */
describe("spec.yml's critic-only door fires on the owner's own prd label", () => {
  const prdBranch = condition
    .split(") ||")
    .find((branch) => branch.includes("github.event.label.name == 'prd'"));

  it("has a labeled branch on prd, distinct from the to-spec one", () => {
    expect(prdBranch).toBeDefined();
    expect(prdBranch).not.toContain("to-spec");
  });

  it("gates it on the sender being the repository owner, because this lane spends model", () => {
    // The repository is public and `prd` can be applied by anyone with write access (ADR-0073,
    // ADR-0075), so this carries the same sender gate the `to-spec` clause already does.
    expect(prdBranch).toContain("github.event.sender.login == github.repository_owner");
  });

  it("does not fire on a spec that has already passed the gate", () => {
    expect(prdBranch).toContain("!contains(github.event.issue.labels.*.name, 'sliceable')");
  });
});

/**
 * #263: the round loop, the posted open-questions comment and the comment-triggered re-run are all
 * deleted, so there is nothing left for a comment on a `prd` issue to answer — and nothing left
 * that reads `author_association` at all, since the comment door was the only branch that ever did.
 */
describe("spec.yml is a reusable workflow, triggered by spec-caller.yml's own trigger (#315)", () => {
  it("carries only workflow_call", () => {
    expect(workflow.on).toHaveProperty("workflow_call");
  });
});

describe("spec.yml drops the comment-triggered re-run (#263)", () => {
  it("declares no issue_comment trigger", () => {
    expect(caller.on).not.toHaveProperty("issue_comment");
  });

  it("carries no issue_comment branch in the job condition", () => {
    expect(condition).not.toContain("issue_comment");
    expect(condition).not.toContain("github.event.comment");
    expect(condition).not.toContain("author_association");
  });
});

/**
 * The accept's own dispatch, restored. #263 deleted this listener and left `accept.ts` still
 * sending `sheet-accepted`, so every approve fired a dispatch into nothing and the idea stopped —
 * the failure #143 sat in. These two ends are asserted together *here*, against the live YAML and
 * the live constant, because the only thing that went wrong last time was the two halves being
 * edited apart.
 */
describe("spec.yml listens for the accept's own dispatch", () => {
  it("declares the repository_dispatch trigger", () => {
    expect(caller.on).toHaveProperty("repository_dispatch");
  });

  it("listens for exactly the event type accept.ts sends", () => {
    const dispatch = caller.on.repository_dispatch as { types: string[] };
    expect(dispatch.types).toContain(SPEC_AUTHOR_DISPATCH_EVENT_TYPE);
  });

  it("carries a repository_dispatch branch in the job condition", () => {
    expect(condition).toContain("github.event_name == 'repository_dispatch'");
  });

  it("takes the issue number from the payload, since a dispatch carries no issue", () => {
    const jobEnv = (workflow.jobs.spec as unknown as { env: Record<string, string> }).env;
    expect(jobEnv.ISSUE_NUMBER).toContain("github.event.client_payload.issue");
  });
});

/**
 * The step that was a `run: echo` until #145's seam audit. Every other part of lane 02 — author,
 * critic, gate, dispatch — was built and tested; nothing ran them, so a `PRD:` issue payload was
 * assembled on a runner and discarded.
 */
describe("spec.yml runs the lane rather than announcing it", () => {
  const { workflow: full } = readWorkflow<{
    jobs: { spec: { steps: Array<{ name: string; run?: string; env?: Record<string, string> }> } };
  }>("spec.yml");
  const steps = full.jobs.spec.steps;

  it("invokes spec.ts", () => {
    const runs = steps.map((step) => step.run ?? "").join("\n");
    expect(runs).toContain("spec.ts");
  });

  it("names no step as unwired", () => {
    for (const step of steps) {
      expect(step.name).not.toMatch(/not yet wired|proof of life/i);
    }
  });

  it("passes the trigger and the issue number the CLI reads", () => {
    const jobEnv = (full.jobs.spec as unknown as { env: Record<string, string> }).env;
    expect(jobEnv.SPEC_TRIGGER).toBeDefined();
    expect(jobEnv.ISSUE_NUMBER).toContain("github.event.issue.number");
  });

  it("tells the two labeled branches apart by label, since they share an event name", () => {
    // `invocationFromEnv` reads `SPEC_TRIGGER` rather than re-deriving the trigger from the raw
    // event, so this expression is the *only* thing that knows a `prd` label is the critic-only
    // door and a `to-spec` label is the cold one. An `event_name` test alone would send both to
    // whichever arm it named.
    const jobEnv = (full.jobs.spec as unknown as { env: Record<string, string> }).env;
    expect(jobEnv.SPEC_TRIGGER).toContain("'critique'");
    expect(jobEnv.SPEC_TRIGGER).toContain("'to-spec'");
    expect(jobEnv.SPEC_TRIGGER).toContain("github.event.label.name == 'prd'");
  });
});
