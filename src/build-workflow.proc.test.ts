import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cloned, copyMark, git, holds, labelledAs, scratch, script, starts as startsJob, type IssueEvent, type StepOutcome } from "./scenarios.ts";
import { HELD, OWNER_CALL } from "./spelled.ts";

const REPO = join(import.meta.dirname, "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const WORKFLOW = join(WORKFLOWS, "tickets.yml");
const CALLER_FILE = join(WORKFLOWS, "machine.yml");
const FEED = join(REPO, ".github", "actions", "stage", "feed.jq");
const STAGES = ["start", "fix"] as const;
type Stage = (typeof STAGES)[number];

interface Step {
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  "timeout-minutes"?: number;
  "continue-on-error"?: boolean;
}

interface Job {
  if?: string;
  outputs?: Record<string, string>;
  needs?: string | string[];
  env?: Record<string, unknown>;
  permissions?: Record<string, string>;
  "cache-mode"?: string;
  steps: Step[];
}

interface Workflow {
  on: { issues?: { types?: string[] } };
  jobs: Record<string, Job>;
}

const RUNS_FIX = /(^|\s|\/)bin\/fix"?(\s|$)/;

function workflow(): { on: Workflow["on"]; job: Job } {
  const { on } = parse(readFileSync(CALLER_FILE, "utf8")) as Workflow;
  return { on, job: namedJob(ticketsJobs(), "build", WORKFLOW) };
}

const ticketsJobs = () => (parse(readFileSync(WORKFLOW, "utf8")) as Workflow).jobs;

function stageStep(job: Job, stage: Stage): Step {
  const step = job.steps.find((candidate) => candidate.id === stage);
  expect(step, `a step with the id ${stage}`).toBeDefined();
  return step as Step;
}

function stagesRun(job: Job, failing: Stage | undefined, given: Record<string, Record<string, string>> = {}): Stage[] {
  const outputs: Record<string, Record<string, string>> = { labelled: { held: "true" }, admit: { admitted: "true" }, ...given };
  const outcomes: Record<string, StepOutcome> = {};
  for (const step of job.steps) if (step.id !== undefined) outcomes[step.id] = { outcome: "skipped", conclusion: "skipped", outputs: {} };
  const red = failing === undefined ? undefined : stageStep(job, failing);
  const ran: Step[] = [];
  let failed = false;
  for (const step of job.steps) {
    if (!holds(step.if ?? "success()", { steps: outcomes, failed })) continue;
    ran.push(step);
    const broke = step === red;
    const stops = broke && step["continue-on-error"] !== true;
    if (step.id !== undefined) outcomes[step.id] = { outcome: broke ? "failure" : "success", conclusion: stops ? "failure" : "success", outputs: outputs[step.id] ?? {} };
    failed = failed || stops;
  }
  return STAGES.filter((stage) => ran.includes(stageStep(job, stage)));
}

describe("tickets.yml builds a ticket the moment it is filed (#826)", () => {
  const starts = (event: IssueEvent) => startsJob("tickets.yml", "build", event);

  it("an issue labelled note starts no build", async () => {
    const { on } = workflow();

    expect(on.issues?.types).toContain("opened");
    expect(await starts({ labels: [] })).toBe(true);
    expect(await starts({ labels: ["ticket"] })).toBe(true);
    expect(await starts({ labels: ["note"] })).toBe(false);
    expect(await starts({ labels: ["ticket", "note"] })).toBe(false);
  });

  it("an issue labelled spec starts no build", async () => {
    expect(await starts({ labels: ["spec"] })).toBe(false);
    expect(await starts({ labels: ["ticket", "spec"] })).toBe(false);
  });

  it("an issue a stranger files or reopens starts no build, since its checks run as shell with the App's token", async () => {
    expect(await starts({ sender: "collod873" })).toBe(true);
    expect(await starts({ sender: "stranger" })).toBe(false);
    expect(await starts({ sender: "stranger", action: "reopened" })).toBe(false);
  });

  it("every ticket the App opens reaches bin/fix, which holds it to a follow-up or an owner's open spec, and nothing a stranger files does (#865, #1022)", async () => {
    expect(await starts({ sender: "collod873-machine[bot]" })).toBe(true);
    expect(await starts({ sender: "stranger" })).toBe(false);
    expect(await starts({ sender: "collod873-machine[bot]", labels: ["note"] })).toBe(false);
  });

  it("builds nothing on the App's reopen", async () => {
    expect(await starts({ sender: "collod873-machine[bot]", action: "opened" })).toBe(true);
    expect(await starts({ sender: "collod873-machine[bot]", action: "reopened" })).toBe(false);
    expect(await starts({ sender: "collod873-machine[bot]", action: "unlabeled", label: "waiting" })).toBe(true);
  });

  it("a ticket split by its builder builds what waited once `waiting` comes off, and no other label change but paused or stuck coming off starts a build (#910, #1174)", async () => {
    const unlabeled = (sender: string, label: string) => starts({ sender, action: "unlabeled", label });

    expect(workflow().on.issues?.types).toContain("unlabeled");
    expect(await unlabeled("collod873-machine[bot]", "waiting")).toBe(true);
    expect(await unlabeled("collod873", "waiting")).toBe(true);
    expect(await unlabeled("collod873-machine[bot]", "building")).toBe(false);
    for (const held of HELD) expect(await unlabeled("collod873", held), held).toBe(true);
    expect(await unlabeled("stranger", "waiting")).toBe(false);
    expect(await starts({ sender: "collod873-machine[bot]", action: "unlabeled", label: "waiting", labels: ["note"] })).toBe(false);
  });

  it("a follow-up the reviewer files labelled `waiting` starts no build when opened, only once `waiting` comes off (#1033)", async () => {
    expect(await starts({ sender: "collod873-machine[bot]", action: "opened", labels: ["waiting"] })).toBe(false);
    expect(await starts({ sender: "collod873-machine[bot]", action: "unlabeled", label: "waiting" })).toBe(true);
  });

  it("admits the ticket before start marks it, and a refused ticket runs neither start nor its builder, ending green so no Fix starts (#1022)", () => {
    const { job } = workflow();
    const admit = job.steps.find((step) => step.id === "admit");

    expect(admit?.run).toMatch(/bin\/admit"? \$\{\{ github\.event\.issue\.number \}\} >>"\$GITHUB_OUTPUT"/);
    expect(String(admit?.env?.GH_TOKEN)).toMatch(/steps\.app\.outputs\.token/);
    expect(job.steps.indexOf(admit as Step)).toBeLessThan(job.steps.indexOf(stageStep(job, "start")));
    expect(stagesRun(job, undefined, { admit: { admitted: "false" } })).toEqual([]);
  });

  it("admits and builds with an App token that reaches every repo the owner enrolled, so a machine fault can read the ticket it was filed from (#1203)", () => {
    const fixing = Object.values(ticketsJobs()).filter(({ steps }) => steps.some((step) => RUNS_FIX.test(step.run ?? "")));

    for (const { steps } of fixing) expect(steps.find((step) => step.id === "app")?.with?.owner).toBe("${{ github.repository_owner }}");
    expect(fixing).toHaveLength(2);
  });

  it("hands the ticket to its builder after start, and nothing runs after start fails", () => {
    const { job } = workflow();

    expect(stagesRun(job, "start")).toEqual(["start"]);
    expect(stagesRun(job, "fix")).toEqual(["start", "fix"]);
    expect(stagesRun(job, undefined)).toEqual(["start", "fix"]);
    const at = STAGES.map((stage) => job.steps.indexOf(stageStep(job, stage)));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("builds with the builder alone, acting as the App under its own time cap (#931)", () => {
    const { job } = workflow();
    const minting = job.steps.find((step) => step.uses?.startsWith("actions/create-github-app-token@") === true);

    expect(minting?.id, "an App token step with an id").toBeDefined();
    expect(JSON.stringify(minting?.with)).toContain("CORE_APP_CLIENT_ID");
    expect(JSON.stringify(minting?.with)).toContain("CORE_APP_PRIVATE_KEY");
    const token = new RegExp(`steps\\.${minting?.id}\\.outputs\\.token`);

    for (const stage of STAGES) {
      const step = stageStep(job, stage);
      expect(job.steps.indexOf(minting as Step)).toBeLessThan(job.steps.indexOf(step));
      expect(step["timeout-minutes"], `${stage} time cap`).toBeGreaterThan(0);
      expect(String({ ...job.env, ...step.env }.GH_TOKEN), `${stage} token`).toMatch(token);
    }
    expect(job.steps.some((step) => /(^|\s|\/)bin\/(test-author|build|save)(\s|$)/.test(step.run ?? ""))).toBe(false);
  });

  it("keeps the App's token in the checkout, since the builder pushes from its own loop and a push by the job's token starts no Check (#931)", () => {
    const { job } = workflow();
    const token = /steps\.app\.outputs\.token/;
    const checkouts = job.steps.filter((step) => step.uses?.startsWith("actions/checkout@") === true && step.id === "checkout");

    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) {
      expect(String(checkout.with?.token)).toMatch(token);
      expect(checkout.with?.["persist-credentials"]).not.toBe(false);
    }
  });

  it("keeps the session the builder built in, whatever ended it, so the first red resumes it in the fix job (#931)", () => {
    const { job } = workflow();
    const fix = namedJob(ticketsJobs(), "fix", WORKFLOW);
    const saved = job.steps.find((step) => step.uses?.startsWith("actions/cache/save@") === true);
    const restored = fix.steps.find((step) => step.uses?.startsWith("actions/cache/restore@") === true);
    const key = String(saved?.with?.key).replace("${{ steps.start.outputs.branch }}", "ticket/9");
    const resumedFrom = String(restored?.with?.["restore-keys"]).replace("${{ env.HEAD_REF }}", "ticket/9");

    expect(fix.env?.HEAD_REF).toBe("${{ needs.which.outputs.branch }}");
    const ended = (fixed: string) => holds(saved?.if ?? "success()", { steps: { ...allSkipped(job.steps), fix: outcome(fixed) }, failed: fixed === "failure" });

    expect(job["cache-mode"]).toBe("write");
    expect(saved?.with?.path).toBe(restored?.with?.path);
    expect(key.startsWith(resumedFrom), `${key} resumes from ${resumedFrom}`).toBe(true);
    expect(ended("success")).toBe(true);
    expect(ended("failure")).toBe(true);
    expect(ended("skipped")).toBe(false);
  });
});

describe("tickets.yml builds from main as it is when the job runs, not the SHA of the issue event (#860)", () => {
  it("every checkout of the build job pins a ref, so a rerun after a merge starts from fresh main as it is when the job runs, not the stale SHA the issue event carried", () => {
    const checkouts = workflow().job.steps.filter((step) => step.uses?.startsWith("actions/checkout@") === true);

    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) expect(checkout.with?.ref, JSON.stringify(checkout)).toBe("main");
  });
});

function expanded(steps: Step[]): Step[] {
  return steps.flatMap((step) => {
    if (step.uses?.startsWith("./") !== true) return [step];
    const action = parse(readFileSync(join(REPO, step.uses, "action.yml"), "utf8")) as { runs: { steps: Step[] } };
    return expanded(action.runs.steps.map((inner) => ({ ...inner, if: inner.if ?? step.if })));
  });
}

const everyJob = (): Job[] =>
  readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => Object.values((parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs: Record<string, Partial<Job>> }).jobs))
    .flatMap(({ steps, ...job }) => (steps === undefined ? [] : [{ ...job, steps: expanded(steps) }]));
const spendsModel = (step: Step) => step.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined;
const transcriptOf = (run: string) => (/(^|\s|\/)bin\/([\w-]+)/.exec(run.split("\n").slice(1).join("\n"))?.[2] ?? "fix");
const SAID = { type: "assistant", message: { content: [{ type: "text", text: "reading the brief" }] } };

const modelJobs = () => everyJob().filter(({ steps }) => steps.some(spendsModel));

describe("every job that spends a model is watched as it goes, read after it ends, and stopped at its cap, in every workflow (#835, #840)", () => {
  it("every step that spends a model stops it before the step's own cap, which kills only the step's shell", () => {
    const steps = modelJobs().flatMap(({ steps }) => steps.filter(spendsModel));

    expect(steps.some((step) => /bin\/review /.test(step.run ?? ""))).toBe(true);
    for (const step of steps) {
      expect(Number(step.env?.STAGE_MINUTES)).toBeGreaterThan(0);
      expect(Number(step.env?.STAGE_MINUTES)).toBeLessThan(step["timeout-minutes"] ?? 0);
    }
  });

  it("every job hands its stages the owner's hooks from the live release, read with a token that can only read agent-hooks", () => {
    for (const { steps } of modelJobs()) {
      const minted = steps.findIndex((step) => step.with?.repositories === "agent-hooks");
      const cloned = steps.findIndex((step) => /git clone [^\n]*--branch live /.test(step.run ?? ""));
      const handed = steps.findIndex((step) => /AGENT_HOOKS_SETTINGS=.*GITHUB_ENV/.test(step.run ?? ""));
      expect(steps[minted]?.with).toMatchObject({ owner: "${{ github.repository_owner }}", "permission-contents": "read" });
      expect(minted).toBeGreaterThanOrEqual(0);
      expect(cloned).toBeGreaterThan(minted);
      expect(handed).toBeGreaterThan(cloned);
      expect(handed).toBeLessThan(steps.findIndex(spendsModel));
      expect(steps[handed]?.run).toContain("--emit-stages");
    }
  });

  it("every job files its stages' captures into the knowledge base whatever ended it, with a write token minted only after the model is done", () => {
    for (const { steps } of modelJobs()) {
      const minted = steps.findIndex((step) => step.with?.repositories === "Knowledge-Base" && step.with["permission-contents"] !== "read");
      const filed = steps.findIndex((step) => /Knowledge-Base\/raw/.test(step.run ?? ""));
      const lastModel = steps.length - 1 - [...steps].reverse().findIndex(spendsModel);
      expect(steps[minted]?.with).toMatchObject({ owner: "${{ github.repository_owner }}", "permission-contents": "write" });
      expect(minted).toBeGreaterThan(lastModel);
      expect(filed).toBeGreaterThan(minted);
      for (const ended of [{}, { failed: true }, { cancelled: true }]) {
        expect(holds(steps[minted]?.if ?? "success()", { steps: labelledAs(steps, "true"), ...ended })).toBe(true);
        expect(holds(steps[filed]?.if ?? "success()", { steps: labelledAs(steps, "true"), ...ended })).toBe(true);
      }
    }
  });

  it("every job keeps its machine logs as a run artifact, whatever ended it", () => {
    for (const { steps } of modelJobs()) {
      const last = steps[steps.length - 1];
      expect(last?.uses).toMatch(/^actions\/upload-artifact@/);
      expect(last?.if).toBe("always()");
      expect(last?.with).toMatchObject({ path: ".git/machine-logs", "include-hidden-files": true });
    }
  });

  it("every step that spends a model shows what its stage's model does in the log as it happens, and ends with the stage's own status", async () => {
    const watching = modelJobs()
      .flatMap(({ steps }) => steps.filter(spendsModel))
      .map((step) => {
        const run = (step.run ?? "").replaceAll(BARE_EXPRESSIONS, "9");
        const transcript = `.git/machine-logs/${transcriptOf(run)}-9.jsonl`;
        const cwd = scratch("feed-");
        mkdirSync(join(cwd, ".git", "machine-logs"), { recursive: true });
        const stage = [`printf '%s\\n' '${JSON.stringify(SAID)}' >>${transcript}`, "sleep 1.5", "exit 3"].join("\n");
        return new Promise<{ stdout: string; status: number | null }>((resolve) => {
          execFile("bash", ["-e", "-c", `${run.split("\n")[0]}\n${stage}`], { cwd, env: { ...process.env, FEED, HEAD_REF: "ticket/9", TICKET: "9" }, encoding: "utf8", timeout: 10000 }, (error, stdout) => resolve({ stdout, status: error === null ? 0 : typeof error.code === "number" ? error.code : null }));
        });
      });

    for (const watched of await Promise.all(watching)) {
      expect(watched.stdout).toContain("said: reading the brief");
      expect(watched.status).toBe(3);
    }
  });
});

function namedJob(jobs: Record<string, Job>, name: string, where: string): Job {
  const job = jobs[name];
  if (job === undefined) throw new Error(`no ${name} job in ${where}`);
  return job;
}

const outcome = (value: string): StepOutcome => ({ outcome: value, conclusion: value, outputs: {} });
const allSkipped = (steps: Step[]): Record<string, StepOutcome> => Object.fromEntries(steps.flatMap((step) => (step.id === undefined ? [] : [[step.id, outcome("skipped")]])));

function holdsAlone(condition: string, steps: Step[], scope: { failed?: boolean; cancelled?: boolean }): boolean {
  try {
    return holds(condition, { ...scope, steps: allSkipped(steps) });
  } catch {
    return false;
  }
}

const BARE_EXPRESSIONS = /\$\{\{[^}]*\}\}/g;

function ranStep(step: Step, cwd: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string; output: Record<string, string> } {
  const output = join(cwd, "..", `output-${Math.random().toString(36).slice(2)}`);
  const outsideGit = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const ran = spawnSync("bash", ["-e", "-c", (step.run ?? "").replaceAll(BARE_EXPRESSIONS, "owner")], { cwd, env: { ...outsideGit, GITHUB_OUTPUT: output, ...env }, encoding: "utf8" });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, output: parseOutput(output) };
}

describe("the fix job hands every red run of a ticket to its builder, unless the ticket moved on (#898)", () => {
  it("stands down, spending no model, when the ticket moved on since the run that went red", () => {
    const fix = namedJob(ticketsJobs(), "fix", WORKFLOW);
    const branch = fix.steps.find((step) => step.id === "branch") as Step;
    const root = scratch("fix-branch-");
    const { session } = cloned(root, "main as it was");
    git(session, "checkout", "--quiet", "-b", "ticket/9");
    git(session, "commit", "--quiet", "--allow-empty", "-m", "Build #9 against its failing tests");
    const judged = git(session, "rev-parse", "HEAD");
    git(session, "push", "--quiet", "origin", "ticket/9");
    git(session, "checkout", "--quiet", "main");
    const env = { HEAD_REF: "ticket/9", EVENT: "workflow_run" };

    const current = ranStep(branch, session, { ...env, RAN_AT: judged });
    expect(current.status, current.stderr).toBe(0);
    expect(current.output.stale).toBeUndefined();
    expect(git(session, "rev-parse", "HEAD")).toBe(judged);

    const moved = ranStep(branch, session, { ...env, RAN_AT: "0000000000000000000000000000000000000000" });
    expect(moved.status, moved.stderr).toBe(0);
    expect(moved.output.stale).toBe("true");
    const skipped = { ...allSkipped(fix.steps), branch: { outcome: "success", conclusion: "success", outputs: { stale: "true" } } };
    expect(fix.steps.filter(spendsModel).map((step) => holds(step.if ?? "success()", { steps: skipped }))).toEqual([false]);

    const fresh = ranStep(branch, session, { ...env, HEAD_REF: "ticket/10", RAN_AT: judged });
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.output.stale).toBeUndefined();
    expect(git(session, "branch", "--show-current")).toBe("ticket/10");
    expect(git(session, "rev-parse", "HEAD")).toBe(git(session, "rev-parse", "origin/main"));
  });
});

describe("every step that runs gh names its repo, since gh otherwise reads it from a checkout that may never have run (#864)", () => {
  it("every step that runs gh sets GH_REPO or runs only once a checkout succeeded", () => {
    const runsGh = (step: Step) => /(^|[\s|;&(])gh\s|\/github"?\s/.test(step.run ?? "");
    const calls = everyJob().flatMap((job) => job.steps.filter(runsGh).map((step) => ({ job, step })));

    expect(calls.length).toBeGreaterThan(0);
    for (const { job, step } of calls) {
      const repo = { ...job.env, ...step.env }.GH_REPO;
      if (repo !== undefined) {
        expect(String(repo), step.run).toContain("github.repository");
        continue;
      }
      const checkout = job.steps.findIndex((candidate) => candidate.uses?.startsWith("actions/checkout@") === true);
      expect(checkout, step.run).toBeGreaterThanOrEqual(0);
      expect(job.steps.indexOf(step), step.run).toBeGreaterThan(checkout);
      const checkoutStep = job.steps[checkout];
      if (checkoutStep === undefined) throw new Error(`no checkout step in the job running ${step.run ?? ""}`);
      const checkoutId = checkoutStep.id;
      const steps = { ...allSkipped(job.steps), ...(checkoutId === undefined ? {} : { [checkoutId]: outcome("failure") }) };
      for (const result of ["success", "failure"]) {
        const needs = Object.fromEntries([job.needs ?? []].flat().map((name) => [name, { result }]));
        expect(holds(step.if ?? "success()", { steps, needs, failed: true }), step.run).toBe(false);
        expect(holds(step.if ?? "success()", { steps, needs, cancelled: true }), step.run).toBe(false);
      }
    }
  });
});

function parseOutput(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

function runOf(step: Step, ticket: string, action: string): string {
  return (step.run ?? "").replaceAll(/\$\{\{ github\.event\.issue\.number \}\}/g, ticket).replaceAll(/\$\{\{ github\.event\.action \}\}/g, action);
}

describe("tickets.yml re-runs an open PR's failed checks instead of building, when the owner reopens a ticket whose PR is open (#851)", () => {
  it("builds nothing and re-runs the failed checks when the owner reopens a ticket whose PR is open, but still builds when it has none", () => {
    const { job } = workflow();
    const start = stageStep(job, "start");
    const started = (cwd: string, output: string, action: string) =>
      spawnSync("bash", ["-e", "-c", runOf(start, "9", action)], { cwd, env: { ...process.env, PATH: `${join(cwd, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_WORKSPACE: cwd }, encoding: "utf8" });

    const withOpenPr = scratch("reopen-open-");
    const openCalls = join(withOpenPr, "calls");
    const openOutput = join(withOpenPr, "output");
    copyMark(withOpenPr);
    script(join(withOpenPr, "bin", "mark"), `printf 'mark %s\\n' "$*" >>"${openCalls}"\n`);
    script(
      join(withOpenPr, "bin", "gh"),
      [
        `printf '%s\\n' "$*" >>"${openCalls}"`,
        'case "$*" in',
        '  *"pr view ticket/9"*) printf \'OPEN\\n\' ;;',
        `  *"pr checks ticket/9"*) printf '%s\\n' '${JSON.stringify([{ name: "check", bucket: "fail", link: "https://github.com/collod873/claude-workflow/actions/runs/555/job/777" }])}' ;;`,
        "  *) exit 0 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    const opened = started(withOpenPr, openOutput, "reopened");

    expect(opened.status, opened.stderr).toBe(0);
    const openLog = readFileSync(openCalls, "utf8");
    expect(openLog).toContain("mark 9 checking\n");
    expect(openLog).not.toContain("mark 9 building");
    expect(openLog).toMatch(/rerun/i);
    expect(stagesRun(job, undefined, { start: parseOutput(openOutput) })).toEqual(["start"]);
    expect(parseOutput(openOutput).branch).toBe("ticket/9");

    const withNoPr = scratch("reopen-none-");
    const noCalls = join(withNoPr, "calls");
    const noOutput = join(withNoPr, "output");
    copyMark(withNoPr);
    script(join(withNoPr, "bin", "mark"), `printf 'mark %s\\n' "$*" >>"${noCalls}"\n`);
    script(
      join(withNoPr, "bin", "gh"),
      [`printf '%s\\n' "$*" >>"${noCalls}"`, 'case "$*" in', '  *"pr view ticket/9"*) exit 1 ;;', '  *"pr checks ticket/9"*) exit 1 ;;', "  *) exit 0 ;;", "esac", ""].join(
        "\n",
      ),
    );
    const none = started(withNoPr, noOutput, "reopened");

    expect(none.status, none.stderr).toBe(0);
    expect(readFileSync(noCalls, "utf8"), "a reopen with no open PR is a try").toContain("mark 9 building --try\n");
    const filed = started(withNoPr, noOutput, "opened");
    expect(filed.status, filed.stderr).toBe(0);
    expect(readFileSync(noCalls, "utf8"), "a first build is no try").toMatch(/^mark 9 building$/m);
    expect(stagesRun(job, undefined, { start: parseOutput(noOutput) })).toEqual(["start", "fix"]);
    expect(parseOutput(noOutput).branch).toBe("ticket/9");
    expect(stageStep(job, "fix").env?.BRANCH).toBe("${{ steps.start.outputs.branch }}");
    expect(stageStep(job, "fix").run).toContain('git checkout --quiet -b "$BRANCH"');
  });
});

describe("tickets.yml strips the machine's labels from every issue and PR that closes, so nothing is left behind (#1055)", () => {
  it("runs bin/mark --closed on every issue close and PR close", () => {
    const { on } = parse(readFileSync(CALLER_FILE, "utf8")) as { on: { issues?: { types?: string[] }; pull_request_target?: { types?: string[] } } };
    const strip = namedJob(ticketsJobs(), "strip", WORKFLOW).steps.find((step) => /bin\/mark .*--closed/.test(step.run ?? "")) as Step;
    const stripped = (number: Record<string, string>) => {
      const root = scratch("closed-");
      const calls = join(root, "calls");
      script(join(root, "bin", "mark"), `printf '%s\\n' "$*" >>"${calls}"\n`);
      expect(ranStep(strip, root, number).status).toBe(0);
      return readFileSync(calls, "utf8");
    };

    expect(on.issues?.types).toContain("closed");
    expect(on.pull_request_target?.types).toEqual(["closed"]);
    expect(String(strip.env?.NUMBER)).toMatch(/github\.event\.issue\.number \|\| github\.event\.pull_request\.number/);
    expect(stripped({ NUMBER: "811" })).toBe("811 --closed\n");
  });
});

const CALLER = join(REPO, ".github", "actions", "call-owner", "action.yml");
const CALLERS = [
  { file: "tickets.yml", job: "fix", names: "needs.which.outputs.ticket", run: "the builder's job" },
  { file: "tickets.yml", job: "close", names: "steps.close.outputs.ticket", run: "the closer run" },
  { file: "tickets.yml", job: "strip", names: "github.event.issue.number", run: "the strip run" },
  { file: "specs.yml", job: "research", names: "github.event.issue.number", run: "the research run" },
  { file: "specs.yml", job: "slice", names: "github.event.issue.number", run: "the slice run" },
  { file: "specs.yml", job: "reslice", names: "steps.ended.outputs.spec", run: "the wave check or reslice run" },
  { file: "specs.yml", job: "resume", names: "steps.resumed.outputs.spec", run: "the wave check or reslice run" },
  { file: "specs.yml", job: "check", names: "matrix.spec", run: "the done check run" },
];
const callsOwner = (step: Step) => step.uses === "./.github/actions/call-owner";

describe("a fix, research, slice, reslice, done check, closer or strip run that ends red leaves its issue and run through one shared step, which bin/rerun reads once the run completes (#1057, #1067, #1178)", () => {
  const [owned] = (parse(readFileSync(CALLER, "utf8")) as { runs: { steps: Step[] } }).runs.steps;
  const calls = (labels: string, run: string) => {
    const root = scratch("called-");
    const called = join(root, "calls");
    copyMark(root);
    script(join(root, "stub", "gh"), `printf '%s\\n' "$*" >>"${called}"\n[[ $2 == view ]] && printf '%s\\n' ${labels}\nexit 0\n`);
    const ran = ranStep(owned ?? {}, root, { PATH: `${join(root, "stub")}:${process.env.PATH}`, ISSUE: "9", RAN: run });
    expect(ran.status, ran.stderr).toBe(0);
    return { stdout: ran.stdout, gh: existsSync(called) ? readFileSync(called, "utf8") : "" };
  };

  it("the shared step leaves a notice titled owner call naming the issue and the run that stopped, and marks nothing and posts nothing itself", () => {
    expect(owned?.env?.ISSUE).toBe("${{ inputs.issue }}");
    expect(owned?.env?.RAN).toBe("${{ inputs.run }}");
    const { stdout, gh } = calls("spec", "the slice run");
    expect(stdout).toBe(`::notice title=${OWNER_CALL}::9 the slice run\n`);
    expect(gh).not.toMatch(/issue (edit|comment)|api -X POST/);
  });

  it("the shared step leaves no notice when the issue already carries paused or stuck, so nothing re-runs or marks it (#1166)", () => {
    for (const held of HELD) expect(calls(`spec ${held}`, "the slice run").stdout, held).toBe("");
  });

  it("no workflow or shared step marks a held label or comments that a run ended, which only bin/rerun does", () => {
    const ownerCall = /bin\/mark \S+ ("\$(stop|stuck|paused)"|stuck|paused)|--add-label|issue comment .*ended/;

    expect(readFileSync(CALLER, "utf8")).not.toMatch(ownerCall);
    for (const file of readdirSync(WORKFLOWS)) expect(readFileSync(join(WORKFLOWS, file), "utf8"), file).not.toMatch(ownerCall);
  });

  for (const caller of CALLERS) {
    const job = namedJob((parse(readFileSync(join(WORKFLOWS, caller.file), "utf8")) as { jobs: Record<string, Job> }).jobs, caller.job, caller.file);
    const calling = job.steps.find(callsOwner);
    const named = { ...allSkipped(job.steps), ended: { outcome: "success", conclusion: "success", outputs: { spec: "9" } }, close: { outcome: "failure", conclusion: "failure", outputs: { ticket: "9" } } };

    it(`${caller.file}'s ${caller.job} job runs the shared owner call naming its issue and run when it ends red, and not when it ends green`, () => {
      expect(calling, `a step in ${caller.file} using ./.github/actions/call-owner`).toBeDefined();
      expect(String(calling?.with?.issue)).toContain(caller.names);
      expect(calling?.with?.run).toBe(caller.run);
      expect(holds(calling?.if ?? "success()", { steps: named, failed: true })).toBe(true);
      expect(holds(calling?.if ?? "success()", { steps: named, cancelled: true })).toBe(true);
      expect(holds(calling?.if ?? "success()", { steps: named })).toBe(false);
      const logs = job.steps.findIndex((step) => step.uses === "./.github/actions/stage-logs");
      if (logs !== -1) expect(job.steps.indexOf(calling ?? {})).toBeLessThan(logs);
    });
  }

  it("the close job calls the owner on nothing when the closer stops before a ticket is in its hands", () => {
    const job = namedJob(ticketsJobs(), "close", WORKFLOW);
    const calling = job.steps.find(callsOwner);
    const unnamed = { ...allSkipped(job.steps), close: { outcome: "failure", conclusion: "failure", outputs: { ticket: "" } } };

    expect(holds(calling?.if ?? "false", { steps: unnamed, failed: true })).toBe(false);
  });

  it("the reslice job marks nothing when its run ends red before it names its spec", () => {
    const job = namedJob((parse(readFileSync(join(WORKFLOWS, "specs.yml"), "utf8")) as { jobs: Record<string, Job> }).jobs, "reslice", "specs.yml");
    const calling = job.steps.find(callsOwner);
    const unnamed = { ...allSkipped(job.steps), ended: { outcome: "failure", conclusion: "failure", outputs: { spec: "" } } };

    expect(calling).toBeDefined();
    expect(holds(calling?.if ?? "false", { steps: unnamed, failed: true })).toBe(false);
  });
});

describe("tickets.yml says in its logs when a mark fails, so a ticket whose labels lag shows why (#1081)", () => {
  const refusal = (label: string) => `mark: #9 not labelled ${label}: HTTP 403: Resource not accessible by integration`;
  const refusing = (prefix: string, gh: string) => {
    const root = scratch(prefix);
    copyMark(root);
    script(join(root, "bin", "mark"), "printf 'mark: #%s not labelled %s: HTTP 403: Resource not accessible by integration\\n' \"$1\" \"$2\" >&2\nexit 1\n");
    script(join(root, "bin", "gh"), gh);
    return root;
  };

  it("ends the start step red on bin/mark's refusal, whether it reruns checks, counts a try or builds, so a refused mark never passes unseen (#1108)", () => {
    const start = stageStep(workflow().job, "start");
    const started = (gh: string, action: string) => {
      const cwd = refusing("start-refused-", gh);
      return spawnSync("bash", ["-e", "-c", runOf(start, "9", action)], { cwd, env: { ...process.env, PATH: `${join(cwd, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: join(cwd, "output"), GITHUB_WORKSPACE: cwd }, encoding: "utf8" });
    };

    for (const [gh, action, label] of [
      ['case "$*" in *"pr view"*) printf \'OPEN\\n\' ;; *) exit 0 ;; esac\n', "reopened", "checking"],
      ["exit 1\n", "reopened", "building"],
      ["exit 1\n", "opened", "building"],
    ] as const) {
      const { status, stderr } = started(gh, action);
      expect(status, stderr).not.toBe(0);
      expect(stderr).toContain(`${refusal(label)}\n`);
    }
  });

  it("passes on bin/mark's refusal from the strip step", () => {
    const strip = namedJob(ticketsJobs(), "strip", WORKFLOW).steps.find((step) => /bin\/mark .*--closed/.test(step.run ?? "")) as Step;
    const cwd = refusing("closed-refused-", "exit 0\n");

    const { stderr } = ranStep(strip, cwd, { NUMBER: "9" });

    expect(stderr).toContain(`${refusal("--closed")}\n`);
  });
});

describe("the PR check judges only through the live release's ~/bin/check, which runs the owner's tree-wide rules itself (collod873/agent-hooks#24)", () => {
  it("fetches the live hooks before the full check, and runs no rule of its own beside it", () => {
    const { check } = (parse(readFileSync(join(WORKFLOWS, "check.yml"), "utf8")) as Workflow).jobs;
    const steps = expanded(check?.steps ?? []);
    const fetched = steps.findIndex((step) => /git clone [^\n]*--branch live /.test(step.run ?? ""));
    const checked = steps.findIndex((step) => /~\/bin\/check --full\b/.test(step.run ?? ""));

    expect(fetched).toBeGreaterThanOrEqual(0);
    expect(checked).toBeGreaterThan(fetched);
    expect(steps.filter((step) => /treewide\.py/.test(step.run ?? ""))).toEqual([]);
  });
});

describe("a red PR check keeps its whole log, not only the last 60 lines it prints", () => {
  it("names the log its verdict points at and uploads that file when the check ends red", () => {
    const { check } = (parse(readFileSync(join(WORKFLOWS, "check.yml"), "utf8")) as Workflow).jobs;
    const steps = check?.steps ?? [];
    const told = steps.find((step) => (step.run ?? "").includes("tail -n 60")) as Step;
    const runnerTemp = scratch("check-log-");
    const log = join(runnerTemp, "check-full-4baa50.log");
    writeFileSync(log, "unit: red\n");
    writeFileSync(join(runnerTemp, "check.out"), `check: red unit; log ${log}\n`);

    const { status, output } = ranStep(told, runnerTemp, { RUNNER_TEMP: runnerTemp });
    const kept = steps.find((step) => step.uses?.startsWith("actions/upload-artifact") === true);

    expect(status).toBe(0);
    expect(output.log).toBe(log);
    expect(kept?.with?.path).toBe(`\${{ steps.${told.id}.outputs.log }}`);
    expect(kept?.if).toBe(`failure() && steps.${told.id}.outputs.log != ''`);
  });
});
