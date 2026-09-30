import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { heard, holds, OWNER, wellFormedSpec, type WorkflowStep } from "./scenarios.ts";
import { closing } from "./closer.part.ts";
import { slicing } from "./slicer.part.ts";

const SPEC_ISSUE = { number: 968, state: "open", labels: [{ name: "spec" }], user: { login: OWNER }, body: "" };
const ticket = (number: number, state = "closed") => ({ number, state, labels: [] as { name: string }[], user: { login: "core-app[bot]" }, body: "## Why\n\n> the owner's words\n\n## Done when\n\n- It lands.\n" });
const followUp = (number: number, of: number, state = "open") => ({ ...ticket(number, state), body: `## Why\n\nFollow-up of #${of}: its review found this after its builder's repair, outside the earlier gaps and the fix's own lines.\n\n> a gap\n\n## Done when\n\n- It lands.\n` });
const NOTE = "## Wave 1\n\n> the owner's words\n\nSettled.\n\nFiles it.\n\nFiled: #1101, #1102.\n\n<!-- moves: 1, 3 -->\n";
const CHECKED = "## Wave check\n\n1. **Held**: see it\n";

function ended({ closed = 1102, tickets = [ticket(1101), ticket(1102)], spec = SPEC_ISSUE, open = [] as object[], said = [NOTE, CHECKED], extra = {} as Record<string, object> } = {}) {
  const issues: Record<string, object> = { "968": spec, "968/sub_issues": tickets, ...extra };
  for (const one of tickets) Object.assign(issues, { [String(one.number)]: one, [`${one.number}/parent`]: spec });
  const sliced = slicing({ issues, comments: { "968": said }, open });
  return { ...sliced, ran: sliced.run("--ended", String(closed)) };
}

describe("bin/slice --ended tells reslice.yml when a closed issue ends its spec's wave, and which sentences that wave should move (#1037)", () => {
  it("names the spec and the sentences the last `## Wave` note moves, once the spec's last open ticket closes", () => {
    const { ran, hired } = ended();

    expect(ran).toEqual({ status: 0, stdout: "spec=968\nmoves=1,3\n", stderr: "" });
    expect(hired()).toEqual([]);
  });

  it("names no spec while a ticket under it is still open", () => {
    const { ran } = ended({ tickets: [ticket(1101, "open"), ticket(1102)] });

    expect(ran).toEqual({ status: 0, stdout: "", stderr: "slice: #968's wave is not over, #1101 is still open\n" });
  });

  it("names no spec while a follow-up of one of its tickets is open, however deep", () => {
    const { ran } = ended({ open: [followUp(1201, 1101), followUp(1202, 1201)] });
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toBe("slice: #968's wave is not over, #1201 is still open\n");

    const deep = ended({ closed: 1201, extra: { "1201": followUp(1201, 1101, "closed") }, open: [followUp(1202, 1201)] });
    expect(deep.ran.stdout).toBe("");
  });

  it("finds the spec through a closed follow-up's ticket, since a follow-up is not filed under the spec", () => {
    const { ran } = ended({ closed: 1201, extra: { "1201": followUp(1201, 1101, "closed") }, open: [followUp(1300, 999)] });

    expect(ran).toEqual({ status: 0, stdout: "spec=968\nmoves=1,3\n", stderr: "" });
  });

  it("names the spec with no sentences to move when no `## Wave` note carries a marker", () => {
    const { ran } = ended({ said: [CHECKED] });

    expect(ran.stdout).toBe("spec=968\nmoves=\n");
  });

  it("names no spec for an issue under no spec, or under a spec that is closed", () => {
    const loose = ended({ closed: 1500, extra: { "1500": ticket(1500) } });
    expect(loose.ran).toEqual({ status: 0, stdout: "", stderr: "slice: #1500 is under no spec, so no wave ended\n" });

    const shut = ended({ spec: { ...SPEC_ISSUE, state: "closed" } });
    expect(shut.ran).toEqual({ status: 0, stdout: "", stderr: "slice: #1102 is under no open spec, so no wave ended\n" });
  });

  it("names no spec for a closed note or spec, even one filed under a spec, since the closer's dispatch passes no label filter (#1045)", () => {
    for (const label of ["note", "spec"]) {
      const labelled = { ...ticket(1102), labels: [{ name: label }] };
      const { ran } = ended({ tickets: [ticket(1101), labelled] });
      expect(ran).toEqual({ status: 0, stdout: "", stderr: `slice: #1102 is a ${label}, so no wave ended\n` });
    }
  });
});

const OWNER_SAID = { author: OWNER, type: "User", body: "Keep the done check out of the slicer." };
const piece = { title: "Read the spec kind", passages: [1], why: "Wave 2 of the spec: read it.", done: ["It reads."] };
const next = (tickets = [piece], moves = [1]) => ({ spec: wellFormedSpec, tickets, did: "Wave 1 filed the spec kind.", next: "Wave 2 reads it back.", moves });

function reslicing({ tickets = [ticket(1001), ticket(1002)], labels = ["spec"], answers = [next()] as object[] } = {}) {
  return slicing({
    labels,
    answers,
    issues: { "968/sub_issues": tickets.map((one) => ({ ...one, title: `Ticket ${one.number}`, state_reason: "completed" })) },
    comments: { "968": [OWNER_SAID, NOTE, CHECKED], "1001": ["#1001 is done: PR #2001 merged"], "1002": ["The builder split #1002 into #1003."] },
    prs: { "1001": { state: "MERGED", files: ["src/slicer.ts"] } },
  });
}

describe("bin/slice on a spec with tickets under it slices its next wave against the spec, its comments and what the last wave did (#1037)", () => {
  it("hands the slicer the owner's comments, the last wave check and each ticket's state, comments and PR, then files wave 2 under the spec with its note", () => {
    const sliced = reslicing();

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: ["slice: #968 filed wave 2 under it: #1101"] });
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("Slice this spec's next wave");
    expect(handed).toContain(OWNER_SAID.body);
    expect(handed).toContain(CHECKED.trim());
    expect(handed).toContain("#1001, Ticket 1001: closed, completed");
    expect(handed).toContain("#1001 is done: PR #2001 merged");
    expect(handed).toContain("Its PR: MERGED, touching src/slicer.ts");
    expect(handed).toContain("The builder split #1002 into #1003.");
    expect(handed).toContain("#1002, Ticket 1002: closed, completed\n\nIts PR: none");
    expect(sliced.linked()).toEqual(["repos/{owner}/{repo}/issues/968/sub_issues sub_issue_id=901101"]);
    const [note = ""] = sliced.comments();
    expect(note).toMatch(/^## Wave 2\n\n/);
    expect(note).toContain("Wave 1 filed the spec kind.\n\nWave 2 reads it back.\n\nFiled: #1101.\n\n<!-- moves: 1 -->\n");
  });

  it("files nothing and runs bin/done-check on the spec when nothing is left to slice", () => {
    const sliced = reslicing({ answers: [next([], []), { tries: [{ sentence: 1, outcome: "held", tried: "saw the spec labelled spec" }] }] });

    const ran = heard(sliced.run());
    expect(ran.lines).toEqual(["slice: #968 has nothing left to slice, so the done check tries its sentences", expect.stringMatching(/^done-check: #968 held every sentence and is closed/)]);
    expect(sliced.filed()).toEqual([]);
    expect(sliced.rewrites()).toEqual([]);
    expect(sliced.handed()[1]).toContain("Try each sentence");
    expect(sliced.comments()).toEqual([expect.stringMatching(/^## Done check\n/)]);
    expect(sliced.argv()).toContainEqual(["issue", "close", "968", "--reason", "completed"]);
  });

  it("slices nothing while a ticket under the spec is still open, so a second run for one wave's end files no second wave", () => {
    const sliced = reslicing({ tickets: [ticket(1001), ticket(1002, "open")] });

    expect(sliced.run()).toEqual({ status: 0, stdout: "slice: #968's wave is not over, #1002 is still open, so nothing sliced it\n", stderr: "" });
    expect(sliced.hired()).toEqual([]);
  });

  it("slices nothing on a spec marked needs-human, since the job stopped for the owner", () => {
    const sliced = reslicing({ labels: ["spec", "needs-human"] });

    expect(sliced.run()).toEqual({ status: 0, stdout: "slice: #968 is marked needs-human, so nothing sliced it\n", stderr: "" });
    expect(sliced.hired()).toEqual([]);
  });
});

interface Job {
  if?: string;
  needs?: string;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  outputs?: Record<string, string>;
  steps: (WorkflowStep & { id?: string; if?: string })[];
}

const RESLICE = parse(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "reslice.yml"), "utf8")) as { on: { issues?: { types?: string[] }; workflow_dispatch?: { inputs?: Record<string, { required?: boolean; type?: string }> } }; jobs: Record<string, Job> };
const job = (name: string): Job => {
  const found = RESLICE.jobs[name];
  if (found === undefined) throw new Error(`no ${name} job in reslice.yml`);
  return found;
};
const stepAt = (steps: Job["steps"], id: string) => steps.findIndex((step) => step.id === id);
const endedWith = (outputs: Record<string, string>) => ({ steps: { ended: { outcome: "success", conclusion: "success", outputs } } });

describe("reslice.yml runs the wave check, then the re-slice, when a closed issue ends its spec's wave (#1037)", () => {
  it("starts on every closed issue but a spec or a note, and finds whether it ended a wave spending no model", () => {
    const ended = job("ended");

    expect(RESLICE.on.issues?.types).toEqual(["closed"]);
    expect(holds(ended.if ?? "true", { labels: [], action: "closed" })).toBe(true);
    expect(holds(ended.if ?? "true", { labels: ["spec"], action: "closed" })).toBe(false);
    expect(holds(ended.if ?? "true", { labels: ["note"], action: "closed" })).toBe(false);
    expect(ended.steps.find((step) => step.id === "ended")?.run).toBe('bin/slice --ended "$ISSUE" >>"$GITHUB_OUTPUT"');
    expect(ended.steps.some((step) => step.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined)).toBe(false);
    expect(ended.outputs?.spec).toBe("${{ steps.ended.outputs.spec }}");
  });

  it("starts too on a dispatch naming the closed issue, which is how the closer starts it after its quiet close (#1045)", () => {
    expect(RESLICE.on.workflow_dispatch?.inputs?.issue).toEqual({ required: true, type: "number" });
    expect(holds(job("ended").if ?? "true", { labels: [], action: "" })).toBe(true);
    for (const name of ["ended", "reslice"]) expect(job(name).steps.find((step) => step.id === "ended")?.env?.ISSUE).toBe("${{ github.event.issue.number || inputs.issue }}");
  });

  it("reads the issue the closer dispatches as the one bin/slice --ended is asked about, which names the spec whose last ticket it closed", () => {
    const { calls, run } = closing({ ticket: "1102" });
    expect(run().status).toBe(0);
    const [input = "", number = ""] = /^workflow\nrun\nreslice\.yml\n-f\n(\w+)=(\d+)\n$/m.exec(calls().find((call) => call.startsWith("workflow\nrun\nreslice.yml\n")) ?? "")?.slice(1) ?? [];

    expect(Object.keys(RESLICE.on.workflow_dispatch?.inputs ?? {})).toEqual([input]);
    expect(job("ended").steps.find((step) => step.id === "ended")?.env?.ISSUE).toBe(`\${{ github.event.issue.number || inputs.${input} }}`);
    expect(ended({ closed: Number(number) }).ran).toEqual({ status: 0, stdout: "spec=968\nmoves=1,3\n", stderr: "" });
  });

  it("re-slices one spec at a time, checking again that the wave ended, then tries the sentences the last note moves before the re-slice", () => {
    const reslice = job("reslice");
    const { steps } = reslice;

    expect(reslice.needs).toBe("ended");
    expect(reslice.if).toBe("${{ needs.ended.outputs.spec != '' }}");
    expect(reslice.concurrency).toEqual({ group: "reslice-${{ needs.ended.outputs.spec }}", "cancel-in-progress": false });
    expect(steps[stepAt(steps, "ended")]?.run).toBe('bin/slice --ended "$ISSUE" >>"$GITHUB_OUTPUT"');
    expect(stepAt(steps, "ended")).toBeLessThan(stepAt(steps, "wave-check"));
    expect(stepAt(steps, "wave-check")).toBeLessThan(stepAt(steps, "reslice"));
    const waveCheck = steps[stepAt(steps, "wave-check")];
    const resliced = steps[stepAt(steps, "reslice")];
    expect(waveCheck?.run).toContain("bin/done-check ${{ steps.ended.outputs.spec }} --wave ${{ steps.ended.outputs.moves }}");
    expect(resliced?.run).toContain("bin/slice ${{ steps.ended.outputs.spec }}");
    expect(holds(waveCheck?.if ?? "true", endedWith({ spec: "968", moves: "1,3" }))).toBe(true);
    expect(holds(waveCheck?.if ?? "true", endedWith({ spec: "968", moves: "" }))).toBe(false);
    expect(holds(resliced?.if ?? "true", endedWith({ spec: "968", moves: "" }))).toBe(true);
    expect(holds(resliced?.if ?? "true", endedWith({ spec: "", moves: "" }))).toBe(false);
    for (const step of [waveCheck, resliced]) expect(step?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
  });
});
