import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { git } from "./scenarios.ts";
import { LANDED, MAIN_MOVES, PAUSES, machineComment, scheduling, sliceOf, SPEC_ISSUE } from "./scheduler.part.ts";

const SPEC_BRANCH = `spec/${SPEC_ISSUE}`;
const optionOf = (argv: string[] | undefined, name: string) => (argv?.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const stateOf = (run: ReturnType<typeof scheduling>) => Object.fromEntries((run.progress()?.slices ?? []).map(({ id, state }) => [id, state]));

describe("bin/schedule runs a spec from its first cut to its landing, one slice at a time on an integration branch (#1509, ADR-0013)", () => {
  it("cuts with a fresh slicer, builds each slice, fast-forwards spec/<N> to it on origin, and runs bin/finish once nothing is left", () => {
    const run = scheduling({ cuts: [[sliceOf("seam")], []] });

    const ended = run.run();

    expect(ended).toMatchObject({ status: 0, stdout: `schedule: #${SPEC_ISSUE} landed as #${LANDED}, and its done check found every sentence held or put to the owner\n` });
    expect(run.order()).toEqual([`slice ${SPEC_ISSUE}`, `mark ${SPEC_ISSUE} building`, "build seam start", "build seam built", `slice ${SPEC_ISSUE}`, `finish ${SPEC_ISSUE}`]);
    expect(run.onRemote(SPEC_BRANCH)).toEqual(["Build seam", "Start"]);
    expect(run.finished()[0]).toContain(`branch=${SPEC_BRANCH}\nBuild seam\nStart`);
    expect(stateOf(run)).toEqual({ seam: "merged" });
  });

  it("hands each builder its slice branch off the integration branch, a brief carrying the spec's Out of Scope, and the ref to fast-forward", () => {
    const run = scheduling({ cuts: [[sliceOf("seam")], []] });

    expect(run.run().status).toBe(0);
    const argv = run.built("seam");
    expect(optionOf(argv, "--spec")).toBe(SPEC_ISSUE);
    expect(optionOf(argv, "--slice")).toBe("seam");
    expect(optionOf(argv, "--onto")).toBe(SPEC_BRANCH);
    expect(argv).not.toContain("--resume");
    expect(run.seen("seam")).toContain(`branch=slice/${SPEC_ISSUE}-seam`);
  });

  it("keeps one progress comment on the spec, edited in place, with a row per slice and every slice's state in its progress JSON", () => {
    const run = scheduling({ cuts: [[sliceOf("seam"), sliceOf("reader", ["seam"])], []], plans: { reader: [{ outcome: "partial" }] } });

    expect(run.run().status).toBe(0);
    const progress = run.comments().filter(({ body }) => body.startsWith("## Spec run"));
    expect(progress).toHaveLength(1);
    expect(progress[0]?.body).toContain("| `reader` | Build reader | merged | 1 | the rest of reader |");
    expect(run.progress()).toMatchObject({ fixPass: false, slices: [{ id: "seam", state: "merged", tries: 1 }, { id: "reader", state: "merged", left: "the rest of reader", session: "session-reader-1" }] });
  });

  it("hires at most three builders at once, each in its own process, and hires the next as one finishes", () => {
    const run = scheduling({ cuts: [["one", "two", "three", "four"].map((id) => sliceOf(id)), []], plans: Object.fromEntries(["one", "two", "three", "four"].map((id) => [id, [{ wait: 1 }]])) });

    expect(run.run().status).toBe(0);
    expect(Math.max(...run.peaks())).toBe(3);
    expect(run.order().filter((line) => line.endsWith(" start")).slice(0, 3).sort()).toEqual(["build one start", "build three start", "build two start"]);
    expect(run.order().indexOf("build four start")).toBeGreaterThan(run.order().findIndex((line) => line.endsWith(" built")));
    expect(new Set(run.onRemote(SPEC_BRANCH))).toEqual(new Set(["Build one", "Build two", "Build three", "Build four", "Start"]));
  });

  it("holds a slice until every slice it is blocked by has merged, and re-plans with a fresh slicer after each merge, reading the branch as built", () => {
    const run = scheduling({ cuts: [[sliceOf("seam")], [sliceOf("reader", ["seam"])], []] });

    expect(run.run().status).toBe(0);
    expect(run.seen("reader")).toContain("Build seam");
    const [, second = "", third = ""] = run.sliced();
    expect(second).toContain("Build seam");
    expect(third).toContain("Build reader");
    expect(run.order().filter((line) => line.startsWith("slice"))).toHaveLength(3);
  });

  it("rebases the integration branch onto origin/main, never merging it, before each re-plan", () => {
    const run = scheduling({ cuts: [[sliceOf("seam")], []], plans: { seam: [{ then: MAIN_MOVES }] } });

    expect(run.run().status).toBe(0);
    expect(run.sliced()[1]).toContain("Build seam\nMain moved\nStart");
    expect(git(run.remote, "rev-list", "--merges", "--count", SPEC_BRANCH)).toBe("0");
  });

  it("resumes a builder whose slice no longer fast-forwards because another merged first, telling it the tip moved", () => {
    const run = scheduling({ cuts: [[sliceOf("first"), sliceOf("second")], []], plans: { second: [{ wait: 1 }] } });

    expect(run.run().status).toBe(0);
    const again = run.built("second", 2);
    expect(optionOf(again, "--resume")).toBe("session-second-1");
    expect(optionOf(again, "--told")).toContain(`Another slice merged into \`${SPEC_BRANCH}\``);
    expect(run.onRemote(SPEC_BRANCH).filter((subject) => subject.startsWith("Build"))).toEqual(["Build second", "Build second", "Build first"]);
    expect(stateOf(run)).toEqual({ first: "merged", second: "merged" });
  });

  it("resumes a stopped builder once with its reason, leaves the slice out on its second stop while the others build and merge, and marks stuck only once nothing can move", () => {
    const run = scheduling({ cuts: [[sliceOf("wall"), sliceOf("free"), sliceOf("after", ["wall"])], []], plans: { wall: [{ outcome: "stuck" }, { outcome: "stuck" }], free: [{ wait: 1 }] } });

    const ended = run.run();

    expect(ended.status).toBe(1);
    expect(ended.stderr).toContain("marked stuck");
    const again = run.built("wall", 2);
    expect(optionOf(again, "--resume")).toBe("session-wall-1");
    expect(optionOf(again, "--told")).toContain("wall hit a wall");
    expect(/^dir=.*$/m.exec(run.seen("wall", 2))?.[0]).toBe(/^dir=.*$/m.exec(run.seen("wall"))?.[0]);
    expect(run.built("wall", 3)).toBeUndefined();
    expect(run.built("after")).toBeUndefined();
    expect(stateOf(run)).toEqual({ wall: "out", free: "merged", after: "cut" });
    expect(run.order().indexOf(`mark ${SPEC_ISSUE} stuck`)).toBeGreaterThan(run.order().indexOf("build free built"));
    expect(run.comments().at(-1)?.body).toContain("@collod873");
    expect(run.finished()).toEqual([]);
  });

  it("finishes and merges the builders in flight when the spec is paused mid-run, and hires none after", () => {
    const run = scheduling({ cuts: [[sliceOf("pauser"), sliceOf("flying"), sliceOf("later", ["pauser"])], []], plans: { pauser: [{ then: PAUSES }], flying: [{ wait: 2 }] } });

    const ended = run.run();

    expect(ended).toMatchObject({ status: 0, stdout: `schedule: #${SPEC_ISSUE} is marked paused, so its builders finished and merged and nothing more was hired\n` });
    expect(stateOf(run)).toEqual({ pauser: "merged", flying: "merged", later: "cut" });
    expect(run.built("later")).toBeUndefined();
    expect(run.order().filter((line) => line.startsWith("slice"))).toHaveLength(1);
    expect(run.finished()).toEqual([]);
  });

  it("spends one fix pass on a fresh integration branch off main when the done check misses, then lands", () => {
    const run = scheduling({ cuts: [[sliceOf("seam")], [], [sliceOf("mend")], []], finishes: [{ missed: "2" }, { landed: "1601" }] });

    const ended = run.run();

    expect(ended).toMatchObject({ status: 0, stdout: `schedule: #${SPEC_ISSUE} landed as #1601, and its done check found every sentence held or put to the owner\n` });
    expect(run.sliced()[2]).toContain("past-main=0");
    expect(run.finished()[1]).toContain(`branch=${SPEC_BRANCH}\nBuild mend\nMerge the spec\n`);
    expect(run.progress()).toMatchObject({ fixPass: true, slices: [{ id: "seam", fix: false }, { id: "mend", fix: true, state: "merged" }] });
  });

  it("stands down green when bin/finish stands down on a spec paused before it landed, calling no owner", () => {
    const run = scheduling({ cuts: [[sliceOf("seam")], []], finishes: [{ status: 1, landed: "", then: PAUSES }] });

    expect(run.run()).toMatchObject({ status: 0, stdout: `schedule: #${SPEC_ISSUE} is marked paused, so bin/finish stood down and the spec did not land\n` });
    expect(run.order()).not.toContain(`mark ${SPEC_ISSUE} stuck`);
  });

  it("marks the spec stuck and calls the owner when the done check misses again after its one fix pass", () => {
    const run = scheduling({ cuts: [[sliceOf("seam")], [], [sliceOf("mend")], []], finishes: [{ missed: "2" }, { missed: "2" }] });

    const ended = run.run();

    expect(ended.status).toBe(1);
    expect(run.order().at(-1)).toBe(`mark ${SPEC_ISSUE} stuck`);
    expect(run.comments().at(-1)?.body).toContain("missed sentence 2 after its one fix pass");
    expect(run.finished()).toHaveLength(2);
  });

  it("picks a rerun up from its progress comment and the integration branch on origin: merged slices stay merged, an interrupted one builds again from fresh", () => {
    const merged = { ...sliceOf("seam"), state: "merged", tries: 1, fix: false, session: "session-seam-1" };
    const building = { ...sliceOf("reader", ["seam"]), state: "hired", tries: 1, fix: false, session: "session-reader-1" };
    const progress = `## Spec run\n\n<!-- progress: ${JSON.stringify({ fixPass: false, slices: [merged, building] })} -->\n`;
    const run = scheduling({ onSpec: ["Build seam"], comments: [machineComment(7, progress)] });

    expect(run.run().status).toBe(0);
    expect(run.built("seam")).toBeUndefined();
    expect(run.built("reader")).not.toContain("--resume");
    expect(run.seen("reader")).toContain("Build seam");
    expect(run.comments().filter(({ body }) => body.startsWith("## Spec run"))).toHaveLength(1);
    expect(run.progress()?.slices.find(({ id }) => id === "reader")).toMatchObject({ state: "merged", tries: 1 });
  });

  it("mints a fresh App token after each model run, so a run past its first hour still pushes, and hands each builder and bin/finish an App key of its own", () => {
    const run = scheduling({ cuts: [[sliceOf("seam"), sliceOf("side")], []], appKeyed: true });

    expect(run.run().status).toBe(0);
    const tokenOf = (seen: string | undefined) => /^token=(.*)$/m.exec(seen ?? "")?.[1];
    const [firstSlicer, secondSlicer] = run.sliced().map(tokenOf);
    const builder = tokenOf(run.seen("seam"));
    expect(run.seen("seam")).toContain("key=Iv23liSpecRun");
    const finisher = tokenOf(run.finished()[0]);
    expect(firstSlicer).toBe("original");
    expect(builder).toMatch(/^minted-\d+$/);
    expect(secondSlicer).toMatch(/^minted-\d+$/);
    expect(new Set([firstSlicer, builder, secondSlicer, finisher]).size).toBe(4);
    expect(run.finished()[0]).toContain("key=Iv23liSpecRun");
    expect(run.seen("side")).toContain("key=Iv23liSpecRun");
  });

  it("refuses an issue not labelled spec, hiring nothing", () => {
    const run = scheduling({ labels: ["ticket"] });

    expect(run.run()).toMatchObject({ status: 1, stderr: `schedule: #${SPEC_ISSUE} is not a spec, so nothing was hired\n` });
    expect(run.order()).toEqual([]);
  });

  it("stands down green on a paused spec, hiring nothing", () => {
    const run = scheduling({ labels: ["spec", "paused"] });

    expect(run.run()).toMatchObject({ status: 0, stdout: `schedule: #${SPEC_ISSUE} is marked paused, so nothing was hired\n` });
    expect(run.order()).toEqual([]);
  });

  it("briefs each builder with the spec's decisions its slice follows, beside the spec's Out of Scope, since a builder never reads the spec", () => {
    const run = scheduling({ cuts: [[{ ...sliceOf("seam"), decisions: ["Reuse the ticket machinery where it already fits."] }], []] });

    expect(run.run().status).toBe(0);
    const brief = readFileSync(optionOf(run.built("seam"), "--brief") ?? "", "utf8");
    expect(brief).toContain("## Implementation and Testing Decisions\n\n- Reuse the ticket machinery where it already fits.");
    expect(brief).toContain("## Out of Scope\n\nThe slicer and the done check.");
  });
});
