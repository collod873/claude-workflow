import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CANCELLED_BY_OWNER, OUT_OF_TIME, ownerCall, red, rerunning, RUN_URL } from "./rerun.part.ts";
import { holds, type WorkflowStep } from "./scenarios.ts";
import { HELD, OWNER } from "./spelled.ts";

const reruns = (calls: string[][]) => calls.filter((args) => args.some((arg) => arg.endsWith("/rerun-failed-jobs")));
const polls = (calls: string[][]) => calls.filter((args) => args.includes("repos/{owner}/{repo}/actions/runs/4417/attempts/1"));
const dispatches = (calls: string[][]) => calls.filter((args) => args[0] === "workflow" && args[1] === "run");
const comments = (calls: string[][]) => calls.filter((args) => args[0] === "issue" && args[1] === "comment");

describe("bin/rerun re-runs a red run once by itself, and only a second red marks stuck (#1178)", () => {
  it("re-runs a first attempt that ended red as a second attempt of its failed jobs, marking nothing and posting nothing", () => {
    const { calls, marks, run } = rerunning();

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(reruns(calls())).toEqual([["api", "-X", "POST", "repos/{owner}/{repo}/actions/runs/4417/rerun-failed-jobs"]]);
    expect(marks()).toEqual([]);
    expect(comments(calls())).toEqual([]);
  });

  it("reads the run's jobs past a server error GitHub answers once, logging the retry (#1206)", () => {
    const { calls, run } = rerunning({ blip: "gh: Server Error (HTTP 502)" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/^github: gh api repos\/\{owner\}\/\{repo\}\/actions\/runs\/4417\/attempts\/1\/jobs\?per_page=100 failed on try 1 of 3, so it is tried again in 0s: gh: Server Error \(HTTP 502\)$/m);
    expect(reruns(calls())).toHaveLength(1);
  });

  it("re-runs a first attempt its job's time limit cancelled, as it re-runs a red one", () => {
    const { calls, run } = rerunning({ jobs: [{ conclusion: "cancelled", annotations: [ownerCall("902", "the slice run"), { message: OUT_OF_TIME }] }] });

    expect(run().status).toBe(0);
    expect(reruns(calls())).toHaveLength(1);
  });

  it("neither re-runs nor marks a run the owner cancelled, on any attempt", () => {
    for (const attempt of ["1", "2"]) {
      const { calls, marks, run } = rerunning({ attempt, jobs: [{ conclusion: "cancelled", annotations: [ownerCall("902", "the slice run"), { message: CANCELLED_BY_OWNER }] }] });

      expect(run().status, attempt).toBe(0);
      expect(reruns(calls()), attempt).toEqual([]);
      expect(marks(), attempt).toEqual([]);
      expect(comments(calls()), attempt).toEqual([]);
    }
  });

  it("re-runs nothing when no job that stopped called the owner, as a red run outside the stages or on a held issue does not", () => {
    const { calls, run } = rerunning({ jobs: [{ conclusion: "failure", annotations: [] }] });

    expect(run().status).toBe(0);
    expect(reruns(calls())).toEqual([]);
  });

  it("marks the issue stuck on a second red attempt and comments once, naming what stopped and linking the first run and the re-run", () => {
    const { calls, marks, run } = rerunning({ attempt: "2" });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(reruns(calls())).toEqual([]);
    expect(marks()).toEqual(["902 stuck"]);
    expect(comments(calls())).toEqual([["issue", "comment", "902", "--body", expect.stringContaining(`@${OWNER} the slice run ended red`)]]);
    const [[, , , , body = ""] = []] = comments(calls());
    expect(body).toContain(`${RUN_URL}/attempts/1`);
    expect(body).toContain(`${RUN_URL}/attempts/2`);
    expect(body).toMatch(/look at the re-run.*take `stuck` off once the cause is fixed/i);
  });

  it("says a second attempt its time limit cancelled ran out of time", () => {
    const { calls, run } = rerunning({ attempt: "2", jobs: [{ conclusion: "cancelled", annotations: [ownerCall("902", "the slice run"), { message: OUT_OF_TIME }] }] });

    expect(run().status).toBe(0);
    expect(comments(calls())).toEqual([["issue", "comment", "902", "--body", expect.stringContaining("the slice run ran out of time")]]);
  });

  it.each(HELD)("does nothing on a second attempt when the issue is already labelled %s", (held) => {
    const { calls, marks, run } = rerunning({ attempt: "2", labels: ["spec", held] });

    expect(run().status).toBe(0);
    expect(marks()).toEqual([]);
    expect(comments(calls())).toEqual([]);
  });

  it("still labels the issue through gh and comments when bin/mark refuses", () => {
    const { calls, run } = rerunning({ attempt: "2", markRefused: "mark: #902 not labelled stuck: HTTP 403" });

    expect(run().status).toBe(0);
    expect(calls()).toContainEqual(["issue", "edit", "902", "--add-label", "stuck"]);
    expect(comments(calls())).toHaveLength(1);
  });

  it("ends red naming GitHub's refusal when the re-run is refused", () => {
    const result = rerunning({ refused: "HTTP 403: Resource not accessible by integration" }).run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Resource not accessible by integration");
  });

  it("calls the owner once for each issue whose job stopped, as a run with two stage jobs can", () => {
    const { marks, run } = rerunning({ attempt: "2", jobs: [red(), { conclusion: "failure", annotations: [ownerCall("903", "the done check run")] }] });

    expect(run().status).toBe(0);
    expect(marks()).toEqual(["902 stuck", "903 stuck"]);
  });
});

describe("bin/rerun waits for the run it names, and a red run hands itself to it by dispatching the caller file it runs under, since that file cannot hear itself (#1225)", () => {
  it("waits for the named attempt to complete before reading its jobs, then re-runs it as before", () => {
    const { calls, run } = rerunning({ pending: 2 });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(polls(calls())).toHaveLength(3);
    const read = calls().findIndex((args) => args.some((arg) => arg.endsWith("/jobs?per_page=100")));
    expect(calls().slice(read).some((args) => polls([args]).length > 0)).toBe(false);
    expect(reruns(calls())).toHaveLength(1);
  });

  it.each([
    ["1", "2"],
    ["2", "3"],
  ])("neither re-runs nor marks attempt %s once the run is already on attempt %s, so two hand-offs of one run act once", (attempt, latest) => {
    const { calls, marks, run } = rerunning({ attempt, latest });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`run 4417 is already on attempt ${latest}`);
    expect(reruns(calls())).toEqual([]);
    expect(marks()).toEqual([]);
    expect(comments(calls())).toEqual([]);
  });

  it.each([
    ["", "machine.yml"],
    ["collod873/Lumaria/.github/workflows/robot.yml@refs/heads/main", "robot.yml"],
  ])("dispatches the caller file named by %j, or under No caller, same file the one bin/enrol writes, naming the run and attempt to re-run", (calledFrom, file) => {
    const { calls, dispatch } = rerunning({ calledFrom });

    const result = dispatch();

    expect(result.status, result.stderr).toBe(0);
    expect(dispatches(calls())).toEqual([["workflow", "run", file, "-f", "ticket=902", "-f", `reason=Run ${RUN_URL} ended red on attempt 1`, "-f", "rerun=4417/1"]]);
    expect(reruns(calls())).toEqual([]);
    expect(polls(calls())).toEqual([]);
  });

  it("logs a refused dispatch without ending red, as a caller bin/enrol has not yet rewritten refuses the rerun input", () => {
    const { dispatch } = rerunning({ dispatchRefused: "could not create workflow dispatch event: HTTP 422: Unexpected inputs provided: [\"rerun\"]" });

    const result = dispatch();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("rerun: run 4417 could not be handed to machine.yml, so it is not re-run: could not create workflow dispatch event: HTTP 422");
  });
});

describe("the rerun job hands a dispatched red run to bin/rerun, no other workflow here calling the owner, and the caller file never hears itself, which GitHub refuses (#1178, #1220, #1225)", () => {
  const workflows = join(import.meta.dirname, "..", ".github", "workflows");
  const read = (file: string) => parse(readFileSync(join(workflows, file), "utf8")) as { name: string; on: Record<string, { workflows?: string[]; types?: string[] } | null>; jobs: Record<string, { if?: string; needs?: string[]; steps?: WorkflowStep[] }> };
  const caller = read("machine.yml");
  const job = read("tickets.yml").jobs.rerun;
  const step = job?.steps?.find(({ run }) => (run ?? "").includes("bin/rerun"));

  it("leaves no workflow of this repo calling the owner but the reusable ones, and keeps the caller file's own name out of what it hears", () => {
    const calling = readdirSync(workflows)
      .filter((file) => readFileSync(join(workflows, file), "utf8").includes("./.github/actions/call-owner"))
      .map(read)
      .filter((flow) => !Object.hasOwn(flow.on, "workflow_call"))
      .map(({ name }) => name);

    expect(calling).toEqual([]);
    expect(caller.on.workflow_run?.types).toEqual(["completed"]);
    expect(caller.on.workflow_run?.workflows).not.toContain(caller.name);
  });

  it("runs only on a dispatch naming a run to re-run, never on a heard run, and hands the run and attempt that dispatch names to bin/rerun", () => {
    expect(holds(job?.if ?? "", { event: "workflow_dispatch", inputs: { ticket: "902", reason: "red", rerun: "4417/1" } })).toBe(true);
    expect(holds(job?.if ?? "", { event: "workflow_dispatch", inputs: { ticket: "902", reason: "red" } })).toBe(false);
    for (const conclusion of ["failure", "cancelled", "timed_out"]) expect(holds(job?.if ?? "", { event: "workflow_run", conclusion, own: true }), conclusion).toBe(false);
    expect(step?.run).toBe('bin/rerun "${RERUN%/*}" "${RERUN#*/}"');
    expect(step?.env).toMatchObject({ RERUN: "${{ github.event.inputs.rerun }}" });
  });

  it.each(["tickets.yml", "specs.yml"])("ends %s with a job that needs every stage job and hands its own run and attempt to bin/rerun --dispatch under the caller file", (file) => {
    const { jobs } = read(file);
    const handing = Object.entries(jobs).filter(([, { steps }]) => (steps ?? []).some(({ run }) => (run ?? "").includes("bin/rerun --dispatch")));

    expect(handing.map(([name]) => name)).toEqual(["dispatch-rerun"]);
    const [[, dispatcher] = ["", {}]] = handing;
    expect(dispatcher.needs?.slice().sort()).toEqual(Object.keys(jobs).filter((name) => !["rerun", "dispatch-rerun"].includes(name)).sort());
    expect(Object.keys(jobs).at(-1)).toBe("dispatch-rerun");
    const ran = dispatcher.steps?.find(({ run }) => (run ?? "").includes("bin/rerun --dispatch"));
    expect(ran?.run).toBe('bin/rerun --dispatch "$RUN" "$ATTEMPT"');
    expect(ran?.env).toMatchObject({ RUN: "${{ github.run_id }}", ATTEMPT: "${{ github.run_attempt }}", CALLED_FROM: "${{ github.workflow_ref }}" });
  });
});
