import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * `verify.yml`'s Gauntlet step must fail through two distinctly named steps rather than one,
 * because `bin/gauntlet push` exits 1 for a real finding and 2 for a gauntlet that could not run
 * at all (bin/gauntlet:20-23) — a distinction a single failing step throws away, leaving a reader
 * to open the log to tell "a check failed" from "the checks are broken" apart. This test reads the
 * workflow's own YAML rather than grepping for strings, so a reformatting that preserves meaning
 * does not fail it, and a reformatting that loses meaning does.
 */

const VERIFY_YML_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.github/workflows/verify.yml",
);

const workflow = parse(readFileSync(VERIFY_YML_PATH, "utf8")) as {
  jobs: { verify: { steps: Array<{ name: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown> }> } };
};

const steps = workflow.jobs.verify.steps;

/** The step that captures `bin/gauntlet push`'s exit code — named by whichever step's `if:` refers to it. */
function capturingStepId(): string | undefined {
  const gauntletStep = steps.find((step) => step.name === "Gauntlet");
  const match = gauntletStep?.if?.match(/steps\.([\w-]+)\.outputs\.exit_code/);
  return match?.[1];
}

describe("verify.yml's Gauntlet step, split by exit code", () => {
  it("has a step named Gauntlet conditioned on the captured exit code equalling 1", () => {
    const gauntletStep = steps.find((step) => step.name === "Gauntlet");
    expect(gauntletStep, "no step named Gauntlet").toBeDefined();

    const capturingId = capturingStepId();
    expect(capturingId, "Gauntlet step's if: does not reference a captured steps.<id>.outputs.exit_code").toBeDefined();

    expect(gauntletStep?.if).toBe(`steps.${capturingId}.outputs.exit_code == '1'`);
  });

  it("has a step named 'Gauntlet could not run' conditioned on the captured exit code equalling 2", () => {
    const capturingId = capturingStepId();
    const brokenStep = steps.find((step) => step.name === "Gauntlet could not run");

    expect(brokenStep, "no step named 'Gauntlet could not run'").toBeDefined();
    expect(brokenStep?.if).toBe(`steps.${capturingId}.outputs.exit_code == '2'`);
  });

  it("captures bin/gauntlet push's exit code under the id the two steps above condition on, without letting the step itself fail the job", () => {
    const capturingId = capturingStepId();
    const capturingStep = steps.find((step) => step.id === capturingId);

    expect(capturingStep, `no step with id ${capturingId}`).toBeDefined();
    expect(capturingStep?.run).toContain("bin/gauntlet push");
    expect(capturingStep?.run).toContain('echo "exit_code=$?" >> "$GITHUB_OUTPUT"');
    // Exit 0 must stay green: nothing conditions success on a captured exit code, and the
    // capturing step does not itself propagate bin/gauntlet's exit code as its own.
    expect(capturingStep?.run).toMatch(/set \+e/);
  });

  it("leaves the Lint workflow files (actionlint) step unchanged from before this slice", () => {
    const lintStep = steps.find((step) => step.name === "Lint workflow files");
    expect(lintStep).toBeDefined();
    expect(lintStep?.uses).toBe("docker://rhysd/actionlint:1.7.7");
    expect(lintStep?.with).toEqual({ args: "-color" });
  });
});
