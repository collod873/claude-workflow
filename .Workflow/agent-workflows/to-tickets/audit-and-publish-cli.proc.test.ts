import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stubClaudeCli } from "../shared/claude-cli.stub";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import { stubGhCli } from "./gh-cli.stub";

const TO_TICKETS_PATH = ".Workflow/agent-workflows/to-tickets/to-tickets.ts";

describe("to-tickets.ts --stage audit-and-publish (CLI)", () => {
  const slicedPlan = [slice({ title: "Root" })];
  const slicedCheckpoint = { stage: "slice", response: JSON.stringify({ slices: slicedPlan }) };

  it("publishes, exits 0, and prints the exact success line", () => {
    const dir = withHandoffDir();
    const auditedPlan = [{ ...slicedPlan[0], title: "Root, re-worded by audit" }];
    const { env } = stubClaudeCli(
      dir,
      { structured: { notes: "Granularity: fine as-is.", slices: auditedPlan } },
      slicedCheckpoint,
    );
    stubGhCli(dir, { issueNumber: 200 });

    const stdout = execFileSync(
      "npx",
      ["tsx", TO_TICKETS_PATH, "--stage", "audit-and-publish", "--issue", "13"],
      { env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );

    expect(stdout).toContain("audit-and-publish: published 1 sub-issue under #13");
  });

  it("writes a failure reason naming the stage and exits nonzero when the run produced no structured output", () => {
    const dir = withHandoffDir();
    const { env, handoffFile } = stubClaudeCli(
      dir,
      "the model just graded out loud, and never called the tool",
      slicedCheckpoint,
    );
    stubGhCli(dir, { issueNumber: 200 });

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "audit-and-publish", "--issue", "13"], {
        env,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(/^audit-and-publish: .*not valid JSON/);
  });

  it("exits nonzero rather than 0 when the audited plan schema-validates but the gh publish itself fails", () => {
    const dir = withHandoffDir();
    const { env, handoffFile } = stubClaudeCli(
      dir,
      { structured: { notes: "", slices: slicedPlan } },
      slicedCheckpoint,
    );
    stubGhCli(dir, { fails: "HTTP 422: Validation Failed" });

    let threw = false;
    try {
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "audit-and-publish", "--issue", "13"], {
        env,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      threw = true;
      const status = (err as { status?: number | null }).status;
      expect(status).not.toBe(0);
    }

    expect(threw).toBe(true);
    expect(readFileSync(handoffFile, "utf8")).toMatch(/^audit-and-publish: /);
  });
});
