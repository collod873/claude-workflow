import { describe, expect, it } from "vitest";
import { TICKET_CAP } from "./brief.ts";
import { machineComment, SPEC_ISSUE } from "./scheduler.part.ts";
import { ANSWERED, slicing, SLICING_SESSION } from "./slicer.part.ts";

const QUOTED = 'The spec asks: "a spec is filed once".';
const slice = (id: string, blockedBy: string[] = [], why = QUOTED, leftOf: string[] = []) => ({ id, title: `Build ${id}`, why, decisions: [], done: [`${id} holds.`], blockedBy, leftOf });
const progressed = (slices: object[], fixPass = false) => machineComment(3, `## Spec run\n\n<!-- progress: ${JSON.stringify({ fixPass, slices })} -->\n`);
const tracked = (id: string, state: string, extra: object = {}) => ({ ...slice(id), state, tries: 1, fix: false, ...extra });
const MISSED = "2. **Did not hold**: open a ticket it filed\n   `bin/slice` still files tickets.";

describe("bin/slice answers the scheduler with the spec's next slices, never filing a ticket (#1509, ADR-0013)", () => {
  it("prints the slices as one JSON line on stdout, says one line on stderr, and marks the spec slicing before hiring opus with the slices schema", () => {
    const sliced = slicing({ answers: [{ slices: [slice("seam"), slice("reader", ["seam"])] }] });

    const ran = sliced.run();

    expect(ran).toMatchObject({ status: 0, stderr: `slice: #${SPEC_ISSUE} cut 2 slices: seam, reader\n` });
    expect(JSON.parse(ran.stdout.trimEnd().split("\n").at(-1) ?? "")).toEqual({ slices: [slice("seam"), slice("reader", ["seam"])] });
    expect(sliced.marked()).toEqual([`${SPEC_ISSUE} slicing before the model`]);
    const [hired = []] = sliced.hired();
    expect(hired[hired.indexOf("--model") + 1]).toBe("opus");
    expect(hired[hired.indexOf("--json-schema") + 1]).toContain('"leftOf"');
    expect(sliced.calls().filter(([command, action]) => command === "issue" && action === "create")).toEqual([]);
  });

  it("asks the first slicer for the seams first and the rest at their last responsible moment, handing it the spec", () => {
    const sliced = slicing({ answers: [ANSWERED] });

    expect(sliced.run().status).toBe(0);
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("Cut the seams first");
    expect(handed).toContain("a spec is filed once, so the slicer and the done check share one document");
    expect(handed).toContain("(nothing built yet)");
    expect(handed).not.toContain("Answer no slice when nothing is left");
  });

  it("stops at once on a first cut with no slice, marking the spec stuck and calling the owner, since nothing of the spec would be built", () => {
    const sliced = slicing({ answers: [{ slices: [] }] });

    expect(sliced.run()).toMatchObject({ status: 1, stdout: "" });
    expect(sliced.handed()).toHaveLength(1);
    expect(sliced.marked().at(-1)).toBe(`${SPEC_ISSUE} stuck after the model`);
    expect(sliced.comments().at(-1)?.body).toContain(`@collod873 the slicer of #${SPEC_ISSUE} cut nothing and needs you: its first cut carried no slice`);
  });

  it("hands a later slicer the integration branch as built, each commit with its slice, and every slice so far with its state", () => {
    const sliced = slicing({ built: ["seam"], comments: [progressed([tracked("seam", "merged"), tracked("reader", "hired", { blockedBy: ["seam"] })])], answers: [{ slices: [] }] });

    const ran = sliced.run();

    expect(ran).toMatchObject({ status: 0, stdout: '{"slices":[]}\n', stderr: `slice: #${SPEC_ISSUE} cut 0 slices\n` });
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("cut each slice now at its last responsible moment");
    expect(handed).toContain("- Build seam (seam)");
    expect(handed).toContain("- `seam` (merged): Build seam.");
    expect(handed).toContain("- `reader` (hired): Build reader. Blocked by `seam`.\n  Done when: reader holds.");
  });

  it("hands the fix pass's first slicer the newest done check's findings, asks it for at least one slice and never for none, marks its try, and sends back a cut with no slice", () => {
    const sliced = slicing({ comments: [machineComment(1, "## Done check\n\nAn older run."), progressed([tracked("seam", "merged")], true), machineComment(4, `## Done check\n\n${MISSED}\n`)], answers: [{ slices: [] }, { slices: [slice("mend")] }] });

    const ran = sliced.run();

    expect(ran.status).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual({ slices: [slice("mend")] });
    const [first = "", again = ""] = sliced.handed();
    expect(first).toContain("This is the spec's one fix pass");
    expect(first).toContain("Make each sentence hold whole");
    expect(first).toContain(MISSED);
    expect(first).not.toContain("An older run.");
    expect(first).toContain("Cut at least one.");
    expect(first).not.toContain("Answer no slice");
    expect(again).toContain("the fix pass carries no slice");
    expect(sliced.marked()).toEqual([`${SPEC_ISSUE} slicing --try before the model`]);
  });

  it("hands a later slicer of the fix pass the re-plan rules beside the findings, never the fix pass's opening, and lets it answer none", () => {
    const sliced = slicing({ comments: [progressed([tracked("seam", "merged"), tracked("mend", "hired", { fix: true })], true), machineComment(4, `## Done check\n\n${MISSED}\n`)], answers: [{ slices: [] }] });

    expect(sliced.run()).toMatchObject({ status: 0, stdout: '{"slices":[]}\n' });
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("cut each slice now at its last responsible moment");
    expect(handed).toContain(MISSED);
    expect(handed).toContain("- `mend` (hired, fix pass): Build mend.");
    expect(handed).toContain("Answer no slice when nothing is left");
    expect(handed).not.toContain("This is the spec's one fix pass");
  });

  it("has each slicer cut again, once, what a partial slice left, naming it in leftOf, and sends back a cut that leaves it or cuts it twice", () => {
    const sliced = slicing({
      comments: [progressed([tracked("jobs", "merged", { left: "Invoices still show UTC." }), tracked("clock", "merged", { left: "The Today screen." }), tracked("today", "cut", { leftOf: ["clock"] })])],
      answers: [{ slices: [slice("again", [], QUOTED, ["clock"])] }, { slices: [slice("invoices", [], QUOTED, ["jobs"])] }],
    });

    const ran = sliced.run();

    expect(JSON.parse(ran.stdout)).toEqual({ slices: [slice("invoices", [], QUOTED, ["jobs"])] });
    const [handed = "", sentBack = ""] = sliced.handed();
    expect(handed).toContain("- `jobs` (merged): Build jobs. It left: Invoices still show UTC. Not cut again yet.");
    expect(handed).toContain("- `clock` (merged): Build clock. It left: The Today screen. Cut again as `today`.");
    expect(sentBack).toContain("`jobs` left work no slice of this answer cuts again");
    expect(sentBack).toContain("slice 1, `again`, cuts again what `clock` left, which `today` already cuts again");
  });

  it("reads a progress comment written before slices carried decisions and leftOf", () => {
    const { decisions: _decisions, leftOf: _leftOf, ...unrecorded } = tracked("seam", "merged");
    const sliced = slicing({ comments: [progressed([unrecorded])], answers: [{ slices: [slice("reader", ["seam"])] }] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.handed()[0]).toContain("- `seam` (merged): Build seam.");
  });

  it("hands the fix pass only the done check's misses, each whole, however long the sentences that held run or whatever numbered list a try holds", () => {
    const miss = `2. **Did not hold**: open a ticket it filed\n   I tried:\n1. **Ran** bin/slice on the spec\n2. **Read** the brief\nthe brief lost the Out of Scope at ${"collect.ts:79 ".repeat(40).trimEnd()}`;
    const check = `## Done check\n\n1. **Held**: ${"a long sentence that held ".repeat(400)}\n   saw it\n${miss}\n3. **Put to the owner**: try it on the phone\n   open it on your phone\n`;
    const sliced = slicing({ comments: [progressed([tracked("seam", "merged")], true), machineComment(4, check)], answers: [{ slices: [slice("mend")] }] });

    expect(sliced.run().status).toBe(0);
    const [first = ""] = sliced.handed();
    expect(first).toContain(`## The done check's findings\n\n${miss}\n\n## Your answer`);
    expect(first).not.toContain("a long sentence that held");
    expect(first).not.toContain("open it on your phone");
  });

  it("sends back, in the same session, slices whose ids clash or are not kebab-case, that wait on no slice or on each other, or whose brief would quote nothing or overrun the builder's brief cap", () => {
    const sliced = slicing({
      comments: [progressed([tracked("seam", "merged")])],
      answers: [
        {
          slices: [slice("seam"), slice("Reader"), slice("twice"), slice("twice"), slice("waits", ["ghost"]), slice("loop-a", ["loop-b"]), slice("loop-b", ["loop-a"]), slice("unquoted", [], "No quote at all."), { ...slice("huge"), done: ["x".repeat(TICKET_CAP)] }],
        },
        { slices: [slice("reader", ["seam"])] },
      ],
    });

    const ran = sliced.run();

    expect(JSON.parse(ran.stdout)).toEqual({ slices: [slice("reader", ["seam"])] });
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toContain("slice 1, `seam`, reuses the id of a slice already cut");
    expect(sentBack).toContain("slice 2, `Reader`, has an id that is not kebab-case");
    expect(sentBack).toContain("slice 4, `twice`, has the id of an earlier slice in this answer");
    expect(sentBack).toContain("slice 5, `waits`, is blocked by `ghost`, which no slice is");
    expect(sentBack).toContain("the slices block each other in a cycle, `loop-a` -> `loop-b` -> `loop-a`");
    expect(sentBack).toContain("slice 8, `unquoted`, '## Why' quotes nothing that set this");
    expect(sentBack).toContain("slice 9, `huge`, would brief its builder in");
    expect(sentBack).not.toContain("slice 3,");
    const [, resumed = []] = sliced.hired();
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe(SLICING_SESSION);
  });

  it("marks the spec stuck and calls the owner when its slices are still refused after two rounds back, answering no slices", () => {
    const sliced = slicing({ answers: [{ slices: [slice("loop", ["loop"])] }] });

    const ran = sliced.run();

    expect(ran).toMatchObject({ status: 1, stdout: "" });
    expect(sliced.handed()).toHaveLength(3);
    expect(sliced.marked().at(-1)).toBe(`${SPEC_ISSUE} stuck after the model`);
    expect(sliced.comments().at(-1)?.body).toContain("@collod873 the slicer of #968 cut nothing");
  });

  it("refuses an issue not labelled spec, hiring no model and marking nothing", () => {
    const sliced = slicing({ labels: ["ticket"] });

    expect(sliced.run()).toMatchObject({ status: 1, stdout: "", stderr: `slice: #${SPEC_ISSUE} is not a spec, so nothing sliced it\n` });
    expect(sliced.handed()).toEqual([]);
    expect(sliced.marked()).toEqual([]);
  });
});
