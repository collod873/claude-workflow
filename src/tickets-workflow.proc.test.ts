import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { execute, holds, scratch, script, workflowJobs, type WorkflowStep } from "./scenarios.ts";
import { MACHINE, OWNER } from "./spelled.ts";

const REPO = join(import.meta.dirname, "..");
const CALLER = join(REPO, ".github", "caller.yml");
const TICKETS = join(REPO, ".github", "workflows", "tickets.yml");
const APP = "${{ steps.app.outputs.token }}";

interface Caller {
  name: string;
  on: Record<string, unknown>;
  jobs: Record<string, Record<string, unknown>>;
}

const caller = () => parse(readFileSync(CALLER, "utf8")) as Caller;

interface Fired {
  event: string;
  action?: string;
  sender?: string;
  conclusion?: string;
  fork?: boolean;
  red?: string[];
  outputs?: Record<string, Record<string, string>>;
}

function jobsRun({ red = [], outputs = {}, ...fired }: Fired): string[] {
  const results: Record<string, { result: string; outputs?: Record<string, string> }> = {};
  for (const [name, job] of Object.entries(workflowJobs("tickets.yml"))) {
    const needs = Object.fromEntries([job.needs ?? []].flat().map((need) => [need, results[need] ?? { result: "skipped" }]));
    const failed = Object.values(needs).some(({ result }) => result !== "success");
    const ran = holds(job.if ?? "success()", { ...fired, needs, failed });
    results[name] = ran ? { result: red.includes(name) ? "failure" : "success", outputs: outputs[name] ?? {} } : { result: "skipped" };
  }
  return Object.entries(results).flatMap(([name, { result }]) => (result === "skipped" ? [] : [name]));
}

describe("a repo's tickets build through one caller file that holds only triggers and the call (#1135)", () => {
  it("holds a name, its triggers and one job that calls tickets.yml on this repo's main with the caller's secrets, and nothing else", () => {
    const { name, on, jobs, ...rest } = caller();

    expect(rest).toEqual({});
    expect(typeof name).toBe("string");
    expect(Object.keys(on).sort()).toEqual(["issues", "pull_request_target", "push", "workflow_dispatch", "workflow_run"]);
    expect(Object.values(jobs)).toEqual([{ uses: "collod873/claude-workflow/.github/workflows/tickets.yml@main", secrets: "inherit" }]);
  });

  it("answers each trigger the caller holds: a ticket opened builds, a closed issue or PR is stripped and closed, a merge or a finished CI run lands the queue", () => {
    expect(jobsRun({ event: "issues", action: "opened" })).toEqual(["build"]);
    expect(jobsRun({ event: "issues", action: "reopened" })).toEqual(["build"]);
    expect(jobsRun({ event: "issues", action: "unlabeled", sender: MACHINE })).toEqual(["build"]);
    expect(jobsRun({ event: "issues", action: "opened", sender: "stranger" })).toEqual([]);
    expect(jobsRun({ event: "issues", action: "closed" })).toEqual(["close", "strip"]);
    expect(jobsRun({ event: "pull_request_target", action: "closed" })).toEqual(["close", "strip"]);
    expect(jobsRun({ event: "push", action: "" })).toEqual(["close"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "success" })).toEqual(["close"]);
  });

  it("hands a ticket back to its builder when the caller's own CI ends red on its branch, when its build ends red, or when the closer dispatches the caller", () => {
    const named = { which: { ticket: "828" } };

    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "failure", outputs: named })).toEqual(["which", "fix", "close"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "timed_out", outputs: named })).toEqual(["which", "fix", "close"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "failure", fork: true, outputs: named })).toEqual(["close"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "failure", outputs: { which: { ticket: "" } } })).toEqual(["which", "close"]);
    expect(jobsRun({ event: "issues", action: "opened", sender: OWNER, red: ["build"], outputs: named })).toEqual(["build", "which", "fix"]);
    expect(jobsRun({ event: "workflow_dispatch", action: "", outputs: named })).toEqual(["which", "fix"]);
  });

  it("checks the machine out at the workspace and the caller's tree apart under tree/, and makes every GitHub call with the App's token", () => {
    const text = readFileSync(TICKETS, "utf8");
    const { permissions, jobs } = parse(text) as { permissions: unknown; jobs: Record<string, { env?: Record<string, string> }> };

    expect(permissions).toEqual({});
    for (const [name, job] of Object.entries(jobs)) expect(job.env?.GH_REPO, name).toBe("${{ github.repository }}");
    expect(text).not.toMatch(/github\.token|secrets\.GITHUB_TOKEN/);
    for (const [name, { steps }] of Object.entries(workflowJobs("tickets.yml"))) {
      const [app, machine] = steps;
      expect(app?.uses, name).toMatch(/^actions\/create-github-app-token@/);
      expect(app?.with?.owner, name).toBe("${{ github.repository_owner }}");
      expect(machine?.uses, name).toMatch(/^actions\/checkout@/);
      expect(machine?.with, name).toMatchObject({ repository: "${{ github.repository_owner }}/claude-workflow", ref: "main", token: APP });
      expect(machine?.with?.path, name).toBeUndefined();
      for (const step of steps.slice(2).filter((later) => later.uses?.startsWith("actions/checkout@") === true)) expect(step.with, name).toMatchObject({ path: "tree", token: APP });
      for (const step of steps.filter((later) => later.env !== undefined)) {
        for (const token of ["GH_TOKEN", "QUIET_GH_TOKEN"]) if (step.env?.[token] !== undefined) expect(step.env[token], `${name} ${step.id ?? ""}`).toBe(APP);
      }
      for (const step of steps.filter((later) => later.uses?.startsWith("./.github/actions/call-owner") === true)) expect(step.with?.token, name).toBe(APP);
      for (const step of steps.filter((later) => (later.run ?? "").includes("$GITHUB_WORKSPACE/bin/"))) expect((step as WorkflowStep & { "working-directory"?: string })["working-directory"], `${name} ${step.id ?? ""}`).toBe("tree");
    }
  });

  it("tells the closer which caller file it runs under, so a builder it wakes starts through that file", () => {
    const closing = workflowJobs("tickets.yml").close?.steps.find(({ run }) => (run ?? "").includes("bin/close"));

    expect(closing?.env?.CALLED_FROM).toBe("${{ github.workflow_ref }}");
    expect(caller().on.workflow_dispatch).toEqual({ inputs: { ticket: { required: true, type: "string" }, reason: { required: true, type: "string" } } });
  });

  it("tells the builder of a red build which run went red, since that run is still going and its log cannot be read yet", () => {
    const fixing = workflowJobs("tickets.yml").fix?.steps.find(({ id }) => id === "fix");

    expect(fixing?.env?.REASON).toMatch(/format\('The build of #\{0\} ended red: \{1\}\/\{2\}\/actions\/runs\/\{3\}'.*\) \|\| ''\) \}\}$/);
  });

  describe("names the ticket a red run hands back", () => {
    const which = workflowJobs("tickets.yml").which?.steps.find(({ id }) => id === "which");
    const named = (env: Record<string, string>, labels = "") => {
      const root = scratch("which-");
      script(join(root, "bin", "gh"), `printf '%s\\n' ${labels === "" ? "" : `'${labels}'`}\n`);
      const output = join(root, "output");
      const ran = execute("bash", REPO, { PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`, GITHUB_OUTPUT: output, DISPATCHED: "", BUILT: "", RAN_ON: "", ...env }, ["-e", "-c", which?.run ?? ""]);
      expect(ran.status, ran.stderr).toBe(0);
      return readFileSync(output, "utf8").trim().split("\n");
    };

    it("by the ticket branch the caller's CI ran on, and by nothing on any other branch", () => {
      expect(named({ RAN_ON: "ticket/828" })).toEqual(["ticket=828", "branch=ticket/828"]);
      expect(named({ RAN_ON: "main" })).toEqual(["ticket="]);
      expect(named({ RAN_ON: "ticket/828x" })).toEqual(["ticket="]);
    });

    it("by the issue its red build was opened on, or the ticket the closer dispatched", () => {
      expect(named({ BUILT: "830" })).toEqual(["ticket=830", "branch=ticket/830"]);
      expect(named({ DISPATCHED: "831" }, "needs-human")).toEqual(["ticket=831", "branch=ticket/831"]);
    });

    it("by nothing when its builder already called the owner", () => {
      expect(named({ RAN_ON: "ticket/828" }, "needs-human")).toEqual(["ticket="]);
      expect(named({ BUILT: "830" }, "needs-human")).toEqual(["ticket="]);
    });
  });
});
