import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { IMMUTABILITY_DISPATCH_ACTION, IMMUTABLE_SET, touchesImmutableSet } from "./immutable-set";
import { readWorkflow } from "./read-workflow";

describe("touchesImmutableSet", () => {
  it("flags a path under tests/acceptance/", () => {
    expect(touchesImmutableSet(["tests/acceptance/lane-04.test.ts"])).toBe(true);
  });

  it("flags vitest.config.ts itself", () => {
    expect(touchesImmutableSet(["vitest.config.ts"])).toBe(true);
  });

  it("flags a path under .github/", () => {
    expect(touchesImmutableSet([".github/workflows/verify.yml"])).toBe(true);
  });

  it("does not flag a path outside all three entries", () => {
    expect(touchesImmutableSet([".Workflow/agent-workflows/shared/immutable-set.ts"])).toBe(false);
  });

  it("flags the set when only one of several paths is inside it", () => {
    expect(touchesImmutableSet(["src/thing.ts", "vitest.config.ts", "README.md"])).toBe(true);
  });

  it("does not flag an empty change list", () => {
    expect(touchesImmutableSet([])).toBe(false);
  });
});

interface ImmutabilityJob {
  name: string;
  if: string;
  "continue-on-error"?: boolean;
  env: { IMMUTABLE_SET: string; CHANGED_FILES: string };
  steps: Array<{ name: string; run?: string; "continue-on-error"?: boolean }>;
}

interface VerifyWorkflow {
  jobs: {
    immutability: ImmutabilityJob;
    verify: { needs: string[]; if: string };
  };
}

const { workflow } = readWorkflow<VerifyWorkflow>("verify.yml");
const immutabilityJob = workflow.jobs.immutability;

describe("verify.yml's Immutability job agrees with shared/immutable-set.ts", () => {
  it("declares the same path list as IMMUTABLE_SET, in the same order", () => {
    const declared = immutabilityJob.env.IMMUTABLE_SET.split(",");
    expect(declared).toEqual([...IMMUTABLE_SET]);
  });

  it("gates on the dispatch action IMMUTABILITY_DISPATCH_ACTION names", () => {
    expect(immutabilityJob.if).toBe(`github.event.action == '${IMMUTABILITY_DISPATCH_ACTION}'`);
  });

  it("runs before the gauntlet job via needs:, which does not itself skip on a skipped dependency", () => {
    expect(workflow.jobs.verify.needs).toEqual(["immutability"]);
    expect(workflow.jobs.verify.if).toContain("needs.immutability.result != 'failure'");
  });

  it("has no continue-on-error, at the job or the step", () => {
    expect(immutabilityJob["continue-on-error"]).toBeUndefined();
    for (const step of immutabilityJob.steps) {
      expect(step["continue-on-error"]).toBeUndefined();
    }
  });
});

describe("the Immutability job's own script", () => {
  const script = immutabilityJob.steps.find((step) => step.name === "Refuse a change to the immutable set")?.run;

  function run(env: Record<string, string | undefined>): { status: number | null; output: string } {
    try {
      const output = execFileSync("bash", ["-c", script ?? ""], {
        env: { PATH: process.env.PATH, ...env },
        encoding: "utf8",
      });
      return { status: 0, output };
    } catch (error) {
      const err = error as { status: number | null; stdout?: string; stderr?: string };
      return { status: err.status, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  it("exists as a step", () => {
    expect(script, "no step named 'Refuse a change to the immutable set'").toBeDefined();
  });

  it("refuses when CHANGED_FILES is absent", () => {
    const result = run({ IMMUTABLE_SET: immutabilityJob.env.IMMUTABLE_SET });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/changed-files input is missing or empty/);
  });

  it("refuses when CHANGED_FILES is empty", () => {
    const result = run({ IMMUTABLE_SET: immutabilityJob.env.IMMUTABLE_SET, CHANGED_FILES: "" });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/changed-files input is missing or empty/);
  });

  it("refuses when a changed file falls inside the immutable set", () => {
    const result = run({
      IMMUTABLE_SET: immutabilityJob.env.IMMUTABLE_SET,
      CHANGED_FILES: "src/thing.ts,.github/workflows/verify.yml",
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/touches the immutable set/);
  });

  it("passes when every changed file falls outside the immutable set", () => {
    const result = run({
      IMMUTABLE_SET: immutabilityJob.env.IMMUTABLE_SET,
      CHANGED_FILES: "src/thing.ts,README.md",
    });
    expect(result.status).toBe(0);
  });
});

describe("the Immutability job references no secret beyond the default token", () => {
  it("the immutability job's YAML block mentions no secrets.* at all", () => {
    const { source } = readWorkflow("verify.yml");
    const jobStart = source.indexOf("\n  immutability:");
    expect(jobStart, "no `immutability:` job found in verify.yml").not.toBe(-1);
    const jobEnd = source.indexOf("\n  verify:", jobStart);
    const jobBlock = source.slice(jobStart, jobEnd === -1 ? undefined : jobEnd);
    expect(jobBlock).not.toMatch(/secrets\.[A-Za-z0-9_]+/);
  });
});
