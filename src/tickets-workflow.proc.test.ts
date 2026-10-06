import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { fixing } from "./builder.part.ts";
import { closing } from "./closer.part.ts";
import { execute, heldBy, holds, labelledAs, labelledStep, scratch, script, workflowJobs, type WorkflowStep } from "./scenarios.ts";
import { HELD, MACHINE, OWNER } from "./spelled.ts";

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

const CALLED = ["tickets.yml", "specs.yml"];
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

function jobsRun({ red = [], outputs = {}, ...fired }: Fired, file = "tickets.yml"): string[] {
  declared(fired);
  const results: Record<string, { result: string; outputs?: Record<string, string> }> = {};
  for (const [name, job] of Object.entries(workflowJobs(file))) {
    const needs = Object.fromEntries([job.needs ?? []].flat().map((need) => [need, results[need] ?? { result: "skipped" }]));
    const failed = Object.values(needs).some(({ result }) => result !== "success");
    const ran = holds(job.if ?? "success()", { ...fired, needs, failed });
    results[name] = ran ? { result: red.includes(name) ? "failure" : "success", outputs: outputs[name] ?? {} } : { result: "skipped" };
  }
  return Object.entries(results).flatMap(([name, { result }]) => (result === "skipped" ? [] : [name]));
}

describe("a repo's tickets build through one caller file that holds only triggers and the call (#1135)", () => {
  it("holds a name, its triggers and the jobs that call tickets.yml and specs.yml on this repo's main with the caller's secrets, and nothing else (#1151)", () => {
    const { name, on, jobs, ...rest } = caller();

    expect(rest).toEqual({});
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

  it("tells the closer which caller file it runs under, so a builder it wakes starts through that file", () => {
    const closing = workflowJobs("tickets.yml").close?.steps.find(({ run }) => (run ?? "").includes("bin/close"));

    expect(closing?.env?.CALLED_FROM).toBe("${{ github.workflow_ref }}");
    expect(caller().on.workflow_dispatch).toEqual({ inputs: { ticket: { required: true, type: "string" }, reason: { required: true, type: "string" } } });
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
    const real = realpathSync(join(homedir(), "bin", "check"));
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

  it("runs the done check again on the owner's comment, once the last done check put a sentence to him", () => {
    expect(specs({ event: "issue_comment", action: "created" })).toEqual(["asked"]);
    expect(specs({ event: "issue_comment", action: "created", outputs: { asked: { asked: "true" } } })).toEqual(["asked", "check"]);
    expect(specs({ event: "issue_comment", action: "created", sender: MACHINE })).toEqual([]);
  });

  it("starts nothing on a ticket's events, and tickets.yml nothing on a comment", () => {
    for (const fired of [
      { event: "issues", action: "reopened" },
      { event: "issues", action: "unlabeled", sender: MACHINE },
      { event: "pull_request_target", action: "closed" },
      { event: "push" },
      { event: "workflow_run", action: "completed", conclusion: "failure" },
      { event: "workflow_dispatch" },
    ]) {
      expect(specs(fired), JSON.stringify(fired)).toEqual([]);
    }
    expect(jobsRun({ event: "issue_comment", action: "created" })).toEqual([]);
  });

  it("readies the tree's pinned Node before anything installs, in every job whose stage may run the done check, and tells that stage the caller file it runs under", () => {
    const trying = stageSteps().filter(({ step }) => /bin\/(slice|done-check)\b/.test(step.run ?? ""));

    expect([...new Set(trying.map(({ name }) => name))].sort()).toEqual(["check", "reslice", "slice"]);
    for (const { name, steps, step } of trying) {
      const at = (found: (one: WorkflowStep) => boolean) => steps.findIndex(found);
      const pinned = at(({ uses }) => uses === "./.github/actions/pinned");

      expect(pinned, name).toBeGreaterThan(at(({ id }) => id === "checkout"));
      expect(pinned, name).toBeLessThan(at(({ id }) => id === "npm-ci"));
      expect(step.env?.CALLED_FROM, `${name} ${step.id ?? ""}`).toBe("${{ github.workflow_ref }}");
    }
  });

  it("gives every stage it runs the caller's checkout as its working directory", () => {
    expect(stageSteps().map(({ name, step }) => `${name} ${step.id ?? ""}`).sort()).toEqual(["check done-check", "research research", "reslice reslice", "reslice wave-check", "slice slice"]);
    for (const { name, step } of stageSteps()) expect((step as WorkflowStep & { "working-directory"?: string })["working-directory"], name).toBe("tree");
  });
});
