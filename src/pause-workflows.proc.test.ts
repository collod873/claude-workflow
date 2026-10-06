import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { holds, labelledOutputs, labelledStep, starts, workflowJobs, type IssueEvent, type StepOutcome } from "./scenarios.ts";
import { HELD, MACHINE, PAUSED, STUCK, WAITING } from "./spelled.ts";

const REPO = join(import.meta.dirname, "..");
const WATCHED = ["pause", "resume", "start", "fix"] as const;
const other = (held: string) => (held === PAUSED ? STUCK : PAUSED);

async function stepsRun(file: string, event: IssueEvent, builds = ""): Promise<string[]> {
  const job = workflowJobs(file).build;
  if (job === undefined) throw new Error(`no build job in ${file}`);
  const { labels, ...rest } = event;
  if (!holds(job.if ?? "true", rest)) return [];
  const { failed, outputs } = await labelledOutputs(labelledStep(file, "build"), REPO, event);
  expect(failed, `the labelled step of ${file}`).toBe(false);
  const given: Record<string, Record<string, string>> = { labelled: outputs, admit: { admitted: "true" }, resume: builds === "" ? {} : { builds } };
  const steps: Record<string, StepOutcome> = Object.fromEntries(job.steps.flatMap(({ id }) => (id === undefined ? [] : [[id, { outcome: "skipped", conclusion: "skipped", outputs: {} }]])));
  const ran: string[] = [];
  for (const step of job.steps) {
    if (!holds(step.if ?? "success()", { ...rest, labels, steps })) continue;
    if (step.id === undefined) continue;
    ran.push(step.id);
    steps[step.id] = { outcome: "success", conclusion: "success", outputs: given[step.id] ?? {} };
  }
  return WATCHED.filter((id) => ran.includes(id));
}

describe.each(["build.yml", "tickets.yml"])("%s pauses a ticket's PR and resumes the ticket from where it stands (#1174)", (file) => {
  const owner = (action: string, label: string, labels: string[] = []): IssueEvent => ({ action, label, labels });

  it("hears the labelled event, and adding paused turns auto-merge off and builds nothing", async () => {
    const heard = file === "build.yml" ? join(REPO, ".github", "workflows", file) : join(REPO, ".github", "caller.yml");
    const { on } = parse(readFileSync(heard, "utf8")) as { on: { issues?: { types?: string[] } } };
    expect(on.issues?.types).toContain("labeled");

    expect(await stepsRun(file, owner("labeled", PAUSED, [PAUSED]))).toEqual(["pause"]);
    expect(await starts(file, "build", owner("labeled", PAUSED, [PAUSED]))).toBe(false);
  });

  it("builds nothing and pauses nothing on any other label added, nor on paused added to a spec or a note", async () => {
    for (const label of [STUCK, WAITING, "ticket"]) expect(await stepsRun(file, owner("labeled", label, [label])), label).toEqual([]);
    for (const kind of ["spec", "note"]) expect(await stepsRun(file, owner("labeled", PAUSED, [kind, PAUSED])), kind).toEqual([]);
  });

  it.each(HELD)("taking %s off a ticket with no PR builds it, as taking waiting off does", async (held) => {
    expect(await stepsRun(file, owner("unlabeled", held), "true")).toEqual(["resume", "start", "fix"]);
  });

  it.each(HELD)("taking %s off a ticket with a PR, red or green, leaves the resume to bin/resume and builds nothing new", async (held) => {
    const ran = await stepsRun(file, owner("unlabeled", held), "false");

    expect(ran).toEqual(["resume"]);
    const resume = workflowJobs(file).build?.steps.find(({ id }) => id === "resume");
    expect(resume?.run).toMatch(/bin\/resume"? \$\{\{ github\.event\.issue\.number \}\} >>"\$GITHUB_OUTPUT"/);
    expect(String(resume?.env?.GH_TOKEN)).toMatch(/steps\.app\.outputs\.token/);
  });

  it.each(HELD)("taking %s off a ticket that still carries the other held label does nothing", async (held) => {
    expect(await stepsRun(file, owner("unlabeled", held, [other(held)]), "true")).toEqual([]);
    expect(await starts(file, "build", owner("unlabeled", held, [other(held)]))).toBe(false);
  });

  it.each(HELD)("taking %s off a closed ticket resumes nothing", async (held) => {
    expect(await stepsRun(file, { ...owner("unlabeled", held), state: "closed" }, "true")).toEqual([]);
  });

  it("taking waiting off a paused ticket builds nothing, and the App taking paused off is never heard", async () => {
    expect(await stepsRun(file, owner("unlabeled", WAITING, [PAUSED]))).toEqual([]);
    expect(await stepsRun(file, { sender: MACHINE, action: "labeled", label: PAUSED, labels: [PAUSED] })).toEqual([]);
  });

  it("turns auto-merge off as the App, through bin/pause", () => {
    const pause = workflowJobs(file).build?.steps.find(({ id }) => id === "pause");

    expect(pause?.run).toMatch(/bin\/pause"? \$\{\{ github\.event\.issue\.number \}\}$/);
    expect(String(pause?.env?.GH_TOKEN)).toMatch(/steps\.app\.outputs\.token/);
  });
});
