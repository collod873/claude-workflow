import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { VERIFY_DISPATCH_EVENT_TYPE } from "./verify-dispatch";
import { IMPLEMENTATION_PR_DISPATCH_ACTION, IMMUTABLE_SET, touchesImmutableSet } from "./immutable-set";
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

  it("gates on the dispatch action IMPLEMENTATION_PR_DISPATCH_ACTION names", () => {
    expect(immutabilityJob.if).toBe(`github.event.action == '${IMPLEMENTATION_PR_DISPATCH_ACTION}'`);
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

/**
 * The test whose absence let #145's seam drift. Every other test in this repo checks one side of
 * the ADR-0054 dispatch against the constant *that side* imports — which is exactly why two
 * constants holding two different strings both passed: `verify.yml` was tested against the
 * receiver's declaration and `implement.ts` against the sender's, and nothing asked whether a
 * dispatch this pipeline sends is one this pipeline receives.
 *
 * So this reads the wire name out of every workflow that gates on it and checks the set, rather
 * than checking any one of them. A fourth reader added without being listed here is the case it
 * cannot catch; a fourth reader that disagrees with the other three is the case it can.
 */
describe("every reader of ADR-0054's dispatch gates on the one action the sender emits", () => {
  interface GatedWorkflow {
    jobs: Record<string, { if?: string }>;
  }

  const readers: Array<{ file: string; job: string }> = [
    { file: "verify.yml", job: "immutability" },
    { file: "verify.yml", job: "restore-and-run-acceptance" },
    { file: "integrate.yml", job: "integrate" },
  ];

  it.each(readers)("$file's $job job gates on IMPLEMENTATION_PR_DISPATCH_ACTION", ({ file, job }) => {
    const { workflow } = readWorkflow<GatedWorkflow>(file);
    const condition = workflow.jobs[job]?.if;
    expect(condition, `no \`${job}:\` job with an \`if:\` in ${file}`).toBeDefined();
    expect(condition).toContain(`github.event.action == '${IMPLEMENTATION_PR_DISPATCH_ACTION}'`);
  });

  it("is the same string implement.ts sends, because implement.ts does not declare its own", () => {
    expect(VERIFY_DISPATCH_EVENT_TYPE).toBe(IMPLEMENTATION_PR_DISPATCH_ACTION);
  });

  it("no workflow gates on a stale spelling of it", () => {
    for (const file of ["verify.yml", "integrate.yml", "implement.yml"]) {
      expect(readWorkflow(file).source, `${file} still names the pre-#145 spelling`).not.toContain(
        "implementation-pr-opened",
      );
    }
  });
});

/**
 * ADR-0054: "`verify.yml` keeps its `push: main` trigger and loses `pull_request`." The trigger
 * outlived the ruling until #145's seam audit, and it was load-bearing — a `pull_request` run
 * executes the *pull request's* copy of this file, so an implementer that deleted the two
 * dispatch-gated jobs from its own branch still earned a green `verify` job from its own copy.
 *
 * `verify.yml` itself moved to `on: workflow_call` (ADR-0055/ADR-0132), which `pull_request` can
 * never reach at all — the ruling now holds by construction rather than by omission. What still
 * needs asserting is `verify-caller.yml`, the file that actually starts a run: it carries the
 * `push`/`repository_dispatch` pair this file used to, and still must never grow `pull_request`.
 */
describe("verify-caller.yml carries no pull_request trigger", () => {
  it("fires on push and repository_dispatch only", () => {
    const { workflow } = readWorkflow<{ on: Record<string, unknown> }>("verify-caller.yml");
    expect(Object.keys(workflow.on).sort()).toEqual(["push", "repository_dispatch"]);
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
