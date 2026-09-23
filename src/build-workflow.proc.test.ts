import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "build.yml");
const STAGES = ["start", "test-author", "build", "save"] as const;
type Stage = (typeof STAGES)[number];

interface Step {
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  "timeout-minutes"?: number;
  "continue-on-error"?: boolean;
}

interface Job {
  if?: string;
  env?: Record<string, unknown>;
  steps: Step[];
}

interface Workflow {
  on: { issues?: { types?: string[] } };
  jobs: Record<string, Job>;
}

interface Outcome {
  outcome: string;
  conclusion: string;
}

function workflow(): { on: Workflow["on"]; job: Job } {
  const { on, jobs } = parse(readFileSync(WORKFLOW, "utf8")) as Workflow;
  const all = Object.values(jobs);
  expect(all).toHaveLength(1);
  return { on, job: all[0] };
}

function stageStep(job: Job, stage: Stage): Step {
  const step = job.steps.find((candidate) => new RegExp(`(^|\\s|/)bin/${stage}(\\s|$)`).test(candidate.run ?? ""));
  expect(step, `a step that runs bin/${stage}`).toBeDefined();
  return step as Step;
}

function holds(condition: string, labels: string[], outcomes: Record<string, Outcome>, failed: boolean): boolean {
  const source = condition
    .replace(/^\s*\$\{\{|\}\}\s*$/g, "")
    .replace(/contains\(\s*github\.event\.issue\.labels\.\*\.name\s*,\s*('[^']*')\s*\)/g, "labels.includes($1)")
    .replace(/steps\.([\w-]+)\.(outcome|conclusion)/g, 'steps["$1"].$2');
  const evaluate = new Function("labels", "steps", "success", "failure", "always", "cancelled", `return Boolean(${source});`) as (
    ...scope: unknown[]
  ) => boolean;
  return evaluate(
    labels,
    outcomes,
    () => !failed,
    () => failed,
    () => true,
    () => false,
  );
}

function stagesRun(job: Job, failing: Stage | undefined): Stage[] {
  const outcomes: Record<string, Outcome> = {};
  for (const step of job.steps) if (step.id !== undefined) outcomes[step.id] = { outcome: "skipped", conclusion: "skipped" };
  const red = failing === undefined ? undefined : stageStep(job, failing);
  const ran: Step[] = [];
  let failed = false;
  for (const step of job.steps) {
    if (!holds(step.if ?? "success()", [], outcomes, failed)) continue;
    ran.push(step);
    const broke = step === red;
    const stops = broke && step["continue-on-error"] !== true;
    if (step.id !== undefined) outcomes[step.id] = { outcome: broke ? "failure" : "success", conclusion: stops ? "failure" : "success" };
    failed = failed || stops;
  }
  return STAGES.filter((stage) => ran.includes(stageStep(job, stage)));
}

describe("build.yml builds a ticket the moment it is filed (#826)", () => {
  it("an issue labelled note starts no build", () => {
    const { on, job } = workflow();
    const starts = (labels: string[]) => holds(job.if ?? "true", labels, {}, false);

    expect(on.issues?.types).toContain("opened");
    expect(starts([])).toBe(true);
    expect(starts(["ticket"])).toBe(true);
    expect(starts(["note"])).toBe(false);
    expect(starts(["ticket", "note"])).toBe(false);
  });

  it("the branch is saved when the build ends red and nothing runs after a start refusal", () => {
    const { job } = workflow();

    expect(stagesRun(job, "start")).toEqual(["start"]);
    expect(stagesRun(job, "test-author")).toEqual(["start", "test-author", "save"]);
    expect(stagesRun(job, "build")).toEqual(["start", "test-author", "build", "save"]);
    expect(stagesRun(job, undefined)).toEqual(["start", "test-author", "build", "save"]);
    const at = STAGES.map((stage) => job.steps.indexOf(stageStep(job, stage)));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("every stage has its own time cap and the run acts as the App", () => {
    const { job } = workflow();
    const minting = job.steps.find((step) => step.uses?.startsWith("actions/create-github-app-token@") === true);

    expect(minting?.id, "an App token step with an id").toBeDefined();
    expect(JSON.stringify(minting?.with)).toContain("CORE_APP_CLIENT_ID");
    expect(JSON.stringify(minting?.with)).toContain("CORE_APP_PRIVATE_KEY");
    const token = new RegExp(`steps\\.${minting?.id}\\.outputs\\.token`);

    for (const stage of STAGES) {
      const step = stageStep(job, stage);
      expect(job.steps.indexOf(minting as Step)).toBeLessThan(job.steps.indexOf(step));
      expect(step["timeout-minutes"], `${stage} time cap`).toBeGreaterThan(0);
      expect(String({ ...job.env, ...step.env }.GH_TOKEN), `${stage} token`).toMatch(token);
    }
    for (const checkout of job.steps.filter((step) => step.uses?.startsWith("actions/checkout@") === true)) {
      expect(String(checkout.with?.token)).toMatch(token);
    }
  });
});
