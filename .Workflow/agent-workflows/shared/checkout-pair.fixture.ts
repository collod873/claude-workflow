import { expect } from "vitest";
import { readWorkflow } from "./read-workflow";

/**
 * The one assertion every reusable lane's own test was writing out for itself: that the workflow
 * checks the **machine** out at the workspace root and the **calling repository's own tree** at
 * `target/`, and tells its entrypoint which is which through `TARGET_WORKSPACE`.
 *
 * It is one shape because it is one rule (ADR-0055): a caller repository never carries a copy of
 * the machine, so the checkout holding a lane's code and the checkout holding the repository that
 * lane is acting on can never be the same one. Four lanes shipped as a single plain checkout —
 * which in a called workflow is the *caller's* repository — and read correctly only because this
 * repository happens to be both; any other caller would have died on a `.Workflow/` that is not
 * there. Written once so the next lane converted asserts the same thing rather than an
 * approximation of it, and so a change to the rule lands in one place.
 */
export interface CheckoutPair {
  /** The workflow file, relative to `.github/workflows/` — e.g. `"review.yml"`. */
  workflow: string;
  /** The job inside it that carries the pair. */
  job: string;
  /** A substring of the `run:` of the step that must name `TARGET_WORKSPACE` in its `env:`. */
  runs: string;
  /**
   * How many `Checkout target` steps to expect. More than one when a lane takes different paths
   * into the target — `fixer.yml` checks out the pull request's branch to fix, or trunk to
   * escalate, and only one of the two ever runs.
   */
  targets?: number;
  /** The `fetch-depth` the first target checkout must carry, for a lane that reads history. */
  fetchDepth?: number;
}

interface CheckoutStep {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: { path?: string; repository?: string; token?: string; "fetch-depth"?: number };
}

/** Asserts `pair`'s workflow separates the machine it runs from the target it acts on. */
export function expectMachineAndTargetCheckouts(pair: CheckoutPair): void {
  const { workflow } = readWorkflow<{ jobs: Record<string, { steps?: CheckoutStep[] }> }>(pair.workflow);
  const steps = workflow.jobs[pair.job]?.steps ?? [];

  const machine = steps.find((step) => step.name === "Checkout machine");
  expect(machine?.with?.repository).toBe("collod873/claude-workflow");
  // No credential on the machine checkout (ADR-0132): this repository is public, so a caller reads
  // it anonymously rather than holding a PAT that would have to be rotated everywhere.
  expect(machine?.with?.token).toBeUndefined();

  const targets = steps.filter((step) => step.name?.startsWith("Checkout target"));
  expect(targets.length).toBe(pair.targets ?? 1);
  for (const target of targets) expect(target.with?.path).toBe("target");
  if (pair.fetchDepth !== undefined) expect(targets[0]?.with?.["fetch-depth"]).toBe(pair.fetchDepth);

  const run = steps.find((step) => step.run?.includes(pair.runs));
  expect(run?.env?.TARGET_WORKSPACE).toBe("${{ github.workspace }}/target");
}
