import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { HANDED_OFF_PR, handingOff, holds, type StepOutcome } from "./scenarios.ts";
import { STOPS, type Stop } from "./stops.ts";

const RED_ON_MAIN = "Red on main after merge";
const FIXER_CLEARS: Stop[] = ["shape", "stale", "unread", "overCap", "noTest", "modelRun", "uncommitted", "buildRed", "drift", "unrecorded"];
const LEFT_ALONE: Stop[] = ["alreadyPasses", "unfreshTree", "dirtyTree", "fixerEnds"];

interface Step {
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, unknown>;
  "timeout-minutes"?: number;
  with?: Record<string, unknown>;
}

interface Job {
  if?: string;
  steps: Step[];
}

interface Workflow {
  on: { issues?: { types?: string[] } };
  jobs: Record<string, Job>;
}

const workflow = (name: string): Workflow => parse(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", `${name}.yml`), "utf8")) as Workflow;
const runs = (step: Step, command: string) => new RegExp(`(^|\\s|/)${command}(\\s|$)`).test(step.run ?? "");
const handsOff = (step: Step) => (step.run ?? "").includes("hand-off");

function jobRunning(name: string, command: string): Job {
  const job = Object.values(workflow(name).jobs).find(({ steps }) => steps.some((step) => runs(step, command)));
  expect(job, `a job in ${name}.yml that runs ${command}`).toBeDefined();
  return job as Job;
}

function handingStep(job: Job, after: string): Step {
  const at = job.steps.findIndex((step) => runs(step, after));
  const step = job.steps.slice(at + 1).find(handsOff);
  expect(step, `a hand-off step after ${after}`).toBeDefined();
  return step as Step;
}

function actsAsTheApp(job: Job, step: Step): void {
  const minted = job.steps.find((candidate) => candidate.uses?.startsWith("actions/create-github-app-token@") === true);
  const token = new RegExp(`steps\\.${minted?.id}\\.outputs\\.token`);

  expect(minted?.id, "an App token step with an id").toBeDefined();
  expect(String(step.env?.GH_TOKEN)).toMatch(token);
  for (const checkout of job.steps.filter((candidate) => candidate.uses?.startsWith("actions/checkout@") === true)) expect(String(checkout.with?.token)).toMatch(token);
}

function spendsWithinACap(step: Step): void {
  expect(step["timeout-minutes"]).toBeGreaterThan(0);
  expect(Object.keys(step.env ?? {})).toEqual(expect.arrayContaining(["GH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]));
}

function stepsThatRun(job: Job, failing: Step | undefined, checked = "success"): Step[] {
  const outcomes: Record<string, StepOutcome> = {};
  for (const step of job.steps) if (step.id !== undefined) outcomes[step.id] = { outcome: "skipped", conclusion: "skipped" };
  const ran: Step[] = [];
  let failed = false;
  for (const step of job.steps) {
    if (!holds(step.if ?? "success()", { steps: outcomes, needs: { check: { result: checked } }, failed })) continue;
    ran.push(step);
    const broke = step === failing;
    if (step.id !== undefined) outcomes[step.id] = { outcome: broke ? "failure" : "success", conclusion: broke ? "failure" : "success" };
    failed = failed || broke;
  }
  return ran;
}

const clearedBy =(stop: Stop, clearer: string) => (page: string) =>
  page
    .split("\n")
    .map((line) => (line.startsWith(`| ${STOPS[stop]} |`) ? `${line.slice(0, line.lastIndexOf("|", line.length - 2))}| ${clearer} |` : line))
    .join("\n");

describe("hand-off passes a stuck ticket to the fixer (#827)", () => {
  it("a run stopped at a row the fixer clears hands its ticket to the fixer, once", () => {
    for (const stop of FIXER_CLEARS) {
      const { run, fixed } = handingOff({ stoppedAt: STOPS[stop] });

      expect(run().status, stop).toBe(0);
      expect(fixed(), stop).toEqual(["811"]);
    }
  });

  it("a run stopped at any other row does not hand its ticket to the fixer", () => {
    for (const stop of LEFT_ALONE) {
      const { run, fixed } = handingOff({ stoppedAt: STOPS[stop] });

      expect(run().status, stop).toBe(0);
      expect(fixed(), stop).toEqual([]);
    }
  });

  it("reads the clearer from the Runs table, so its row decides whether a run hands its ticket to the fixer", () => {
    const given = handingOff({ stoppedAt: STOPS.buildRed, table: clearedBy("buildRed", "Nobody needed") });
    const taken = handingOff({ stoppedAt: STOPS.dirtyTree, table: clearedBy("dirtyTree", "The fixer") });

    expect(given.run().status).toBe(0);
    expect(given.fixed()).toEqual([]);
    expect(taken.run().status).toBe(0);
    expect(taken.fixed()).toEqual(["811"]);
  });

  it("build.yml hands its ticket to the fixer after a red stage, once the branch is saved", () => {
    const job = jobRunning("build", "bin/save");
    const step = handingStep(job, "bin/save");

    expect(step.if).toContain("failure()");
    expect(step.run).toContain("github.event.issue.number");
    spendsWithinACap(step);
  });

  it("pushes the fixer's work once it commits, and saves nothing when it wrote nothing", () => {
    const committed = handingOff({ stoppedAt: STOPS.buildRed, commits: true });
    const untouched = handingOff({ stoppedAt: STOPS.buildRed });

    expect(committed.run().status).toBe(0);
    expect(committed.saved()).toEqual(["811"]);
    expect(untouched.run().status).toBe(0);
    expect(untouched.saved()).toEqual([]);
  });
});

describe("hand-off labels the ticket with where its red run went (#835)", () => {
  it("labels a ticket fixing while the fixer works, then back to checking once the fix is pushed", () => {
    const committed = handingOff({ stoppedAt: STOPS.buildRed, commits: true });
    const untouched = handingOff({ stoppedAt: STOPS.buildRed });

    committed.run();
    untouched.run();

    expect(committed.marked()).toEqual(["811 fixing", "811 3-checking"]);
    expect(untouched.marked()).toEqual(["811 fixing"]);
  });

  it("labels a ticket failed when no fixer is coming for it", () => {
    const { run, marked } = handingOff({ stoppedAt: STOPS.dirtyTree });

    run();

    expect(marked()).toEqual(["811 failed"]);
  });

  it("names the row it stopped at and links the ticket's open PR when it marks a ticket failed (#851)", () => {
    const { run, comments } = handingOff({ stoppedAt: STOPS.dirtyTree });

    run();

    const said = comments()[0];
    expect(said, "a comment on the ticket").toBeDefined();
    expect(said).toContain(STOPS.dirtyTree);
    expect(said).toContain(HANDED_OFF_PR);
  });
});

describe("a reviewer drift reaches the fixer (#827)", () => {
  it("a reviewer drift hands its ticket to the fixer", () => {
    const { run, fixed } = handingOff();

    expect(run(STOPS.drift).status).toBe(0);
    expect(fixed()).toEqual(["811"]);
  });

  it("the review job hands the ticket to the fixer when the reviewer ends red on drift", () => {
    const job = jobRunning("check", "bin/review");
    const step = handingStep(job, "bin/review");

    expect(step.if).toContain("failure()");
    expect(step.run).toContain(STOPS.drift);
    expect(step.run).toMatch(/head_ref|HEAD_REF|head\.ref/);
    spendsWithinACap(step);
  });

  it("the drift hand-off acts as the App, so the fixer's push lands and fires the checks", () => {
    const job = jobRunning("check", "bin/review");

    actsAsTheApp(job, handingStep(job, "bin/review"));
  });
});

describe("a ticket reopened for a red on main reaches the fixer (#827)", () => {
  it("a ticket reopened for a red on main is handed to the fixer", () => {
    const { run, fixed } = handingOff();

    expect(run(RED_ON_MAIN).status).toBe(0);
    expect(fixed()).toEqual(["811"]);
  });

  it("close.yml acts as the App, so the reopen for a red on main fires a workflow", () => {
    const job = jobRunning("close", "bin/close");
    const closing = job.steps.find((step) => runs(step, "bin/close")) as Step;
    const minted = job.steps.find((step) => step.uses?.startsWith("actions/create-github-app-token@") === true);
    const token = String(closing.env?.GH_TOKEN).match(/steps\.([\w-]+)\.outputs\.token/)?.[1];

    expect(minted?.id, "an App token step with an id").toBeDefined();
    expect(token).toBe(minted?.id);
    expect(job.steps.indexOf(minted as Step)).toBeLessThan(job.steps.indexOf(closing));
  });

  it("build.yml builds a ticket when it is opened or the owner reopens it, never when the App reopens it for a red on main", () => {
    const job = jobRunning("build", "bin/start");
    const start = job.steps.find((step) => runs(step, "bin/start")) as Step;
    const gate = `${job.if ?? ""} ${start.if ?? ""}`;

    expect(gate).toMatch(/github\.event\.action\s*==\s*'opened'/);
    expect(gate).toMatch(/github\.event\.action\s*==\s*'reopened'\s*&&\s*github\.event\.sender\.type\s*!=\s*'Bot'/);
  });

  it("build.yml hands a ticket reopened for a red on main to the fixer", () => {
    const { on, jobs } = workflow("build");
    const handing = Object.values(jobs).flatMap((job) => job.steps.filter((step) => handsOff(step) && (step.run ?? "").includes(RED_ON_MAIN)).map((step) => ({ job, step })));

    expect(on.issues?.types).toEqual(expect.arrayContaining(["opened", "reopened"]));
    expect(handing).toHaveLength(1);
    const { job, step } = handing[0];
    expect(`${job.if ?? ""} ${step.if ?? ""}`).toMatch(/github\.event\.action\s*==\s*'reopened'/);
    expect(step.run).toContain("github.event.issue.number");
    spendsWithinACap(step);
  });

  it("only the App's reopen hands a ticket to the fixer, on a ticket branch made fresh from main", () => {
    const { jobs } = workflow("build");
    const job = Object.values(jobs).find(({ steps }) => steps.some((step) => (step.run ?? "").includes(RED_ON_MAIN))) as Job;
    const handing = job.steps.find((step) => (step.run ?? "").includes(RED_ON_MAIN)) as Step;
    const branched = job.steps.findIndex((step) => /git checkout -B "?ticket\/\$\{\{ github\.event\.issue\.number \}\}/.test(step.run ?? ""));

    expect(job.if).toMatch(/github\.event\.sender\.type\s*==\s*'Bot'/);
    expect(job.steps.some((step) => String(step.with?.ref ?? "").startsWith("ticket/"))).toBe(false);
    expect(branched).toBeGreaterThan(-1);
    expect(branched).toBeLessThan(job.steps.indexOf(handing));
    actsAsTheApp(job, handing);
  });
});

describe("hand-off calls the fixer only for the reviewer's own failure (#849)", () => {
  it("a review job that fails before the reviewer runs calls no fixer and marks the ticket failed", () => {
    const job = jobRunning("check", "bin/review");
    const stage = job.steps.find((step) => step.uses === "./.github/actions/stage") as Step;
    const review = job.steps.find((step) => runs(step, "bin/review")) as Step;
    const handing = handingStep(job, "bin/review");
    const marksFailed = job.steps.find((step) => runs(step, "bin/mark") && (step.run ?? "").includes(" failed")) as Step;

    expect(stage, "a step that fetches the owner's hooks").toBeDefined();
    expect(marksFailed, "a step that marks the ticket failed").toBeDefined();

    const beforeReviewer = stepsThatRun(job, stage);
    expect(beforeReviewer).not.toContain(handing);
    expect(beforeReviewer).toContain(marksFailed);

    const afterReviewer = stepsThatRun(job, review);
    expect(afterReviewer).toContain(handing);
  });
});

describe("a red required check on a ticket PR reaches the fixer (#826, #827)", () => {
  it("the review job skips the reviewer and hands the ticket to the fixer, naming the row the fixer clears", () => {
    const job = jobRunning("check", "bin/review");
    const review = job.steps.find((step) => runs(step, "bin/review")) as Step;
    const handing = handingStep(job, "bin/review");
    const ran = stepsThatRun(job, undefined, "failure");

    expect(job.if).toMatch(/!cancelled\(\)|always\(\)|failure\(\)/);
    expect(ran).not.toContain(review);
    expect(ran).toContain(handing);
    expect(stepsThatRun(job, undefined, "success")).not.toContain(handing);
    expect(handing.run).toContain("Green on the ticket's checks, red on the PR's required check");
  });
});
