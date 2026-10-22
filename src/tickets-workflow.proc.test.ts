import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { fixing } from "./builder.part.ts";
import { closing } from "./closer.part.ts";
import { execute, heldBy, holds, labelledAs, labelledStep, onPath, scratch, script, workflowJobs, type WorkflowStep } from "./scenarios.ts";
import { HELD, MACHINE, OWNER } from "./spelled.ts";
import { ENROLLED_CALLER, ENROLLED_REVIEW } from "./post.ts";

const REPO = join(import.meta.dirname, "..");
const CALLER = join(REPO, ".github", "caller.yml");
const WORKFLOWS = join(REPO, ".github", "workflows");
const TICKETS = join(WORKFLOWS, "tickets.yml");
const APP = "${{ steps.app.outputs.token }}";
const PINNED = join(REPO, ".github", "actions", "pinned", "action.yml");
const DATABASE = join(REPO, ".github", "actions", "database", "action.yml");

interface Caller {
  name: string;
  "run-name": string;
  on: Record<string, unknown>;
  jobs: Record<string, Record<string, unknown>>;
}

const CALLED = ["tickets.yml", "specs.yml"];

type WorkflowJob = ReturnType<typeof workflowJobs>[string];
const caller = () => parse(readFileSync(CALLER, "utf8")) as Caller;

interface Fired {
  event: string;
  action?: string;
  sender?: string;
  conclusion?: string;
  fork?: boolean;
  own?: boolean;
  home?: boolean;
  inputs?: Record<string, string>;
  red?: string[];
  stopped?: string[];
  outputs?: Record<string, Record<string, string>>;
}

function declared({ event, action = "" }: Fired): void {
  const trigger = caller().on[event] as { types?: string[]; workflows?: string[] } | null | undefined;
  expect(Object.keys(caller().on), `the caller file declares ${event}`).toContain(event);
  if (trigger?.types !== undefined) expect(trigger.types, `the caller file declares ${event} ${action}`).toContain(action);
  if (event === "workflow_run") expect(trigger?.workflows?.length, "the caller file names the CI it hands back from").toBeGreaterThan(0);
}

function builders() {
  const builds = Object.entries(workflowJobs("tickets.yml")).filter(([, { steps }]) => steps.some(({ run }) => (run ?? "").includes("bin/fix")));
  expect(builds.map(([name]) => name).sort()).toEqual(["build", "fix"]);
  return builds.map(([name, { steps }]) => ({ name, steps, at: (found: (step: WorkflowStep) => boolean) => steps.findIndex(found) }));
}

function jobsRun({ red = [], stopped = [], outputs = {}, ...fired }: Fired, file = "tickets.yml"): string[] {
  declared(fired);
  const results: Record<string, { result: string; outputs?: Record<string, string> }> = {};
  for (const [name, job] of Object.entries(workflowJobs(file))) {
    const needs = Object.fromEntries([job.needs ?? []].flat().map((need) => [need, results[need] ?? { result: "skipped" }]));
    const failed = Object.values(needs).some(({ result }) => result !== "success");
    const ran = holds(job.if ?? "success()", { ...fired, needs, failed });
    results[name] = ran ? { result: red.includes(name) ? "failure" : stopped.includes(name) ? "cancelled" : "success", outputs: outputs[name] ?? {} } : { result: "skipped" };
  }
  return Object.entries(results).flatMap(([name, { result }]) => (result === "skipped" ? [] : [name]));
}

describe("a repo's tickets build through one caller file that holds only triggers and the call (#1135)", () => {
  it("holds a name, its triggers and the jobs that call tickets.yml and specs.yml on this repo's main with the caller's secrets, and nothing else (#1151)", () => {
    const { name, on, jobs, "run-name": runName, ...rest } = caller();

    expect(rest).toEqual({});
    expect(typeof runName).toBe("string");
    expect(typeof name).toBe("string");
    expect(Object.keys(on).sort()).toEqual(["issue_comment", "issues", "pull_request_target", "push", "workflow_dispatch", "workflow_run"]);
    expect(on.issue_comment).toEqual({ types: ["created"] });
    expect(Object.values(jobs)).toEqual(CALLED.map((file) => ({ uses: `collod873/claude-workflow/.github/workflows/${file}@main`, secrets: "inherit" })));
  });

  it("answers each trigger the caller holds: a ticket opened builds, a closed issue or PR is stripped and closed, a merge or a finished CI run lands the queue", () => {
    expect(jobsRun({ event: "issues", action: "opened" })).toEqual(["build"]);
    expect(jobsRun({ event: "issues", action: "reopened" })).toEqual(["build"]);
    expect(jobsRun({ event: "issues", action: "unlabeled", sender: MACHINE })).toEqual(["build"]);
    expect(jobsRun({ event: "issues", action: "opened", sender: "stranger" })).toEqual([]);
    expect(jobsRun({ event: "issues", action: "closed" })).toEqual(["close", "strip"]);
    expect(jobsRun({ event: "pull_request_target", action: "closed" })).toEqual(["close", "strip"]);
    expect(jobsRun({ event: "push", action: "" })).toEqual(["close"]);
    expect(jobsRun({ event: "push", action: "", home: true })).toEqual(["close", "enrol"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "success" })).toEqual(["close"]);
  });

  it("judges a PR opened, reopened or pushed in every repo, this one included, with the reviewer and the meter reviewer, then lands the queue once its review is green (#1285, #1386)", () => {
    for (const home of [false, true]) {
      for (const action of ["opened", "synchronize", "reopened"]) expect(jobsRun({ event: "pull_request_target", action, home }), `${action} home ${String(home)}`).toEqual(["review", "meters", "close"]);
      expect(jobsRun({ event: "pull_request_target", action: "opened", fork: true, home })).toEqual([]);
    }
  });

  it("wakes the closer once for a head the machine pushed, on its review going green, and not again when the CI that skipped its check job completes (#1386)", () => {
    for (const home of [false, true]) {
      const events = [
        { event: "pull_request_target", action: "synchronize", sender: MACHINE, home },
        { event: "workflow_run", action: "completed", conclusion: "success", sender: MACHINE, home },
      ];

      expect(events.flatMap((fired) => jobsRun(fired)).filter((job) => job === "close"), `home ${String(home)}`).toEqual(["close"]);
    }
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "success", sender: OWNER }), "a head the owner pushed is green only once its check job ends").toEqual(["close"]);
  });

  it("enrols this repo too on a push to its main, beside every repo the App reaches that holds the caller file, so the home swap follows the move within a minute (#1386)", () => {
    const step = workflowJobs("tickets.yml").enrol?.steps.find(({ run }) => /bin\/enrol\b/.test(run ?? ""));
    const root = scratch("enrol-step-");
    const calls = join(root, "calls");
    script(join(root, "path", "gh"), ['case "$*" in', "  \"api installation/repositories\"*) printf '%s\\n' collod873/claude-workflow collod873/Lumaria collod873/PW-Onboarding ;;", "  *PW-Onboarding/contents*) exit 1 ;;", "esac", ""].join("\n"));
    script(join(root, "bin", "enrol"), `printf '%s\\n' "$*" >>"${calls}"\n`);

    const ran = execute("bash", root, { PATH: `${join(root, "path")}:${process.env.PATH}`, GITHUB_REPOSITORY: "collod873/claude-workflow" }, ["-e", "-c", step?.run ?? ""]);

    expect(ran.status).toBe(0);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["collod873/claude-workflow --caller", "collod873/Lumaria --caller"]);
  });

  it("hands a ticket PR back to its builder when its review in an enrolled repo ends red, landing nothing (#1285)", () => {
    expect(jobsRun({ event: "pull_request_target", action: "synchronize", red: ["review"], outputs: { which: { ticket: "828" } } })).toEqual(["review", "meters", "which", "fix"]);
  });

  it("re-runs a review that stopped at a machine fault once, through the owner call it leaves, and hands nothing to the builder (#1317)", () => {
    const faulted = { event: "pull_request_target", action: "synchronize", red: ["review"], outputs: { review: { fault: "true" }, which: { ticket: "828" } } };
    const reviewJob = workflowJobs("tickets.yml").review;

    expect(jobsRun(faulted)).toEqual(["review", "meters", "dispatch-rerun"]);
    expect(reviewJob?.steps.find(({ uses }) => uses === "./.github/actions/call-owner")?.if).toBe("failure() && steps.review.outputs.fault == 'true'");
  });

  it("names the review the closer waits on in an enrolled repo as GitHub names it: the caller's job calling tickets.yml, then the job that runs bin/review (#1285)", () => {
    const [calling] = Object.entries(caller().jobs).find(([, job]) => String(job.uses).includes("/tickets.yml@")) ?? [];
    const [reviewing] = Object.entries(workflowJobs("tickets.yml")).find(([, { steps }]) => steps.some(({ run }) => /bin\/review\b/.test(run ?? ""))) ?? [];

    expect(`${calling} / ${reviewing}`).toBe(ENROLLED_REVIEW);
  });

  it("hands a ticket back to its builder when the caller's own CI ends red on its branch, when its build ends red, or when the closer dispatches the caller", () => {
    const named = { which: { ticket: "828" } };

    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "failure", outputs: named })).toEqual(["which", "fix", "close"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "timed_out", outputs: named })).toEqual(["which", "fix", "close"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "failure", fork: true, outputs: named })).toEqual(["close"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "failure", outputs: { which: { ticket: "" } } })).toEqual(["which", "close"]);
    expect(jobsRun({ event: "issues", action: "opened", sender: OWNER, red: ["build"], outputs: named })).toEqual(["build", "which", "fix", "dispatch-rerun"]);
    expect(jobsRun({ event: "workflow_dispatch", action: "", outputs: named })).toEqual(["which", "fix"]);
  });

  it("hands a run whose stage job ended red, was cancelled or timed out to a dispatch of the caller file, and on that dispatch only re-runs it or calls the owner, no build, fix or size trial starting (#1225)", () => {
    const named = { which: { ticket: "828" } };
    const handed = { event: "workflow_dispatch", action: "", inputs: { ticket: "828", reason: "red", rerun: "4417/1" }, outputs: named };

    expect((caller().on.workflow_run as { workflows: string[] }).workflows).not.toContain(caller().name);
    expect(jobsRun({ event: "issues", action: "opened", sender: OWNER, red: ["build"], outputs: named })).toEqual(["build", "which", "fix", "dispatch-rerun"]);
    expect(jobsRun({ event: "workflow_run", action: "completed", conclusion: "failure", red: ["fix"], outputs: named })).toEqual(["which", "fix", "close", "dispatch-rerun"]);
    expect(jobsRun({ event: "push", action: "", stopped: ["close"] })).toEqual(["close", "dispatch-rerun"]);
    expect(jobsRun({ event: "issues", action: "opened", sender: OWNER, red: ["slice"] }, "specs.yml")).toEqual(["slice", "research", "dispatch-rerun"]);
    expect(jobsRun({ event: "issues", action: "opened", sender: OWNER }, "specs.yml")).toEqual(["slice", "research"]);
    expect(jobsRun(handed)).toEqual(["rerun"]);
    expect(jobsRun({ ...handed, inputs: { ...handed.inputs, trial_cap: "60000" } }, "specs.yml")).toEqual([]);
    expect(jobsRun(handed, "specs.yml")).toEqual([]);
    expect(jobsRun({ ...handed, red: ["rerun"] })).toEqual(["rerun"]);
    for (const conclusion of ["failure", "cancelled", "timed_out"]) expect(jobsRun({ event: "workflow_run", action: "completed", conclusion, own: true }), conclusion).not.toContain("rerun");
  });

  it("carries the optional rerun input in the caller bin/enrol writes and in this repo's caller, beside the ticket and reason every dispatch fills (#1225)", () => {
    const inputs = (text: string) => (parse(text) as { on: { workflow_dispatch: { inputs: Record<string, unknown> } } }).on.workflow_dispatch.inputs;

    for (const text of [readFileSync(CALLER, "utf8"), readFileSync(join(WORKFLOWS, ENROLLED_CALLER), "utf8")]) {
      expect(inputs(text)).toMatchObject({ rerun: { required: false }, ticket: { required: true }, reason: { required: true } });
    }
  });

  it("runs the size trial a dispatch with a trial cap names on its spec, starting no builder, with the re-slice job's checkouts and caps (#1216)", () => {
    const trial = { event: "workflow_dispatch", action: "", inputs: { ticket: "968", reason: "size-trial", trial_cap: "60000" }, outputs: { which: { ticket: "968" } } };
    const { "size-trial": sizeTrial, reslice } = workflowJobs("specs.yml");
    const checkouts = (job?: WorkflowJob) => job?.steps.filter(({ uses }) => uses?.startsWith("actions/checkout@") === true);
    const step = (job: WorkflowJob | undefined, id: string) => job?.steps.find((one) => one.id === id);

    expect(jobsRun(trial)).toEqual([]);
    expect(jobsRun(trial, "specs.yml")).toEqual(["size-trial"]);
    expect(jobsRun({ ...trial, inputs: { ticket: "828", reason: "PR red" } }, "specs.yml")).toEqual([]);
    expect(step(sizeTrial, "size-trial")?.run).toContain('"$GITHUB_WORKSPACE/bin/slice" --size-trial "$SPEC" "$TRIAL_CAP"');
    expect(step(sizeTrial, "size-trial")?.env).toMatchObject({ SPEC: "${{ github.event.inputs.ticket }}", TRIAL_CAP: "${{ github.event.inputs.trial_cap }}" });
    expect(sizeTrial?.concurrency).toEqual({ group: "size-trial-${{ github.event.inputs.ticket }}", "cancel-in-progress": false });
    expect(checkouts(sizeTrial)).toEqual(checkouts(reslice));
    expect(sizeTrial?.["timeout-minutes"]).toBe(reslice?.["timeout-minutes"]);
    expect(step(sizeTrial, "size-trial")?.["timeout-minutes"]).toBe(step(reslice, "reslice")?.["timeout-minutes"]);
    expect(step(sizeTrial, "size-trial")?.env?.STAGE_MINUTES).toBe(step(reslice, "reslice")?.env?.STAGE_MINUTES);
  });

  describe("runs a probe a dispatch names in the builder's own environment, and nothing else (#1251)", () => {
    const probed = { event: "workflow_dispatch", action: "", inputs: { ticket: "0", reason: "probe", probe: "check" }, outputs: { which: { ticket: "0" } } };
    const steps = () => workflowJobs("tickets.yml").probe?.steps ?? [];
    const step = (id: string) => steps().find((one) => one.id === id);
    const readying = (job: string) =>
      (workflowJobs("tickets.yml")[job]?.steps ?? [])
        .filter(({ id }) => ["checkout", "setup-node", "pinned", "npm-ci", "database", "logs", "stage"].includes(id ?? ""))
        .map(({ if: _when, with: given, ...rest }) => ({ ...rest, with: { ...given, "persist-credentials": undefined } }));

    it("starts the probe job alone, whether it ends green or red, so no builder, fix, rerun or size trial starts and no owner is called", () => {
      expect(jobsRun(probed)).toEqual(["probe"]);
      expect(jobsRun({ ...probed, red: ["probe"] })).toEqual(["probe"]);
      expect(jobsRun(probed, "specs.yml")).toEqual([]);
      expect(steps().filter(({ uses }) => uses?.startsWith("./.github/actions/call-owner") === true)).toEqual([]);
    });

    it("readies the tree with the build job's own steps, keeping no token in the tree's checkout", () => {
      expect(readying("probe").map(({ uses, id }) => uses ?? id)).toEqual(readying("build").map(({ uses, id }) => uses ?? id));
      expect(step("checkout")?.with?.["persist-credentials"]).toBe(false);
    });

    it("runs a script probe by default and a claude probe when probe_with names claude, handing neither a GitHub token", () => {
      const ran = (probeWith: string | undefined) => ["probe-script", "probe-claude"].filter((id) => holds(step(id)?.if ?? "success()", { inputs: probeWith === undefined ? {} : { probe_with: probeWith } }));

      expect(ran(undefined)).toEqual(["probe-script"]);
      expect(ran("script")).toEqual(["probe-script"]);
      expect(ran("claude")).toEqual(["probe-claude"]);
      for (const id of ["probe-script", "probe-claude"]) expect(Object.keys(step(id)?.env ?? {}).filter((name) => /GH_TOKEN|GITHUB_TOKEN/.test(name)), id).toEqual([]);
      expect(step("probe-script")?.env?.PROBE).toBe("${{ github.event.inputs.probe }}");
    });
  });

  it("takes from a dispatch exactly the inputs the closer sends and tickets.yml reads", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "909", ticket: "830", conflicts: true }], calledFrom: "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" });
    expect(run().status).toBe(0);
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nmachine.yml\n")) ?? "";
    const sent = [...wake.matchAll(/^-f\n(\w+)=/gm)].map(([, input]) => input ?? "");
    const read = [...new Set(CALLED.flatMap((file) => [...readFileSync(join(REPO, ".github", "workflows", file), "utf8").matchAll(/github\.event\.inputs\.(\w+)/g)].map(([, input]) => input ?? "")))];
    const inputs = Object.entries((caller().on.workflow_dispatch as { inputs: Record<string, { required: boolean }> }).inputs);

    expect(sent.sort()).toEqual(inputs.filter(([, { required }]) => required).map(([input]) => input).sort());
    expect(read.sort()).toEqual(inputs.map(([input]) => input).sort());
  });

  it.each(CALLED)("%s checks the machine out at the workspace and the caller's tree apart under tree/, and makes every GitHub call with the App's token", (file) => {
    const text = readFileSync(join(REPO, ".github", "workflows", file), "utf8");
    const { on, permissions, jobs } = parse(text) as { on: unknown; permissions: unknown; jobs: Record<string, { env?: Record<string, string> }> };

    expect(on).toEqual({ workflow_call: null });
    expect(permissions).toEqual({});
    for (const [name, job] of Object.entries(jobs)) expect(job.env?.GH_REPO, name).toBe("${{ github.repository }}");
    expect(text).not.toMatch(/github\.token|secrets\.GITHUB_TOKEN/);
    for (const [name, { steps }] of Object.entries(workflowJobs(file))) {
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

  it("readies a tree for the closer's full check only in the update job, which runs once the quick close hands it a PR to bring up to date, so a close run with nothing to update pays nothing for it (#1345, #1428)", () => {
    const readies = ({ uses, id }: WorkflowStep) => ["./.github/actions/hooks", "./.github/actions/pinned", "./.github/actions/database"].includes(uses ?? "") || id === "git-config";
    const { close, update } = workflowJobs("tickets.yml");
    const steps = update?.steps ?? [];
    const updating = steps.findIndex(({ run }) => (run ?? "").includes("bin/close\" queue"));
    const runs = (handed: string) => holds(update?.if ?? "true", { needs: { close: { result: "success", outputs: { update: handed } } } });

    expect(close?.steps.filter(readies)).toEqual([]);
    expect(close?.steps.find(({ run }) => (run ?? "").includes("bin/close"))?.env?.QUICK_LANE).toBe("true");
    expect(steps.filter(readies).length).toBe(4);
    expect(steps.filter(readies).every((step) => steps.indexOf(step) < updating)).toBe(true);
    expect(runs("true")).toBe(true);
    expect(runs("")).toBe(false);
  });

  it("tells the closer which caller file it runs under, so a builder it wakes starts through that file", () => {
    const closing = workflowJobs("tickets.yml").close?.steps.find(({ run }) => (run ?? "").includes("bin/close"));

    expect(closing?.env?.CALLED_FROM).toBe("${{ github.workflow_ref }}");
  });

  it("tells each builder it runs in a tree that is not the machine's, so a machine fault is filed here and not landed on the tree's main (#1143)", () => {
    const builders = ["build", "fix"].map((job) => workflowJobs("tickets.yml")[job]?.steps.find(({ id }) => id === "fix"));

    expect(builders.map((step) => step?.env?.CALLED_FROM)).toEqual(["${{ github.workflow_ref }}", "${{ github.workflow_ref }}"]);
  });

  it("ends taking waiting off Lumaria #828 with its PR open in Lumaria: the build job starts and holds, its fix step runs, and the builder, given the repo and caller the workflow resolves there, opens the PR through the real check and save (#1146)", async () => {
    const unlabeled = { action: "unlabeled", label: "waiting", sender: MACHINE, labels: ["ticket"] };
    const job = workflowJobs("tickets.yml").build;
    const fix = job?.steps.find(({ id }) => id === "fix");
    const { held } = await heldBy(labelledStep("tickets.yml", "build"), REPO, unlabeled);
    const steps = { ...labelledAs(job?.steps ?? [], held), admit: { outcome: "success", conclusion: "success", outputs: { admitted: "true" } }, start: { outcome: "success", conclusion: "success", outputs: { branch: "ticket/828" } } };
    const lumaria: Record<string, string> = { "github.repository": "collod873/Lumaria", "github.workflow_ref": "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" };
    const resolved = (value: unknown) => (typeof value !== "string" ? undefined : value.replace(/^\$\{\{ ([\w.]+) \}\}$/, (_, name: string) => lumaria[name] ?? ""));
    const real = onPath("check");
    const contract = '{ "steps": { "integration": { "run": "true", "needs": ["DATABASE_URL"] } } }\n';
    const check = `env -u DATABASE_URL CI=true "${real}" "$@"\n`;

    expect(holds(job?.if ?? "", unlabeled)).toBe(true);
    expect(held).toBe("true");
    expect(holds(fix?.if ?? "", { steps })).toBe(true);
    const repo = resolved(job?.env?.GH_REPO);
    const calledFrom = resolved(fix?.env?.CALLED_FROM);
    expect({ repo, calledFrom }).toEqual({ repo: lumaria["github.repository"], calledFrom: lumaria["github.workflow_ref"] });
    const { run, opened } = fixing({ ticket: "828", claude: "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n", contract, check, realSave: true, repo, calledFrom });
    const result = run("828");
    expect(result.status, result.stderr).toBe(0);
    expect(opened()).toEqual(["collod873/Lumaria https://github.com/collod873/Lumaria/pull/9828"]);
  });

  it("saves the builder's session from its build and from every red run, which GitHub otherwise gives a read-only cache on an issue or a finished run (#1180)", () => {
    const saving = Object.entries(workflowJobs("tickets.yml")).filter(([, job]) => job.steps.some((step) => step.uses?.startsWith("actions/cache/save@") === true));

    expect(saving.map(([name]) => name)).toEqual(["build", "fix"]);
    for (const [name, job] of saving) {
      expect(job["cache-mode"], `${name} writes the cache`).toBe("write");
      const save = job.steps.find((step) => step.uses?.startsWith("actions/cache/save@") === true);
      const saves = (outcome: string) => holds(save?.if ?? "success()", { steps: { labelled: { outcome: "success", conclusion: "success", outputs: { held: "true" } }, fix: { outcome, conclusion: outcome } }, failed: outcome === "failure" });
      expect([saves("success"), saves("failure"), saves("skipped")], name).toEqual([true, true, false]);
    }
  });

  it("tells the builder of a red build which run went red, since that run is still going and its log cannot be read yet", () => {
    const fixing = workflowJobs("tickets.yml").fix?.steps.find(({ id }) => id === "fix");

    const bound = /format\('The build of #\{0\} ended red: \{1\}\/\{2\}\/actions\/runs\/\{3\}',\s*([^)]*)\)/.exec(String(fixing?.env?.REASON));
    expect((bound?.[1] ?? "").split(",").map((arg) => arg.trim())).toEqual(["needs.which.outputs.ticket", "github.server_url", "github.repository", "github.run_id"]);
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
      expect(named({ DISPATCHED: "831" }, "stuck")).toEqual(["ticket=831", "branch=ticket/831"]);
    });

    it("by nothing when the ticket is paused or stuck (#1166)", () => {
      for (const held of HELD) {
        expect(named({ RAN_ON: "ticket/828" }, held), held).toEqual(["ticket="]);
        expect(named({ BUILT: "830" }, held), held).toEqual(["ticket="]);
      }
    });
  });

  describe("readies the Node and package manager a tree pins for its setup and gate, and keeps the machine on its own Node (#1138)", () => {
    const pinnedSteps = () => (parse(readFileSync(PINNED, "utf8")) as { runs: { steps: (WorkflowStep & { "working-directory"?: string })[] } }).runs.steps;
    const nodes = () => pinnedSteps().filter(({ uses }) => uses?.startsWith("actions/setup-node@") === true);
    const readied = (manifest: Record<string, unknown> | undefined, { stubbed = true, corepack = true } = {}) => {
      const root = scratch("pinned-");
      const calls = join(root, "calls");
      const nodeBin = join(root, "node-bin");
      const githubEnv = join(root, "github-env");
      mkdirSync(join(root, "tree"));
      writeFileSync(githubEnv, "");
      if (manifest !== undefined) writeFileSync(join(root, "tree", "package.json"), JSON.stringify(manifest));
      const npm = `printf 'npm %s\\n' "$*" >>"${calls}"\n`;
      script(join(root, "spare", "corepack"), `printf '%s %s\\n' "$PWD" "$*" >>"${calls}"\n`);
      script(join(nodeBin, "npm"), corepack ? npm : `${npm}cp "${join(root, "spare", "corepack")}" "${nodeBin}/"\n`);
      symlinkSync(process.execPath, join(nodeBin, "node"));
      if (!stubbed) symlinkSync(join(dirname(process.execPath), "corepack"), join(nodeBin, "corepack"));
      else if (corepack) symlinkSync(join(root, "spare", "corepack"), join(nodeBin, "corepack"));
      const step = pinnedSteps().find(({ run }) => run !== undefined);
      const ran = execute("bash", join(root, step?.["working-directory"] ?? ""), { PATH: `${nodeBin}:/usr/bin:/bin`, GITHUB_ENV: githubEnv, COREPACK_HOME: join(root, "corepack-home"), ...(step?.env as Record<string, string>) }, ["-e", "-c", step?.run ?? ""]);
      expect(ran.status, ran.stderr).toBe(0);
      const ranPnpm = () => execute("bash", join(root, "tree"), { PATH: `${/^TREE_PATH=(.*)$/m.exec(readFileSync(githubEnv, "utf8"))?.[1] ?? ""}:/usr/bin:/bin`, COREPACK_HOME: join(root, "corepack-home") }, ["-c", "pnpm --version"]);
      return {
        calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => line.replaceAll(root, "")) : [],
        handed: readFileSync(githubEnv, "utf8").replaceAll(root, ""),
        ranPnpm,
      };
    };

    it("in every job that runs the builder, after the tree is checked out and the machine's own Node, and before anything installs or the builder starts", () => {
      for (const { name, steps, at } of builders()) {
        const pinned = at(({ uses }) => uses === "./.github/actions/pinned");

        expect(pinned, name).toBeGreaterThan(at(({ id }) => id === "checkout"));
        expect(steps.slice(pinned).filter(({ uses }) => uses?.startsWith("actions/setup-node@") === true), name).toEqual([]);
        expect(pinned, name).toBeLessThan(at(({ id }) => id === "npm-ci"));
        expect(pinned, name).toBeLessThan(at(({ run }) => (run ?? "").includes("bin/fix")));
      }
    });

    it("sets up the Node the tree's .nvmrc names, or 24 when it names none, hands it on as TREE_PATH, and leaves Node 24 first on the job's PATH for the machine", () => {
      const [tree, machine, ...more] = nodes();
      const steps = pinnedSteps();
      const nodeAt = steps.flatMap(({ uses }, at) => (uses?.startsWith("actions/setup-node@") === true ? [at] : []));
      const handing = steps.findIndex(({ run }) => (run ?? "").includes("TREE_PATH"));

      expect(more).toEqual([]);
      expect(String(tree?.with?.["node-version-file"])).toContain("tree/.nvmrc");
      expect(machine?.with?.["node-version"]).toBe(24);
      expect(nodeAt[0]).toBeLessThan(handing);
      expect(nodeAt[1]).toBeGreaterThan(handing);
      expect(readied({ name: "unpinned" }).handed).toBe("TREE_PATH=/node-bin\n");
    });

    it("readies the package manager the tree's package.json pins beside the tree's Node, under packageManager or devEngines, and nothing when it pins none or has no package.json", () => {
      const readying = ["/tree enable --install-directory /node-bin", "/tree install"];

      expect(readied({ packageManager: "pnpm@11.7.0" }).calls).toEqual(readying);
      expect(readied({ devEngines: { packageManager: { name: "pnpm", version: "11.7.0" } } }).calls).toEqual(readying);
      expect(readied({ packageManager: "pnpm@11.7.0" }, { corepack: false }).calls).toEqual(["npm install --global corepack@latest", ...readying]);
      expect(readied({ name: "unpinned" }).calls).toEqual([]);
      expect(readied(undefined).calls).toEqual([]);
    });

    it("leaves a tree like Lumaria's running the pnpm its package.json pins from the tree's own directory, through the real corepack", () => {
      const pnpm = readied({ packageManager: "pnpm@11.7.0" }, { stubbed: false }).ranPnpm();

      expect(pnpm.status, pnpm.stderr).toBe(0);
      expect(pnpm.stdout.trim()).toBe("11.7.0");
    });
  });

  describe("gives the builder the Postgres a step of the tree's contract needs as DATABASE_URL, so its check runs that step and leaves its receipt (#1202)", () => {
    const databaseSteps = () => (parse(readFileSync(DATABASE, "utf8")) as { runs: { steps: (WorkflowStep & { "working-directory"?: string })[] } }).runs.steps;
    const readied = (contract: string | undefined, { stale = false } = {}) => {
      const root = scratch("database-");
      const calls = join(root, "calls");
      const githubEnv = join(root, "github-env");
      mkdirSync(join(root, "tree", ".claude"), { recursive: true });
      writeFileSync(githubEnv, "");
      if (contract !== undefined) writeFileSync(join(root, "tree", ".claude", "contract.json"), contract);
      script(join(root, "bin", "docker"), `printf '%s\\n' "$*" >>"${calls}"\ncase $1 in\n  port) printf '127.0.0.1:49153\\n' ;;\n  ps) ${stale ? "printf 'c0ffee\\n'" : ":"} ;;\nesac\n`);
      const [step, ...more] = databaseSteps();
      expect(more).toEqual([]);
      const ran = execute("bash", join(root, step?.["working-directory"] ?? ""), { PATH: `${join(root, "bin")}:/usr/bin:/bin`, GITHUB_ENV: githubEnv, GITHUB_REPOSITORY: "collod873/Lumaria", RUNNER_NAME: "GitHub Actions 7" }, ["-e", "-c", step?.run ?? ""]);
      expect(ran.status, ran.stderr).toBe(0);
      return { calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [], handed: readFileSync(githubEnv, "utf8") };
    };

    it("starts postgres:16 on a free port and hands its address on as DATABASE_URL once it takes connections, when a step needs DATABASE_URL", () => {
      const { calls, handed } = readied('{ "steps": { "lint": { "run": "true" }, "integration": { "run": "true", "needs": ["BASE_URL", "DATABASE_URL"] } } }\n');

      expect(calls[0]).toBe("ps --all --quiet --filter name=^database-collod873-Lumaria-GitHub-Actions-7$");
      expect(calls[1]).toMatch(/^run --quiet --detach --name database-collod873-Lumaria-GitHub-Actions-7 --publish 127\.0\.0\.1::5432 .*postgres:16$/);
      expect(calls.slice(2)).toEqual(["exec database-collod873-Lumaria-GitHub-Actions-7 pg_isready --quiet --host 127.0.0.1", "port database-collod873-Lumaria-GitHub-Actions-7 5432/tcp"]);
      expect(handed).toBe("DATABASE_URL=postgres://postgres:postgres@localhost:49153/postgres\n");
    });

    it("clears the Postgres its runner's last job left, since a PC runner keeps its containers between jobs", () => {
      const { calls } = readied('{ "steps": { "integration": { "run": "true", "needs": ["DATABASE_URL"] } } }\n', { stale: true });

      expect(calls[1]).toBe("rm --force c0ffee");
      expect(calls[2]).toMatch(/^run .*--name database-collod873-Lumaria-GitHub-Actions-7 /);
    });

    it("starts nothing and hands nothing on when no step needs DATABASE_URL, the contract has no steps, or the tree has no contract", () => {
      for (const contract of ['{ "steps": { "integration": { "run": "true", "needs": ["BASE_URL"] } } }\n', '{ "stop": "true" }\n', undefined]) {
        expect(readied(contract), contract).toEqual({ calls: [], handed: "" });
      }
    });

    it("in every job that runs the builder, after the tree is checked out and before the builder starts", () => {
      for (const { name, steps, at } of builders()) {
        const database = at(({ uses }) => uses === "./.github/actions/database");

        expect(database, name).toBeGreaterThan(at(({ id }) => id === "checkout"));
        expect(database, name).toBeLessThan(at(({ run }) => (run ?? "").includes("bin/fix")));
        expect(steps[database]?.if, name).toBe(steps[at(({ id }) => id === "npm-ci")]?.if);
      }
    });
  });
});

describe("a repo's specs and research notes run through the same caller file, on its own checkout (#1151)", () => {
  const specs = (fired: Fired) => jobsRun(fired, "specs.yml");
  const stageSteps = () => Object.entries(workflowJobs("specs.yml")).flatMap(([name, { steps }]) => steps.filter(({ env }) => env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined).map((step) => ({ name, steps, step })));

  it("slices a spec and answers a research note the owner opens, and nothing anyone else opens", () => {
    expect(specs({ event: "issues", action: "opened" })).toEqual(["slice", "research"]);
    expect(specs({ event: "issues", action: "opened", sender: "stranger" })).toEqual([]);
    expect(specs({ event: "issues", action: "opened", sender: MACHINE })).toEqual([]);
  });

  it("reslices the spec of any issue that closes, once it names one", () => {
    expect(specs({ event: "issues", action: "closed", sender: MACHINE, outputs: { ended: { spec: "" } } })).toEqual(["ended"]);
    expect(specs({ event: "issues", action: "closed", sender: MACHINE, outputs: { ended: { spec: "1151" } } })).toEqual(["ended", "reslice"]);
  });

  it("resumes a spec or a research note the owner takes a label off, the spec once it names one (#1175, #1353)", () => {
    expect(specs({ event: "issues", action: "unlabeled", outputs: { resumed: { spec: "" } } })).toEqual(["resumed", "research"]);
    expect(specs({ event: "issues", action: "unlabeled", outputs: { resumed: { spec: "902" } } })).toEqual(["resumed", "resume", "research"]);
    expect(specs({ event: "issues", action: "unlabeled", sender: MACHINE })).toEqual([]);
  });

  it("runs the done check again on the owner's comment, once the last done check put a sentence to him", () => {
    expect(specs({ event: "issue_comment", action: "created", outputs: { asked: { asked: "" } } })).toEqual(["asked"]);
    expect(specs({ event: "issue_comment", action: "created", outputs: { asked: { asked: "true" } } })).toEqual(["asked", "check"]);
    expect(specs({ event: "issue_comment", action: "created", sender: MACHINE })).toEqual([]);
  });

  it("starts nothing on a ticket's events, and tickets.yml nothing on a comment", () => {
    for (const fired of [
      { event: "issues", action: "reopened" },
      { event: "issues", action: "unlabeled", sender: MACHINE },
      { event: "pull_request_target", action: "closed" },
      { event: "workflow_run", action: "completed", conclusion: "failure" },
      { event: "workflow_dispatch" },
    ]) {
      expect(specs(fired), JSON.stringify(fired)).toEqual([]);
    }
    expect(jobsRun({ event: "issue_comment", action: "created" })).toEqual([]);
  });

  it("readies the tree's pinned Node before anything installs, in every job whose stage may run the done check, and tells that stage the caller file it runs under", () => {
    const trying = stageSteps().filter(({ step }) => /bin\/(slice|done-check)\b/.test(step.run ?? ""));

    expect(trying.length).toBeGreaterThan(0);
    for (const { name, steps, step } of trying) {
      const at = (found: (one: WorkflowStep) => boolean) => steps.findIndex(found);
      const pinned = at(({ uses }) => uses === "./.github/actions/pinned");

      expect(pinned, name).toBeGreaterThan(at(({ id }) => id === "checkout"));
      expect(pinned, name).toBeLessThan(at(({ id }) => id === "npm-ci"));
      expect(step.env?.CALLED_FROM, `${name} ${step.id ?? ""}`).toBe("${{ github.workflow_ref }}");
    }
  });

  it("gives every stage it runs the caller's checkout as its working directory", () => {
    expect(stageSteps().length).toBeGreaterThan(0);
    for (const { name, step } of stageSteps()) expect((step as WorkflowStep & { "working-directory"?: string })["working-directory"], name).toBe("tree");
  });
});

describe("this repo reaches the machine through the caller file bin/enrol writes, like every enrolled repo, so a machine fix lands once (#1220)", () => {
  const HEARD = ["issues", "issue_comment", "pull_request", "pull_request_target", "workflow_run", "check_run", "check_suite"];
  const DEFAULT_TYPES: Record<string, string[]> = { pull_request: ["opened", "synchronize", "reopened"], pull_request_target: ["opened", "synchronize", "reopened"] };
  type Triggers = Record<string, { types?: string[]; workflows?: string[] } | null>;
  const triggersOf = (file: string) => {
    const { on } = parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { on: Triggers | string | string[] };
    return typeof on === "string" ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((event) => [event, null])) : on;
  };
  const typesOf = (triggers: Triggers, event: string) => triggers[event]?.types ?? DEFAULT_TYPES[event];
  const overlaps = (ours: string[] | undefined, theirs: string[] | undefined) => ours === undefined || theirs === undefined || ours.some((type) => theirs.includes(type));

  it("holds the caller file under the name bin/enrol writes, its text bin/enrol's apart from hearing Check in place of CI", () => {
    const written = readFileSync(CALLER, "utf8");
    const ours = written.replace("workflows: [CI]", "workflows: [Check]");

    expect(ours).not.toBe(written);
    expect(readFileSync(join(WORKFLOWS, ENROLLED_CALLER), "utf8")).toBe(ours);
    expect((parse(readFileSync(join(WORKFLOWS, "check.yml"), "utf8")) as { name: string }).name).toBe("Check");
  });

  it("runs the reviewer and the meter reviewer only through tickets.yml, as every enrolled repo does, so GitHub names the review tickets / review here too (#1386)", () => {
    const running = (stage: string) => readdirSync(WORKFLOWS).flatMap((file) => Object.entries(workflowJobs(file)).flatMap(([job, { steps = [] }]) => (steps.some(({ run }) => new RegExp(`bin/${stage}\\b`).test(run ?? "")) ? [`${file} ${job}`] : [])));

    expect(running("review")).toEqual(["tickets.yml review"]);
    expect(running("meters")).toEqual(["tickets.yml meters"]);
  });

  it("leaves no workflow here but the CI the caller hears handling an issue, PR or check event a job of tickets.yml or specs.yml handles", () => {
    const caller = triggersOf(ENROLLED_CALLER);
    const heard = caller.workflow_run?.workflows ?? [];
    const others = readdirSync(WORKFLOWS).filter((file) => file !== ENROLLED_CALLER && !Object.hasOwn(triggersOf(file), "workflow_call") && !heard.includes((parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { name?: string }).name ?? file));
    const twice = others.flatMap((file) => {
      const triggers = triggersOf(file);
      return HEARD.filter((event) => Object.hasOwn(triggers, event) && Object.hasOwn(caller, event) && overlaps(typesOf(triggers, event), typesOf(caller, event))).flatMap((event) => {
        const theirs = typesOf(triggers, event);
        const ours = typesOf(caller, event);
        if (theirs === undefined || ours === undefined) return [`${file} ${event}`];
        return theirs.filter((action) => ours.includes(action) && CALLED.some((called) => jobsRun({ event, action, home: true }, called).length > 0)).map((action) => `${file} ${event} ${action}`);
      });
    });

    expect(others.length).toBeGreaterThan(0);
    expect(twice).toEqual([]);
  });

  it("names in its stage code no workflow file but one this repo holds, so no stage dispatches a deleted workflow", () => {
    const held = new Set([...readdirSync(WORKFLOWS), "action.yml", "caller.yml"]);
    const code = [
      ...readdirSync(join(REPO, "src"))
        .filter((file) => /\.ts$/.test(file) && !/\.test\.ts$|^scenarios\.ts$/.test(file))
        .map((file) => join(REPO, "src", file)),
      ...readdirSync(join(REPO, "bin")).map((file) => join(REPO, "bin", file)),
    ];
    const named = code.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/[\w-]+\.ya?ml\b/g)].map(([name]) => `${file.slice(REPO.length + 1)} ${name}`));

    expect(named.filter((said) => !held.has(said.split(" ")[1] ?? ""))).toEqual([]);
  });

  it("wakes a builder and starts a size trial through that caller file when no caller file is named, as on a run by hand", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "909", ticket: "830", conflicts: true }] });

    expect(run().status).toBe(0);
    expect(calls().filter((call) => call.startsWith("workflow\nrun\n")).map((call) => call.split("\n")[2])).toEqual([ENROLLED_CALLER]);
  });
});
