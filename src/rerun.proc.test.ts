import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CANCELLED_BY_OWNER, OUT_OF_TIME, ownerCall, red, rerunning, RUN_URL } from "./rerun.part.ts";
import { holds, type WorkflowStep } from "./scenarios.ts";
import { HELD, OWNER } from "./spelled.ts";

const reruns = (calls: string[][]) => calls.filter((args) => args.some((arg) => arg.endsWith("/rerun-failed-jobs")));
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

describe("rerun.yml hears every stage workflow that calls the owner complete, and hands its red runs to bin/rerun (#1178)", () => {
  const workflows = join(import.meta.dirname, "..", ".github", "workflows");
  const read = (file: string) => parse(readFileSync(join(workflows, file), "utf8")) as { name: string; on: Record<string, { workflows?: string[]; types?: string[] } | null>; jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps: WorkflowStep[] }> };
  const { on, jobs } = read("rerun.yml");
  const [job] = Object.values(jobs);
  const step = job?.steps.find(({ run }) => (run ?? "").includes("bin/rerun"));

  it("names each workflow of this repo whose job calls the owner, the reusable ones being heard through the caller file instead", () => {
    const calling = readdirSync(workflows)
      .filter((file) => readFileSync(join(workflows, file), "utf8").includes("./.github/actions/call-owner"))
      .map(read)
      .filter((flow) => !Object.hasOwn(flow.on, "workflow_call"))
      .map(({ name }) => name);

    expect(calling.length).toBeGreaterThan(0);
    expect(Object.keys(on)).toEqual(["workflow_run"]);
    expect(on.workflow_run?.types).toEqual(["completed"]);
    expect([...(on.workflow_run?.workflows ?? [])].sort()).toEqual(calling.sort());
  });

  it("runs on a run that ended red, cancelled or timed out, and not on one that passed or was skipped", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out"]) expect(holds(job?.if ?? "", { event: "workflow_run", conclusion }), conclusion).toBe(true);
    for (const conclusion of ["success", "skipped"]) expect(holds(job?.if ?? "", { event: "workflow_run", conclusion }), conclusion).toBe(false);
    expect(step?.run).toBe('bin/rerun "$RUN" "$ATTEMPT"');
    expect(step?.env).toMatchObject({ RUN: "${{ github.event.workflow_run.id }}", ATTEMPT: "${{ github.event.workflow_run.run_attempt }}" });
    expect(job?.permissions).toMatchObject({ actions: "write", checks: "read", issues: "write" });
  });
});
