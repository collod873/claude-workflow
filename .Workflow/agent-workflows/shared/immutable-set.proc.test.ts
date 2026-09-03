import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readWorkflow } from "./read-workflow";

/**
 * The Immutability job's own script, run as the bash it is. Its contract is an exit code and an
 * `::error::` line, so the honest test hands it the environment the job would and reads both
 * back — the shape `.claude/hooks/gauntlet.proc.test.ts` sets for a thing whose contract *is* its
 * exit code. The script is read out of `verify.yml`'s parsed YAML, so a reworded step fails here
 * rather than being tested as a stale copy.
 */

interface VerifyWorkflow {
  jobs: { immutability: { env: { IMMUTABLE_SET: string }; steps: Array<{ name: string; run?: string }> } };
}

const { workflow } = readWorkflow<VerifyWorkflow>("verify.yml");
const job = workflow.jobs.immutability;
const script = job.steps.find((step) => step.name === "Refuse a change to the immutable set")?.run;

function run(env: Record<string, string | undefined>): { status: number | null; output: string } {
  try {
    const output = execFileSync("bash", ["-c", script ?? ""], {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const err = error as { status: number | null; stdout?: string; stderr?: string };
    return { status: err.status, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("the Immutability job's own script", () => {
  it("exists as a step", () => {
    expect(script, "no step named 'Refuse a change to the immutable set'").toBeDefined();
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
  ])("refuses when CHANGED_FILES is %s", (_case, changed) => {
    const result = run({ IMMUTABLE_SET: job.env.IMMUTABLE_SET, CHANGED_FILES: changed });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/changed-files input is missing or empty/);
  });

  it("refuses when a changed file falls inside the immutable set", () => {
    const result = run({ IMMUTABLE_SET: job.env.IMMUTABLE_SET, CHANGED_FILES: "src/thing.ts,.github/workflows/verify.yml" });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/touches the immutable set/);
  });

  it("passes when every changed file falls outside the immutable set", () => {
    const result = run({ IMMUTABLE_SET: job.env.IMMUTABLE_SET, CHANGED_FILES: "src/thing.ts,README.md" });
    expect(result.status).toBe(0);
  });
});
