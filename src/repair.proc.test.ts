import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ASKS, FIXED, HAND_OFF, repairing } from "./repair.part.ts";
import { rerunning, RUN_URL } from "./rerun.part.ts";
import { bodyIn, holds, skippedAll, type WorkflowStep } from "./scenarios.ts";
import { REPAIR_RUNNER } from "./post.ts";
import { MACHINE, OWNER, STUCK } from "./spelled.ts";

const dispatches = (calls: string[][]) => calls.filter((args) => args[0] === "workflow" && args[1] === "run");
const commentsIn = (calls: string[][]) => calls.filter((args) => args[0] === "issue" && args[1] === "comment").map(bodyIn);
const runnersRead = (calls: string[][]) => calls.filter((args) => args.some((arg) => arg.endsWith("/actions/runners")));
const unstuck = (calls: string[][]) => calls.filter((args) => args.includes("DELETE") && args.some((arg) => arg.endsWith(`/labels/${STUCK}`)));

describe("a stuck mark on a repo whose jobs run on the owner's PC hires a repair agent before the owner is called (#1761)", () => {
  it("hires the repair agent through the caller file with the stage's reason and the runs that stopped, @-mentioning no one", () => {
    const { calls, marks, run } = rerunning({ attempt: "2", onPc: true });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(marks()).toEqual(["902 stuck"]);
    expect(dispatches(calls())).toEqual([["workflow", "run", "machine.yml", "-f", "ticket=902", "-f", "repair=902"]]);
    const [handOff = "", ...more] = commentsIn(calls());
    expect(more).toEqual([]);
    expect(handOff).not.toContain(`@${OWNER}`);
    expect(handOff).toContain("the slice run of #902 ended red twice");
    expect(handOff).toContain(`${RUN_URL}/attempts/1`);
    expect(handOff).toContain(`${RUN_URL}/attempts/2`);
    const handedAt = calls().findIndex((args) => args[1] === "comment");
    expect(handedAt).toBeLessThan(calls().findIndex((args) => args[0] === "workflow"));
  });

  it("hires one again once the owner took stuck off himself after the repair agent resumed it", () => {
    const { calls, run } = rerunning({ attempt: "2", onPc: true, unstuckBy: [MACHINE, OWNER] });

    expect(run().status).toBe(0);
    expect(dispatches(calls())).toHaveLength(1);
  });

  it("calls the owner as today, hiring no one, when the repair agent resumed the issue and it went stuck again", () => {
    const { calls, run } = rerunning({ attempt: "2", onPc: true, unstuckBy: [OWNER, MACHINE] });

    expect(run().status).toBe(0);
    expect(dispatches(calls())).toEqual([]);
    const [called = "", ...more] = commentsIn(calls());
    expect(more).toEqual([]);
    expect(called).toContain(`@${OWNER} the slice run of #902 ended red twice and needs you`);
    expect(called).toContain("repair agent already took `stuck` off it once");
  });

  it("calls the owner as today when the repo's repair runner is offline, since a hire would wait for a runner that never takes it", () => {
    const { calls, run } = rerunning({ attempt: "2", onPc: true, repairRunner: "offline" });

    expect(run().status).toBe(0);
    expect(dispatches(calls())).toEqual([]);
    expect(commentsIn(calls())).toEqual([expect.stringContaining(`@${OWNER} the slice run of #902 ended red twice and needs you`)]);
  });

  it("calls the owner when the caller file refuses the hire, as one bin/enrol has not yet rewritten does", () => {
    const { calls, run } = rerunning({ attempt: "2", onPc: true, dispatchRefused: 'HTTP 422: Unexpected inputs provided: ["repair"]' });

    expect(run().status).toBe(0);
    expect(commentsIn(calls()).at(-1)).toContain(`@${OWNER} the slice run of #902 ended red twice and needs you`);
  });

  it("changes nothing in a repo on GitHub's hosted runners: the owner is called and no runner is read", () => {
    const { calls, run } = rerunning({ attempt: "2" });

    expect(run().status).toBe(0);
    expect(runnersRead(calls())).toEqual([]);
    expect(dispatches(calls())).toEqual([]);
    expect(commentsIn(calls())).toEqual([expect.stringContaining(`@${OWNER} the slice run of #902 ended red twice and needs you`)]);
  });
});

describe("bin/repair answers a stuck issue fixed or asks, as the owner's own user (#1761)", () => {
  it("hands the agent the stage's reason, and the owner's own gh login rather than the App's token", () => {
    const { handed, agentToken, run } = repairing();

    expect(run().status).toBe(0);
    expect(handed()).toContain("STRIPE_SECRET_KEY reads a different Stripe sandbox than dev's");
    expect(agentToken()).toBe("");
  });

  it("on fixed, posts what stopped it and what it changed, then takes stuck off so the issue resumes", () => {
    const { argv, run } = repairing();

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    const [posted = "", ...more] = commentsIn(argv());
    expect(more).toEqual([]);
    expect(posted).toContain(FIXED.found);
    expect(posted).toContain(FIXED.changed);
    expect(posted).not.toContain(`@${OWNER}`);
    expect(unstuck(argv())).toHaveLength(1);
    expect(argv().findIndex((args) => args[1] === "comment")).toBeLessThan(argv().findIndex((args) => args.includes("DELETE")));
  });

  it("on asks, @-mentions the owner with its one question, its pick and what it found, and leaves stuck on", () => {
    const { argv, run } = repairing({ answer: ASKS });

    expect(run().status).toBe(0);
    const [asked = "", ...more] = commentsIn(argv());
    expect(more).toEqual([]);
    expect(asked).toContain(`@${OWNER}`);
    expect(asked).toContain(ASKS.question);
    expect(asked).toContain(ASKS.recommendation);
    expect(asked).toContain(ASKS.found);
    expect(unstuck(argv())).toEqual([]);
  });

  it.each([
    ["no answer", {}],
    ["a fixed answer saying nothing it changed", { ...FIXED, changed: "" }],
    ["an asks answer with no question", { ...ASKS, question: " " }],
  ])("ends red on %s, posting nothing and leaving stuck on, so its job calls the owner", (_, answer) => {
    const { argv, run } = repairing({ answer });

    expect(run().status).toBe(1);
    expect(commentsIn(argv())).toEqual([]);
    expect(unstuck(argv())).toEqual([]);
  });

  it("stands down on an issue no longer stuck, hiring no one", () => {
    const { hired, argv, run } = repairing({ labels: ["ticket"] });

    expect(run().status).toBe(0);
    expect(hired()).toEqual([]);
    expect(commentsIn(argv())).toEqual([]);
  });

  it.each([
    ["failure", "ended red"],
    ["cancelled", "ran out of time or was cancelled"],
  ])("on an unfinished repair that %s, calls the owner as today, naming that the repair did not finish and what stopped the issue", (ended, said) => {
    const { hired, argv, run } = repairing();

    expect(run("--unfinished", "902", ended).status).toBe(0);
    expect(hired()).toEqual([]);
    const [called = ""] = commentsIn(argv());
    expect(called).toContain(`@${OWNER} the repair agent hired for #902 ${said} and did not finish`);
    expect(called).toContain("STRIPE_SECRET_KEY reads a different Stripe sandbox than dev's");
    expect(called).toContain("https://github.com/collod873/Mezzanine/actions/runs/6000");
    expect(called).not.toContain(HAND_OFF.split("\n")[0]);
  });
});

describe("the repair job runs on the owner's PC runner on a hire alone, and calls the owner when it does not finish (#1761)", () => {
  const { jobs } = parse(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "tickets.yml"), "utf8")) as { jobs: Record<string, { if?: string; "runs-on"?: string; steps?: WorkflowStep[] }> };
  const job = jobs.repair;
  const steps = job?.steps ?? [];
  const hired = { event: "workflow_dispatch", inputs: { ticket: "902", repair: "902" } };

  it("runs on the repair runner only on a dispatch naming an issue to repair, and no other job runs on it", () => {
    expect(job?.["runs-on"]).toBe(REPAIR_RUNNER);
    expect(holds(job?.if ?? "", hired)).toBe(true);
    expect(holds(job?.if ?? "", { event: "workflow_dispatch", inputs: { ticket: "902", rerun: "4417/1" } })).toBe(false);
    for (const [name, other] of Object.entries(jobs)) if (name !== "repair") expect(holds(other.if ?? "success()", hired), name).toBe(false);
  });

  it("calls the owner through bin/repair --unfinished when the repair step ends red or runs out of time, and not when it ends green", () => {
    const repairing = steps.find(({ run }) => /bin\/repair "\$ISSUE"$/m.test(run ?? ""));
    const unfinished = steps.find(({ run }) => (run ?? "").includes("bin/repair --unfinished"));
    const ended = { ...skippedAll(steps), app: { outcome: "success", conclusion: "success", outputs: {} } };

    expect(repairing?.["timeout-minutes" as keyof WorkflowStep]).toBeGreaterThan(0);
    expect(holds(unfinished?.if ?? "success()", { steps: ended, failed: true })).toBe(true);
    expect(holds(unfinished?.if ?? "success()", { steps: ended, cancelled: true })).toBe(true);
    expect(holds(unfinished?.if ?? "success()", { steps: ended })).toBe(false);
  });
});
