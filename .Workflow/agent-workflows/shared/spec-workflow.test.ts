import { describe, expect, it } from "vitest";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "../spec/publish";
import { readWorkflow } from "./read-workflow";

/**
 * `spec.yml`'s trigger must be the same two-sided, owner/`author_association` shape ADR-0073
 * gives `shape.yml` — a label event gated on `github.event.sender` being the repository owner, an
 * `issue_comment` event gated on `author_association`, with the bot exclusion and the
 * `!github.event.issue.pull_request` guard riding along. This reads the workflow's own YAML `if:`
 * rather than grepping the file for strings, so a reformatting that preserves meaning does not
 * fail it, and a reformatting that loses meaning does.
 */

const { workflow } = readWorkflow<{
  jobs: { spec: { if?: string } };
}>("spec.yml");

const condition = workflow.jobs.spec.if ?? "";

describe("spec.yml's trigger, the two-sided owner/author_association shape", () => {
  it("gates the label event on the sender being the repository owner", () => {
    expect(condition).toContain("github.event_name == 'issues'");
    expect(condition).toContain("github.event.label.name == 'to-spec'");
    expect(condition).toContain("github.event.sender.login == github.repository_owner");
  });

  it("gates the issue_comment event on author_association, excluding a bot and a pull request comment", () => {
    expect(condition).toContain("github.event_name == 'issue_comment'");
    expect(condition).toContain("!github.event.issue.pull_request");
    expect(condition).toContain("github.event.comment.user.type != 'Bot'");
    expect(condition).toMatch(
      /contains\(fromJSON\('\["OWNER", "MEMBER", "COLLABORATOR"\]'\),\s*\n?\s*github\.event\.comment\.author_association\)/,
    );
  });

  it("scopes the comment branch to an issue already carrying the prd label", () => {
    expect(condition).toContain("contains(github.event.issue.labels.*.name, 'prd')");
  });

  it("ORs the branches together, rather than ANDing them into an unfireable condition", () => {
    // Every branch is parenthesized and joined by `||` at the top level — never `&&`, which would
    // require two different `event_name`s on one event. Split on the top-level `) ||` so the test
    // asserts the shape rather than the order, and does not have to be rewritten the next time a
    // trigger is added the way ADR-0083's dispatch was.
    const branches = condition.split(") ||").map((branch) => branch.trim());
    expect(branches.length).toBeGreaterThanOrEqual(4);

    // Every branch names an event, and between them they cover all three this workflow listens
    // for. Deduplicated rather than listed one-per-branch: since ADR-0085 two branches are the
    // same `issues: labeled` event, told apart by which label arrived.
    const eventNames = branches.map(
      (branch) => branch.match(/github\.event_name == '(\w+)'/)?.[1],
    );
    expect(eventNames.filter(Boolean)).toHaveLength(branches.length);
    expect([...new Set(eventNames.filter(Boolean))].sort()).toEqual([
      "issue_comment",
      "issues",
      "repository_dispatch",
    ]);
  });
});

/**
 * ADR-0085's critic-only door: the owner's own hand putting `prd` on a spec he wrote in a live
 * session. `bin/file-issue spec` runs under his credentials, so the creation is a real event and
 * this is the one thing that was missing — four workflows already woke on it and all four skipped.
 */
describe("spec.yml's critic-only door fires on the owner's own prd label", () => {
  const prdBranch = condition
    .split(") ||")
    .find((branch) => branch.includes("github.event.label.name == 'prd'"));

  it("has a labeled branch on prd, distinct from the to-spec one", () => {
    expect(prdBranch).toBeDefined();
    expect(prdBranch).toContain("github.event_name == 'issues'");
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
 * ADR-0083: the accepted sheet reaches lane 02 by a `repository_dispatch` the accept sends, never
 * by the `approved` label the accept itself fires on — the sheet collector reads a marker that
 * accept writes, and a label-fired job would race it.
 */
describe("spec.yml's accepted-sheet trigger is ADR-0083's dispatch", () => {
  it("gates a repository_dispatch branch on the action the accept sends", () => {
    expect(condition).toContain(
      `github.event.action == '${SPEC_AUTHOR_DISPATCH_EVENT_TYPE}'`,
    );
  });

  it("never fires on the approved label, which would race the accept's own write", () => {
    expect(condition).not.toContain("approved");
  });

  it("carries no sender gate on the dispatch branch — the send needs write access, so it is the gate", () => {
    const dispatchBranch = condition
      .split(") ||")
      .find((branch) => branch.includes("repository_dispatch"));
    expect(dispatchBranch).toBeDefined();
    expect(dispatchBranch).not.toContain("sender.login");
    expect(dispatchBranch).not.toContain("author_association");
  });
});

/**
 * The step that was a `run: echo` until #145's seam audit. Every other part of lane 02 — author,
 * critic, gate, dispatch, rounds — was built and tested; nothing ran them, so a `PRD:` issue
 * payload was assembled on a runner and discarded.
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
    expect(jobEnv.ISSUE_NUMBER).toContain("client_payload.issue");
  });

  it("tells the two labeled branches apart by label, since they share an event name", () => {
    // `invocationFromEnv` reads `SPEC_TRIGGER` rather than re-deriving the trigger from the raw
    // event, so this expression is the *only* thing that knows a `prd` label is the critic-only
    // door and a `to-spec` label is the map collector. An `event_name` test alone would send both
    // to whichever arm it named.
    const jobEnv = (full.jobs.spec as unknown as { env: Record<string, string> }).env;
    expect(jobEnv.SPEC_TRIGGER).toContain("'sheet'");
    expect(jobEnv.SPEC_TRIGGER).toContain("'map'");
    expect(jobEnv.SPEC_TRIGGER).toContain("'critique'");
    expect(jobEnv.SPEC_TRIGGER).toContain("'answer'");
    expect(jobEnv.SPEC_TRIGGER).toContain("github.event.label.name == 'to-spec'");
    expect(jobEnv.SPEC_TRIGGER).toContain("github.event.label.name == 'prd'");
  });
});

/**
 * The re-run door is ADR-0062's "his answer" to a posted round, so it must not fire on a spec with
 * no round outstanding. Closing #145 fired two runs of this lane off its own closing record before
 * this narrowing existed.
 */
describe("spec.yml's re-run door only opens on a spec still holding questions", () => {
  const commentBranch = condition
    .split(") ||")
    .find((branch) => branch.includes("issue_comment"));

  it("has a comment branch", () => {
    expect(commentBranch).toBeDefined();
  });

  it("does not re-run a spec that has already dispatched", () => {
    expect(commentBranch).toContain("!contains(github.event.issue.labels.*.name, 'sliceable')");
  });

  it("does not re-run a closed spec", () => {
    expect(commentBranch).toContain("github.event.issue.state == 'open'");
  });
});
