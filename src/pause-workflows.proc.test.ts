import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { holds, labelledOutputs, labelledStep, starts, workflowJobs, type IssueEvent, type StepOutcome } from "./scenarios.ts";
import { HELD, MACHINE, PAUSED, STUCK, TICKET, WAITING } from "./spelled.ts";

const REPO = join(import.meta.dirname, "..");
const WATCHED = ["start", "fix"] as const;
const other = (held: string) => (held === PAUSED ? STUCK : PAUSED);

async function stepsRun(file: string, event: IssueEvent): Promise<string[]> {
  const job = workflowJobs(file).build;
  if (job === undefined) throw new Error(`no build job in ${file}`);
  const { labels, ...rest } = event;
  if (!holds(job.if ?? "true", rest)) return [];
  const { failed, outputs } = await labelledOutputs(labelledStep(file, "build"), REPO, event);
  expect(failed, `the labelled step of ${file}`).toBe(false);
  const given: Record<string, Record<string, string>> = { labelled: outputs, admit: { admitted: "true" } };
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

describe.each(["tickets.yml"])("%s builds nothing on a pause and builds the ticket again once nothing holds it (#1174, ADR-0012)", (file) => {
  const owner = (action: string, label: string, labels: string[] = []): IssueEvent => ({ action, label, labels: [TICKET, ...labels] });

  it("adding paused builds nothing, leaving a run already going to stand down before it lands", async () => {
    expect(await stepsRun(file, owner("labeled", PAUSED, [PAUSED]))).toEqual([]);
    expect(await starts(file, "build", owner("labeled", PAUSED, [PAUSED]))).toBe(false);
  });

  it("builds nothing and pauses nothing on any other label added, nor on paused added to a spec or a note", async () => {
    for (const label of [STUCK, WAITING, "ticket"]) expect(await stepsRun(file, owner("labeled", label, [label])), label).toEqual([]);
    for (const kind of ["spec", "note"]) expect(await stepsRun(file, owner("labeled", PAUSED, [kind, PAUSED])), kind).toEqual([]);
  });

  it.each(HELD)("taking %s off a ticket builds it, as taking waiting off does", async (held) => {
    expect(await stepsRun(file, owner("unlabeled", held))).toEqual(["start", "fix"]);
  });

  it.each(HELD)("taking %s off a ticket that still carries the other held label does nothing", async (held) => {
    expect(await stepsRun(file, owner("unlabeled", held, [other(held)]))).toEqual([]);
    expect(await starts(file, "build", owner("unlabeled", held, [other(held)]))).toBe(false);
  });

  it.each(HELD)("taking %s off a closed ticket resumes nothing", async (held) => {
    expect(await stepsRun(file, { ...owner("unlabeled", held), state: "closed" })).toEqual([]);
  });

  it("taking waiting off a paused ticket builds nothing, and the App taking paused off is never heard", async () => {
    expect(await stepsRun(file, owner("unlabeled", WAITING, [PAUSED]))).toEqual([]);
    expect(await stepsRun(file, { sender: MACHINE, action: "labeled", label: PAUSED, labels: [PAUSED] })).toEqual([]);
  });
});
