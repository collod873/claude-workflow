import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, scratch, script, workflowSteps } from "./scenarios.ts";

const CHECK = ".github/workflows/core-check.yml";
const SAME_REPO = "same-repo";
const HOME = "collod873/claude-workflow";

function steps() {
  return workflowSteps(CHECK);
}

function gating(head: string): { said: string; status: number | null } {
  const dir = scratch("same-repo-");
  const file = join(dir, SAME_REPO);
  script(file, steps().find((step) => step.id === SAME_REPO)?.run ?? "exit 0\n");
  const { status, stdout, stderr } = execute(file, dir, { HEAD_REPO: head, BASE_REPO: HOME });
  return { said: stdout + stderr, status };
}

describe("the stable check refuses a fork before any of its code runs beside the App key", () => {
  it("gates first, ahead of the checkout that brings the PR's code in", () => {
    expect(steps()[0]?.id).toBe(SAME_REPO);
  });

  it("passes a PR from the repo itself", () => {
    expect(gating(HOME).status).toBe(0);
  });

  it("fails a PR from a fork and names it", () => {
    const { said, status } = gating("stranger/claude-workflow");

    expect(status).toBe(1);
    expect(said.trim()).toBe(`core-check: stranger/claude-workflow is not ${HOME}, and a fork never runs with the App key`);
  });

  it("fails a PR whose fork was deleted", () => {
    const { said, status } = gating("");

    expect(status).toBe(1);
    expect(said.trim()).toBe(`core-check: a deleted fork is not ${HOME}, and a fork never runs with the App key`);
  });
});
