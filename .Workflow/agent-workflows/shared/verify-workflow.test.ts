import { describe, expect, it } from "vitest";
import { IMMUTABILITY_DISPATCH_ACTION } from "./immutable-set";
import { readWorkflow } from "./read-workflow";

/**
 * `verify.yml`'s Gauntlet step must fail through two distinctly named steps rather than one,
 * because `bin/gauntlet push` exits 1 for a real finding and 2 for a gauntlet that could not run
 * at all (bin/gauntlet:20-23) — a distinction a single failing step throws away, leaving a reader
 * to open the log to tell "a check failed" from "the checks are broken" apart. This test reads the
 * workflow's own YAML rather than grepping for strings, so a reformatting that preserves meaning
 * does not fail it, and a reformatting that loses meaning does.
 */

const { workflow } = readWorkflow<{
  jobs: { verify: { steps: Array<{ name: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown> }> } };
}>("verify.yml");

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

/**
 * The "Restore and run acceptance" job (ADR-0032/ADR-0054): CI's verdict on an implementation pull
 * request is over trunk's copy of `tests/acceptance/`, never the pull request's own, and that is
 * only a guarantee if the restore itself runs before whatever reads the restored files back.
 */
const { workflow: verifyWorkflow } = readWorkflow<{
  jobs: {
    "restore-and-run-acceptance": {
      if?: string;
      needs?: string[];
      steps: Array<{ name: string; run?: string; env?: Record<string, unknown> }>;
    };
  };
}>("verify.yml");

const acceptanceJob = verifyWorkflow.jobs["restore-and-run-acceptance"];

describe("verify.yml's Restore and run acceptance job", () => {
  it("exists", () => {
    expect(acceptanceJob, "no job named restore-and-run-acceptance in verify.yml").toBeDefined();
  });

  it("runs the restore step before the test-run step, in that order", () => {
    const names = acceptanceJob.steps.map((step) => step.name);
    const restoreIndex = names.findIndex((name) => name === "Restore tests/acceptance from trunk's tip");
    const runIndex = names.findIndex((name) => name === "Run this slice's acceptance tests");

    expect(restoreIndex, "no step restoring tests/acceptance").toBeGreaterThanOrEqual(0);
    expect(runIndex, "no step running this slice's acceptance tests").toBeGreaterThanOrEqual(0);
    expect(restoreIndex).toBeLessThan(runIndex);
  });

  it("restores tests/acceptance/ from main's tip, not from the merge base or the PR's own copy", () => {
    const restoreStep = acceptanceJob.steps.find((step) => step.name === "Restore tests/acceptance from trunk's tip");
    expect(restoreStep?.run).toContain("git checkout main -- tests/acceptance/");
  });

  it("gates on the same repository_dispatch action as the Immutability job, never on pull_request", () => {
    expect(acceptanceJob.if).toContain(`github.event.action == '${IMMUTABILITY_DISPATCH_ACTION}'`);
    expect(acceptanceJob.if).not.toMatch(/pull_request/);
  });

  it("does not fire on push or pull_request at all — only the dispatch action equality admits it", () => {
    // A dispatch's `github.event.action` is the client payload's own field; neither a `push` nor a
    // `pull_request` event carries an action equal to this string, so the equality above is the
    // whole gate and no other clause in `if:` widens it.
    const conditionParts = (acceptanceJob.if ?? "").split("&&").map((part) => part.trim());
    expect(conditionParts).toContain(`github.event.action == '${IMMUTABILITY_DISPATCH_ACTION}'`);
  });
});
