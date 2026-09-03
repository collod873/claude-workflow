import { expect } from "vitest";
import { readWorkflow } from "./read-workflow";

export interface CheckoutPair {
  workflow: string;
  job: string;
  runs?: string;
  targets?: number;
  fetchDepth?: number;
}

interface CheckoutStep {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: { path?: string; repository?: string; token?: string; "fetch-depth"?: number };
}

export function expectMachineAndTargetCheckouts(pair: CheckoutPair): void {
  const { workflow } = readWorkflow<{ jobs: Record<string, { steps?: CheckoutStep[] }> }>(pair.workflow);
  const steps = workflow.jobs[pair.job]?.steps ?? [];

  const machine = steps.find((step) => step.name === "Checkout machine");
  expect(machine?.with?.repository).toBe("collod873/claude-workflow");
  expect(machine?.with?.token).toBeUndefined();

  const targets = steps.filter((step) => step.name?.startsWith("Checkout target"));
  expect(targets.length).toBe(pair.targets ?? 1);
  for (const target of targets) expect(target.with?.path).toBe("target");
  if (pair.fetchDepth !== undefined) expect(targets[0]?.with?.["fetch-depth"]).toBe(pair.fetchDepth);

  if (pair.runs === undefined) return;
  const run = steps.find((step) => step.run?.includes(pair.runs as string));
  expect(run, `no step in ${pair.workflow}#${pair.job} runs ${pair.runs}`).toBeDefined();
  expect(run?.env?.TARGET_WORKSPACE).toBe("${{ github.workspace }}/target");
}
