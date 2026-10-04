import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { heard, holds, type Said, starts, wellFormedSpec, type WorkflowStep } from "./scenarios.ts";
import { OWNER } from "./spelled.ts";
import { closing } from "./closer.part.ts";
import { slicing } from "./slicer.part.ts";
import { doneChecking, specWith } from "./done-checker.part.ts";
import { DIFF_CAP } from "./wave.ts";

const SPEC_ISSUE = { number: 968, state: "open", labels: [{ name: "spec" }], user: { login: OWNER }, body: "" };
const ticket = (number: number, state = "closed") => ({ number, state, labels: [] as { name: string }[], user: { login: "core-app[bot]" }, body: "## Why\n\n> the owner's words\n\n## Done when\n\n- It lands.\n" });
const followUp = (number: number, of: number, state = "open") => ({ ...ticket(number, state), body: `## Why\n\nFollow-up of #${of}: its review found this after its builder's repair, outside the earlier gaps and the fix's own lines.\n\n> a gap\n\n## Done when\n\n- It lands.\n` });
const NOTE = "## Wave 1\n\n> the owner's words\n\nSettled.\n\nFiles it.\n\nFiled: #1101, #1102.\n\n<!-- moves: 1, 3 -->\n";
const CHECKED = "## Wave check\n\n1. **Held**: see it\n";

function ended({ closed = 1102, tickets = [ticket(1101), ticket(1102)], spec = SPEC_ISSUE, open = [] as object[], said = [NOTE, CHECKED], extra = {} as Record<string, object>, gh = "" } = {}) {
  const issues: Record<string, object> = { "968": spec, "968/sub_issues": tickets, ...extra };
  for (const one of tickets) Object.assign(issues, { [String(one.number)]: one, [`${one.number}/parent`]: spec });
  const sliced = slicing({ issues, comments: { "968": said }, open, gh });
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

function reslicing({
  tickets = [ticket(1001), ticket(1002)],
  labels = ["spec"],
  answers = [next()] as object[],
  said = [OWNER_SAID, NOTE, CHECKED] as Said[],
  prs = { "1001": { state: "MERGED", files: ["src/slicer.ts"] } } as Record<string, object>,
  diffs = {} as Record<string, string>,
  spec = "968",
  markRefusal = undefined as string | undefined,
  gh = "",
} = {}) {
  return slicing({
    gh,
    markRefusal,
    labels,
    answers,
    issues: { [`${spec}/sub_issues`]: tickets.map((one) => ({ ...one, title: `Ticket ${one.number}`, state_reason: "completed" })) },
    comments: { [spec]: said, "1001": ["#1001 is done: PR #2001 merged"], "1002": ["The builder split #1002 into #1003."] },
    prs,
    diffs,
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

    expect(sliced.run()).toEqual({ status: 0, stdout: "slice: #968 is marked needs-human, so no label changed and no model was hired\n", stderr: "" });
    expect(sliced.hired()).toEqual([]);
  });
});

const helper = (file: string) => `diff --git a/src/${file} b/src/${file}\n+export const quotedLine = (line: string) => \`> \${line}\`;\n`;
const MERGED = { "1001": { state: "MERGED", files: ["src/slicer.ts"] }, "1002": { state: "MERGED", files: ["src/done-checker.ts"] } };
describe("bin/slice ends red at a read of the wave that fails, rather than handing the slicer a placeholder (#1112)", () => {
  const failing = (pattern: string) => `[[ "$*" == ${pattern} ]] && { printf 'gh: Server Error (HTTP 502)\\n' >&2; exit 1; }`;

  it.each([
    { read: "a ticket's PR", pattern: '"pr view ticket/1001"*', line: "the PR of #1001 could not be read" },
    { read: "a ticket's comments", pattern: '*"issues/1001/comments"*', line: "the comments on #1001 could not be read, so no model was spent" },
    { read: "a merged PR's diff", pattern: '"pr diff ticket/1001"*', line: "the diff of #1001's PR could not be read, so no model was spent" },
    { read: "the tickets under the spec", pattern: '*"issues/968/sub_issues"*', line: "the tickets under #968 could not be read, so no model was spent" },
    { read: "the spec itself (#1115)", pattern: '"issue view 968"*', line: "#968 could not be read, so no label changed and no model was hired" },
    { read: "the spec's comments (#1115)", pattern: '*"issues/968/comments"*', line: "the comments on #968 could not be read, so no model was spent" },
  ])("ends red at unread naming $read, marking, posting and hiring nothing", ({ pattern, line }) => {
    const sliced = reslicing({ gh: failing(pattern) });

    expect(sliced.run()).toEqual({ status: 1, stdout: "", stderr: `slice: ${line}\n` });
    expect(sliced.marked()).toEqual([]);
    expect(sliced.hired()).toEqual([]);
    expect([...sliced.comments(), ...sliced.filed().map(({ body }) => body), ...sliced.rewrites()]).toEqual([]);
  });
});

describe("bin/slice --ended ends red at a read of the wave that fails, naming no spec (#1112)", () => {
  it.each([
    { read: "the tickets under the spec", pattern: '*"issues/968/sub_issues"*', line: "the tickets under #968 could not be read, so no wave ended" },
    { read: "the open issues", pattern: '"issue list"*', line: "the open issues could not be read to find follow-ups of #968's tickets, so no wave ended" },
    { read: "the spec's comments", pattern: '*"issues/968/comments"*', line: "the comments on #968 could not be read, so no wave ended" },
    { read: "the closed issue (#1123)", pattern: '*"issues/1102"', line: "#1102 could not be read, so no wave ended" },
    { read: "the closed issue's parent (#1123)", pattern: '*"issues/1102/parent"', line: "the parent of #1102 could not be read, so no wave ended" },
  ])("ends red at unread naming $read", ({ pattern, line }) => {
    const { ran, hired } = ended({ gh: `[[ "$*" == ${pattern} ]] && { printf 'gh: Server Error (HTTP 502)\\n' >&2; exit 1; }` });

    expect(ran).toEqual({ status: 1, stdout: "", stderr: `slice: ${line}\n` });
    expect(hired()).toEqual([]);
  });
});

const merge = { title: "Merge the two quotedLine helpers into one", passages: [1], why: "Wave 1 left two copies of one helper.", done: ["One quotedLine stands."] };

describe("bin/slice hands the re-slice the diff of every PR the wave merged, so it can fold what the wave built into the spec (#1047)", () => {
  it("hands the slicer each merged PR's diff and asks it to fold shared parts into Names, merge two copies of one helper and hold back what leans on it; a wave that merged two copies yields a merge ticket", () => {
    const sliced = reslicing({ prs: MERGED, diffs: { "1001": helper("slicer.ts"), "1002": helper("done-checker.ts") }, answers: [next([merge])] });

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: ["slice: #968 filed wave 2 under it: #1101"] });
    const [handed = ""] = sliced.handed();
    expect(handed).toContain(`### #1002's PR\n\n${helper("done-checker.ts")}`);
    expect(handed).toContain(`### #1001's PR\n\n${helper("slicer.ts")}`);
    expect(handed).toContain("fold the helpers, seams and modules the wave built that tickets share into `### Names the tickets share`");
    expect(handed).toContain("two copies of one helper or a shallow module");
    expect(handed).toContain("hold the tickets that touch that module back a wave");
    expect(handed).toContain("`did`");
    expect(sliced.filed().map(({ title }) => title)).toEqual([merge.title]);
  });

  it("hands no diff for a ticket whose PR did not merge", () => {
    const sliced = reslicing({ prs: { "1001": { state: "CLOSED", files: ["src/slicer.ts"] } }, diffs: { "1001": helper("slicer.ts") } });

    expect(sliced.run().status).toBe(0);
    expect(sliced.handed()[0]).not.toContain(helper("slicer.ts"));
  });

  it("cuts the diffs at DIFF_CAP and says whose diff was cut and whose were not shown", () => {
    const big = helper("slicer.ts") + "+x\n".repeat(DIFF_CAP);
    const sliced = reslicing({ prs: MERGED, diffs: { "1002": big, "1001": helper("done-checker.ts") } });

    expect(sliced.run().status).toBe(0);
    const [handed = ""] = sliced.handed();
    expect(handed).toContain(`(cut at the ${DIFF_CAP} byte cap inside #1002's diff; not shown: #1001)`);
    expect(handed).not.toContain(helper("done-checker.ts"));
  });
});

const MISSED = "## Wave check\n\n- Sentence 1, **Did not hold**: see it\n  saw it fail\n";

describe("bin/slice sends back a wave that drops a sentence the last wave check missed (#1047)", () => {
  it("sends back a wave with no ticket after a wave check that missed, instead of handing off to the done check", () => {
    const sliced = reslicing({ said: [NOTE, MISSED], answers: [next([], []), next()] });

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: ["slice: #968 filed wave 2 under it: #1101"] });
    const [handed = "", sentBack = ""] = sliced.handed();
    expect(handed).toContain("The last wave check missed sentence 1: this wave carries at least one ticket, and its `moves` name each of them.");
    expect(handed).not.toContain("Give no ticket when nothing is left to slice");
    expect(sentBack).toContain("the wave carries no ticket, and the last wave check missed sentence 1");
  });

  it("sends back a wave whose moves leave out the missed sentence", () => {
    const sliced = reslicing({ said: [NOTE, MISSED], answers: [next([piece], []), next()] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.handed()[1]).toContain("the note leaves out sentence 1, which the last wave check missed");
    expect(sliced.comments()[0]).toContain("<!-- moves: 1 -->");
  });

  it("reads a wave check from before the last wave note as already carried", () => {
    const sliced = reslicing({ said: [MISSED, NOTE], answers: [next([], []), { tries: [{ sentence: 1, outcome: "held", tried: "saw it" }] }] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.filed()).toEqual([]);
    expect(sliced.handed()[1]).toContain("Try each sentence");
  });
});

describe("bin/slice <spec> --fix <numbers> files the spec's one fix wave for the sentences the done check missed (#1047)", () => {
  const SENTENCES = ["file a spec and see its first wave under it", "open a ticket and see my own words"];
  const FIX_SPEC = specWith(SENTENCES);
  const fixPiece = { ...piece, title: "Carry the owner's words", why: "The fix wave." };
  const fixing = (answers: object[]) => {
    const checked = doneChecking({ body: FIX_SPEC, tries: [{ sentence: 1, outcome: "held", tried: "saw it" }, { sentence: 2, outcome: "missed", tried: "saw it fail" }] });
    expect(checked.run().status).toBe(0);
    const [args = ""] = checked.sliced();
    const [spec = ""] = args.split(" ");
    const sliced = slicing({ body: FIX_SPEC, answers, issues: { [`${spec}/sub_issues`]: [{ ...ticket(1001), title: "Ticket 1001", state_reason: "completed" }] }, comments: { [spec]: [NOTE, "## Done check\n\n2. **Did not hold**: two"] } });
    return { sliced, ran: sliced.run(...args.split(" ")) };
  };

  it("files the fix wave under the spec, with every ticket closed, from the arguments the done check passes, and notes it moving exactly those sentences", () => {
    const { sliced, ran } = fixing([{ ...next([fixPiece], [2]), spec: FIX_SPEC }]);

    expect(heard(ran)).toEqual({ status: 0, stderr: "", lines: ["slice: #974 filed wave 2 under it: #1101"] });
    expect(sliced.linked()).toEqual(["repos/{owner}/{repo}/issues/974/sub_issues sub_issue_id=901101"]);
    expect(sliced.handed()[0]).toContain("Slice this spec's one fix wave: the done check found sentence 2 did not hold with every ticket closed.");
    expect(sliced.comments()[0]).toMatch(/^## Wave 2\n/);
    expect(sliced.comments()[0]).toContain("<!-- moves: 2 -->");
  });

  it("sends back a fix wave whose moves are not exactly the named sentences", () => {
    const { sliced, ran } = fixing([{ ...next([fixPiece], [1, 2]), spec: FIX_SPEC }, { ...next([fixPiece], [2]), spec: FIX_SPEC }]);

    expect(ran.status).toBe(0);
    expect(sliced.handed()[1]).toContain("the fix wave moves sentence 1, 2, and must move exactly sentence 2");
  });

  it("ends red and files nothing when the slicer gives no ticket for the fix wave", () => {
    const { sliced, ran } = fixing([{ ...next([], [2]), spec: FIX_SPEC }]);

    expect(ran).toEqual({ status: 1, stdout: "", stderr: "slice: #974 ended red, the slicer gave no ticket for its fix wave, so nothing was filed\n" });
    expect(sliced.filed()).toEqual([]);
    expect(sliced.rewrites()).toEqual([]);
    expect(sliced.comments()).toEqual([]);
    expect(sliced.handed()).toHaveLength(1);
  });

  it("tells the slicer of a first, next and fix wave to move only a sentence its own tickets, once merged, show on the running system without another wave (#1083)", () => {
    const first = slicing({ answers: [next()] });
    const again = reslicing({ answers: [next()] });
    const { sliced: fixed } = fixing([{ ...next([fixPiece], [2]), spec: FIX_SPEC }]);
    expect(first.run().status).toBe(0);
    expect(again.run().status).toBe(0);

    for (const handed of [first.handed()[0], again.handed()[0], fixed.handed()[0]]) {
      expect(handed).toContain("Name in `moves` only a sentence this wave's own tickets, once merged, make visible on the running system without another wave");
      expect(handed).toContain("that needs two PRs in the closer's queue at once may still be named");
    }
  });

  it("refuses --fix with no sentence numbers, or with --ended", () => {
    const sliced = slicing();
    expect(sliced.run("968", "--fix").status).toBe(2);
    expect(sliced.run("968", "--fix", "two").status).toBe(2);
    expect(sliced.run("--ended", "968", "--fix", "2").status).toBe(2);
    expect(sliced.calls()).toEqual([]);
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
  it("starts on every closed issue but a spec or a note, and finds whether it ended a wave spending no model", async () => {
    const ended = job("ended");

    expect(RESLICE.on.issues?.types).toEqual(["closed"]);
    expect(await starts("reslice.yml", "ended", { labels: [], action: "closed" })).toBe(true);
    expect(await starts("reslice.yml", "ended", { labels: ["spec"], action: "closed" })).toBe(false);
    expect(await starts("reslice.yml", "ended", { labels: ["note"], action: "closed" })).toBe(false);
    expect(ended.steps.find((step) => step.id === "ended")?.run).toBe('bin/slice --ended "$ISSUE" >>"$GITHUB_OUTPUT"');
    expect(ended.steps.some((step) => step.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined)).toBe(false);
    expect(ended.outputs?.spec).toBe("${{ steps.ended.outputs.spec }}");
  });

  it("starts too on a dispatch naming the closed issue, which is how the closer starts it after its quiet close (#1045)", async () => {
    expect(RESLICE.on.workflow_dispatch?.inputs?.issue).toEqual({ required: true, type: "number" });
    expect(await starts("reslice.yml", "ended", { action: "" })).toBe(true);
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

describe("bin/slice marks a spec's next wave and its fix wave as they are sliced, and nothing when it slices nothing (#1064)", () => {
  it("marks slicing then building for the next wave", () => {
    const sliced = reslicing();

    expect(sliced.run().status).toBe(0);
    expect(sliced.marked()).toEqual(["968 slicing", "968 building"]);
  });

  it("marks slicing then checking, and no building, when nothing is left to slice and the done check runs", () => {
    const sliced = reslicing({ answers: [next([], []), { tries: [{ sentence: 1, outcome: "held", tried: "saw the spec labelled spec" }] }] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.marked()).toEqual(["968 slicing", "968 checking"]);
  });

  it("marks nothing while the wave is not over, or on a spec marked needs-human", () => {
    const open = reslicing({ tickets: [ticket(1001), ticket(1002, "open")] });
    const stopped = reslicing({ labels: ["spec", "needs-human"] });

    expect(open.run().status).toBe(0);
    expect(open.marked()).toEqual([]);
    expect(stopped.run().status).toBe(0);
    expect(stopped.marked()).toEqual([]);
  });

  it("marks the fix wave's slicing with --try, so the spec carries try-2 from then on", () => {
    const sliced = slicing({ body: specWith(["one", "two"]), answers: [{ ...next([piece], [2]), spec: specWith(["one", "two"]) }], issues: { "974/sub_issues": [{ ...ticket(1001), title: "Ticket 1001", state_reason: "completed" }] }, comments: { "974": [NOTE] } });

    expect(sliced.run("974", "--fix", "2").status).toBe(0);
    expect(sliced.marked()).toEqual(["974 slicing --try", "974 building"]);
  });
});

describe("bin/slice stops at a mark GitHub refused, so it hires no model on a spec whose labels lag (#1107)", () => {
  it("ends red at the slicing mark, naming the stage, the label and the spec, and hires, files and marks nothing after it", () => {
    const sliced = reslicing({ markRefusal: "mark: #968 not labelled slicing: HTTP 403: Resource not accessible by integration" });

    const { status, stderr } = sliced.run();

    expect(status).toBe(1);
    expect(stderr).toContain("slice: bin/mark #968 slicing ended non-zero, so nothing after it is posted, closed, marked or hired\n");
    expect(sliced.marked()).toEqual(["968 slicing"]);
    expect(sliced.handed()).toEqual([]);
    expect(sliced.filed()).toEqual([]);
  });
});
