import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stubClaudeCli } from "../shared/claude-cli.stub";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import { stubGhCli } from "./gh-cli.stub";

const TO_TICKETS_PATH = ".Workflow/agent-workflows/to-tickets/to-tickets.ts";

/**
 * These exercise the real `--stage audit-and-publish` CLI end to end: a stub
 * `claude` executable standing in for the auditor model (as the seam-sweep
 * and slice CLI tests above already do), plus a stub `gh` executable
 * standing in for GitHub — the second subprocess seam this branch, alone
 * among the three stages, also shells out to. `audit-and-publish` reads a
 * sliced plan as its own `PLAN` input, exactly like `slice` reads a seam
 * manifest, so every test here seeds one at the handoff path via
 * `stubClaudeCli`'s `priorHandoff`.
 */
describe("to-tickets.ts --stage audit-and-publish (CLI)", () => {
  const slicedPlan = [slice({ title: "Root" })];

  it("publishes, exits 0, and prints the exact success line", () => {
    const dir = withHandoffDir();
    const auditedPlan = [{ ...slicedPlan[0], title: "Root, re-worded by audit" }];
    const { env } = stubClaudeCli(
      dir,
      `<output>${JSON.stringify(auditedPlan)}</output>`,
      JSON.stringify(slicedPlan),
    );
    stubGhCli(dir, { issueNumber: 200 });

    const stdout = execFileSync(
      "npx",
      ["tsx", TO_TICKETS_PATH, "--stage", "audit-and-publish", "--issue", "13"],
      { env, encoding: "utf8" },
    );

    expect(stdout).toContain("audit-and-publish: published 1 sub-issue under #13");
  });

  it("writes a failure reason naming the stage and exits nonzero when the auditor's response has no <output> block", () => {
    const dir = withHandoffDir();
    const { env, handoffFile } = stubClaudeCli(
      dir,
      "no output block here, just prose",
      JSON.stringify(slicedPlan),
    );
    stubGhCli(dir, { issueNumber: 200 });

    expect(() =>
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "audit-and-publish", "--issue", "13"], {
        env,
        encoding: "utf8",
      }),
    ).toThrow();

    expect(readFileSync(handoffFile, "utf8")).toMatch(/^audit-and-publish: .*no <output> block/);
  });

  it("exits nonzero rather than 0 when the audited plan schema-validates but the gh publish itself fails", () => {
    const dir = withHandoffDir();
    const { env, handoffFile } = stubClaudeCli(
      dir,
      `<output>${JSON.stringify(slicedPlan)}</output>`,
      JSON.stringify(slicedPlan),
    );
    stubGhCli(dir, { fails: "HTTP 422: Validation Failed" });

    let threw = false;
    try {
      execFileSync("npx", ["tsx", TO_TICKETS_PATH, "--stage", "audit-and-publish", "--issue", "13"], {
        env,
        encoding: "utf8",
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
