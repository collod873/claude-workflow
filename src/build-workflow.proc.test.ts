import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { scratch } from "./scenarios.ts";

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
  env: Record<string, string>;
  jobs: Record<string, Job>;
}

interface Outcome {
  outcome: string;
  conclusion: string;
}

function workflow(): { on: Workflow["on"]; job: Job } {
  const { on, jobs } = parse(readFileSync(WORKFLOW, "utf8")) as Workflow;
  const building = Object.values(jobs).filter(({ steps }) => steps.some((step) => /(^|\s|\/)bin\/start(\s|$)/.test(step.run ?? "")));
  expect(building).toHaveLength(1);
  return { on, job: building[0] };
}

function stageStep(job: Job, stage: Stage): Step {
  const step = job.steps.find((candidate) => new RegExp(`(^|\\s|/)bin/${stage}(\\s|$)`).test(candidate.run ?? ""));
  expect(step, `a step that runs bin/${stage}`).toBeDefined();
  return step as Step;
}

function holds(condition: string, labels: string[], outcomes: Record<string, Outcome>, failed: boolean): boolean {
  const source = condition
    .replace(/^\s*\$\{\{|\}\}\s*$/g, "")
    .replace(/github\.event\.action/g, "'opened'")
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

const parsed = () => parse(readFileSync(WORKFLOW, "utf8")) as Workflow;
const spendsModel = (step: Step) => step.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined;
const transcriptOf = (run: string) => (/(^|\s|\/)bin\/([\w-]+)/.exec(run.split("\n").slice(1).join("\n"))?.[2] ?? "fix");
const SAID = { type: "assistant", message: { content: [{ type: "text", text: "reading the brief" }] } };

describe("a build run is watched as it goes, read after it ends, and stopped at its cap (#835)", () => {
  it("every step that spends a model stops it before the step's own cap, which kills only the step's shell", () => {
    const steps = Object.values(parsed().jobs).flatMap(({ steps }) => steps.filter(spendsModel));

    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(Number(step.env?.STAGE_MINUTES)).toBeGreaterThan(0);
      expect(Number(step.env?.STAGE_MINUTES)).toBeLessThan(step["timeout-minutes"] ?? 0);
    }
  });

  it("every job hands its stages the owner's hooks, read with a token that can only read agent-hooks", () => {
    for (const { steps } of Object.values(parsed().jobs).filter(({ steps }) => steps.some(spendsModel))) {
      const minted = steps.findIndex((step) => step.with?.repositories === "agent-hooks");
      const handed = steps.findIndex((step) => /AGENT_HOOKS_SETTINGS=.*GITHUB_ENV/.test(step.run ?? ""));
      expect(steps[minted]?.with).toMatchObject({ owner: "collod873", "permission-contents": "read" });
      expect(minted).toBeGreaterThanOrEqual(0);
      expect(handed).toBeGreaterThan(minted);
      expect(handed).toBeLessThan(steps.findIndex(spendsModel));
    }
  });

  it("every job files its stages' captures into the knowledge base whatever ended it, with a write token minted only after the model is done", () => {
    for (const { steps } of Object.values(parsed().jobs).filter(({ steps }) => steps.some(spendsModel))) {
      const minted = steps.findIndex((step) => step.with?.repositories === "Knowledge-Base");
      const filed = steps.findIndex((step) => /Knowledge-Base\/raw/.test(step.run ?? ""));
      const lastModel = steps.length - 1 - [...steps].reverse().findIndex(spendsModel);
      expect(steps[minted]?.with).toMatchObject({ owner: "collod873", "permission-contents": "write" });
      expect(minted).toBeGreaterThan(lastModel);
      expect(filed).toBeGreaterThan(minted);
      expect(steps[minted].if).toBe("always()");
      expect(steps[filed].if).toBe("always()");
    }
  });

  it("every job keeps its machine logs as a run artifact, whatever ended it", () => {
    for (const { steps } of Object.values(parsed().jobs)) {
      const last = steps[steps.length - 1];
      expect(last.uses).toMatch(/^actions\/upload-artifact@/);
      expect(last.if).toBe("always()");
      expect(last.with).toMatchObject({ path: ".git/machine-logs", "include-hidden-files": true });
    }
  });

  it("every step that spends a model shows what its stage's model does in the log as it happens, and ends with the stage's own status", () => {
    const { env, jobs } = parsed();
    for (const step of Object.values(jobs).flatMap(({ steps }) => steps.filter(spendsModel))) {
      const run = (step.run ?? "").replaceAll("${{ github.event.issue.number }}", "9");
      const transcript = `.git/machine-logs/${transcriptOf(run)}-9.jsonl`;
      const cwd = scratch("feed-");
      mkdirSync(join(cwd, ".git", "machine-logs"), { recursive: true });
      const stage = [`printf '%s\\n' '${JSON.stringify(SAID)}' >>${transcript}`, "sleep 1.5", "exit 3"].join("\n");

      const watched = spawnSync("bash", ["-e", "-c", `${run.split("\n")[0]}\n${stage}`], { cwd, env: { ...process.env, FEED: env.FEED }, encoding: "utf8", timeout: 10000 });

      expect(watched.stdout).toContain("said: reading the brief");
      expect(watched.status).toBe(3);
    }
  });
});
