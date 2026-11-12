import { describe, expect, it } from "vitest";
import { gateOf, holds, skippedAll, starts, wakeOutputs, workflowJobs, type IssueEvent } from "./scenarios.ts";
import { HELD, MACHINE, PAUSED, STUCK, TICKET, WAITING } from "./spelled.ts";

const WATCHED = ["start", "fix"] as const;
const other = (held: string) => (held === PAUSED ? STUCK : PAUSED);

function stepsRun(file: string, event: IssueEvent): string[] {
  const jobs = workflowJobs(file);
  const job = jobs.build;
  if (job === undefined) throw new Error(`no build job in ${file}`);
  const gate = gateOf(file, "build");
  const { labels, ...rest } = event;
  if (!holds(jobs[gate]?.if ?? "true", rest)) return [];
  if (!holds(job.if ?? "success()", { ...rest, needs: { [gate]: { result: "success", outputs: wakeOutputs(event) } } })) return [];
  const given: Record<string, Record<string, string>> = { admit: { admitted: "true" } };
  const steps = skippedAll(job.steps);
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

  it("adding paused builds nothing, leaving a run already going to stand down before it lands", () => {
    expect(stepsRun(file, owner("labeled", PAUSED, [PAUSED]))).toEqual([]);
    expect(starts(file, "build", owner("labeled", PAUSED, [PAUSED]))).toBe(false);
  });

  it("builds nothing and pauses nothing on any other label added, nor on paused added to a spec or a note", () => {
    for (const label of [STUCK, WAITING, "bug"]) expect(stepsRun(file, owner("labeled", label, [label])), label).toEqual([]);
    for (const kind of ["spec", "note"]) expect(stepsRun(file, owner("labeled", PAUSED, [kind, PAUSED])), kind).toEqual([]);
  });

  it.each(HELD)("taking %s off a ticket builds it, as taking waiting off does", (held) => {
    expect(stepsRun(file, owner("unlabeled", held))).toEqual(["start", "fix"]);
  });

  it.each(HELD)("taking %s off a ticket that still carries the other held label does nothing", (held) => {
    expect(stepsRun(file, owner("unlabeled", held, [other(held)]))).toEqual([]);
    expect(starts(file, "build", owner("unlabeled", held, [other(held)]))).toBe(false);
  });

  it.each(HELD)("taking %s off a closed ticket resumes nothing", (held) => {
    expect(stepsRun(file, { ...owner("unlabeled", held), state: "closed" })).toEqual([]);
  });

  it("taking waiting off a paused ticket builds nothing, and the App taking paused off is never heard", () => {
    expect(stepsRun(file, owner("unlabeled", WAITING, [PAUSED]))).toEqual([]);
    expect(stepsRun(file, { sender: MACHINE, action: "labeled", label: PAUSED, labels: [PAUSED] })).toEqual([]);
  });
});
