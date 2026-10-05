import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { closing } from "./closer.part.ts";
import { doneChecking, specWith } from "./done-checker.part.ts";
import { execute, holds, scratch, script, workflowJobs, type WorkflowStep } from "./scenarios.ts";
import { MACHINE, OWNER } from "./spelled.ts";

const REPO = join(import.meta.dirname, "..");
const CALLER = join(REPO, ".github", "caller.yml");
const TICKETS = join(REPO, ".github", "workflows", "tickets.yml");
const APP = "${{ steps.app.outputs.token }}";
const PINNED = join(REPO, ".github", "actions", "pinned", "action.yml");

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

function declared({ event, action = "" }: Fired): void {
  const trigger = caller().on[event] as { types?: string[]; workflows?: string[] } | null | undefined;
  expect(Object.keys(caller().on), `the caller file declares ${event}`).toContain(event);
  if (trigger?.types !== undefined) expect(trigger.types, `the caller file declares ${event} ${action}`).toContain(action);
  if (event === "workflow_run") expect(trigger?.workflows?.length, "the caller file names the CI it hands back from").toBeGreaterThan(0);
}

function jobsRun({ red = [], outputs = {}, ...fired }: Fired): string[] {
  declared(fired);
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

  it("fires only what the caller file declares, so a trigger dropped from it fails here", () => {
    expect(() => jobsRun({ event: "issues", action: "edited" })).toThrow(/declares issues edited/);
    expect(() => jobsRun({ event: "pull_request", action: "closed" })).toThrow(/declares pull_request/);
  });

  it("takes from a dispatch exactly the inputs the closer sends and tickets.yml reads", () => {
    const { calls, run } = closing({ ticket: "819", openPrs: [{ number: "909", ticket: "830", refused: "GraphQL: This branch is out-of-date and cannot be updated because of merge conflicts." }], calledFrom: "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" });
    expect(run().status).toBe(0);
    const wake = calls().find((call) => call.startsWith("workflow\nrun\nmachine.yml\n")) ?? "";
    const sent = [...wake.matchAll(/^-f\n(\w+)=/gm)].map(([, input]) => input ?? "");
    const read = [...new Set([...readFileSync(TICKETS, "utf8").matchAll(/github\.event\.inputs\.(\w+)/g)].map(([, input]) => input ?? ""))];
    const inputs = Object.keys((caller().on.workflow_dispatch as { inputs: Record<string, unknown> }).inputs);

    expect(sent.sort()).toEqual(inputs.sort());
    expect(read.sort()).toEqual(inputs.sort());
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
      const treeEnv = () => ({ TREE_PATH: /^TREE_PATH=(.*)$/m.exec(readFileSync(githubEnv, "utf8"))?.[1] ?? "", COREPACK_HOME: join(root, "corepack-home") });
      const ranPnpm = () => execute("bash", join(root, "tree"), { PATH: `${treeEnv().TREE_PATH}:/usr/bin:/bin`, COREPACK_HOME: treeEnv().COREPACK_HOME }, ["-c", "pnpm --version"]);
      return {
        treeEnv,
        calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => line.replaceAll(root, "")) : [],
        handed: readFileSync(githubEnv, "utf8").replaceAll(root, ""),
        ranPnpm,
      };
    };

    it("in the close job, after the tree is checked out and the machine's own Node, and before the closer starts the done checker (#1140)", () => {
      const steps = workflowJobs("tickets.yml").close?.steps ?? [];
      const at = (found: (step: WorkflowStep) => boolean) => steps.findIndex(found);
      const pinned = at(({ uses }) => uses === "./.github/actions/pinned");

      expect(pinned).toBeGreaterThan(at(({ id }) => id === "checkout"));
      expect(steps.slice(pinned).filter(({ uses }) => uses?.startsWith("actions/setup-node@") === true)).toEqual([]);
      expect(pinned).toBeLessThan(at(({ run }) => (run ?? "").includes("bin/close")));
    });

    it("lets a pnpm-pinned tree's done check run the pnpm it pins, through the real corepack (#1140)", () => {
      const env = readied({ packageManager: "pnpm@11.7.0" }, { stubbed: false }).treeEnv();
      const checked = doneChecking({ body: specWith(["see the tree's own pnpm answer – check: `[ \"$(pnpm --version)\" = 11.7.0 ]`"]), tries: [], env, manifest: { packageManager: "pnpm@11.7.0" } });

      expect(checked.run().status).toBe(0);
      expect(checked.comments()[0]).toContain("which exited 0.");
      expect(checked.closes()).toHaveLength(1);
    });

    it("in every job that runs the builder, after the tree is checked out and the machine's own Node, and before anything installs or the builder starts", () => {
      const builds = Object.entries(workflowJobs("tickets.yml")).filter(([, { steps }]) => steps.some(({ run }) => (run ?? "").includes("bin/fix")));

      expect(builds.map(([name]) => name).sort()).toEqual(["build", "fix"]);
      for (const [name, { steps }] of builds) {
        const at = (found: (step: WorkflowStep) => boolean) => steps.findIndex(found);
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
      expect(tree?.with).toEqual({ "node-version-file": "${{ hashFiles('tree/.nvmrc') != '' && 'tree/.nvmrc' || '' }}", "node-version": "${{ hashFiles('tree/.nvmrc') == '' && '24' || '' }}" });
      expect(machine?.with).toEqual({ "node-version": 24 });
      expect(nodeAt).toEqual([handing - 1, handing + 1]);
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
});
