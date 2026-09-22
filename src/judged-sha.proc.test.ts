import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, git, scratch, script, workflowSteps } from "./scenarios.ts";

const CHECK = ".github/workflows/core-check.yml";
const JUDGED = "judged-sha";
const ELSEWHERE = "0".repeat(40);

function steps() {
  return workflowSteps(CHECK);
}

function judging(headOf: (judged: string) => string): { judged: string; said: string; status: number | null } {
  const repo = scratch("judged-sha-");
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "config", "user.email", "judged@test");
  git(repo, "config", "user.name", "judged");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "the PR head");
  const judged = git(repo, "rev-parse", "HEAD");
  const file = join(repo, JUDGED);
  script(file, steps().find((step) => step.id === JUDGED)?.run ?? "exit 0\n");
  const { status, stdout, stderr } = execute(file, repo, { HEAD_SHA: headOf(judged) });
  return { judged, said: stdout + stderr, status };
}

describe("the stable check records the SHA it judged and fails when that is not the PR head (#711)", () => {
  it("checks out the PR head with the base its test count is measured against", () => {
    const checkout = steps().find((step) => step.uses?.startsWith("actions/checkout@"));

    expect(checkout?.with).toMatchObject({ ref: "${{ github.event.pull_request.head.sha }}", "fetch-depth": 0 });
    expect(steps().find((step) => step.id === JUDGED)?.run).toContain("git rev-parse HEAD");
  });

  it("names the SHA it judged when that is the PR head", () => {
    const { judged, said, status } = judging((head) => head);

    expect(status).toBe(0);
    expect(said.trim()).toBe(`core-check: judging ${judged}`);
  });

  it("fails and names both when it judged anything else", () => {
    const { judged, said, status } = judging(() => ELSEWHERE);

    expect(status).toBe(1);
    expect(said.trim()).toBe(`core-check: judged ${judged}, not the PR head ${ELSEWHERE}`);
  });
});
