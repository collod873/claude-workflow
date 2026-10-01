import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cloned, git, holds, scratch, script, type StepOutcome } from "./scenarios.ts";

const REPO = join(import.meta.dirname, "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const WORKFLOW = join(WORKFLOWS, "build.yml");
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

function workflow(): { on: Workflow["on"]; job: Job } {
  const { on, jobs } = parse(readFileSync(WORKFLOW, "utf8")) as Workflow;
  const building = Object.values(jobs).filter(({ steps }) => steps.some((step) => /(^|\s|\/)bin\/fix(\s|$)/.test(step.run ?? "")));
  expect(building).toHaveLength(1);
  const [job] = building;
  if (job === undefined) throw new Error(`no job that runs bin/fix in ${WORKFLOW}`);
  return { on, job };
}

function stageStep(job: Job, stage: Stage): Step {
  const step = job.steps.find((candidate) => candidate.id === stage);
  expect(step, `a step with the id ${stage}`).toBeDefined();
  return step as Step;
}

function stagesRun(job: Job, failing: Stage | undefined, given: Record<string, Record<string, string>> = {}): Stage[] {
  const outputs: Record<string, Record<string, string>> = { admit: { admitted: "true" }, ...given };
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

describe("build.yml builds a ticket the moment it is filed (#826)", () => {
  it("an issue labelled note starts no build", () => {
    const { on, job } = workflow();
    const starts = (labels: string[]) => holds(job.if ?? "true", { labels });

    expect(on.issues?.types).toContain("opened");
    expect(starts([])).toBe(true);
    expect(starts(["ticket"])).toBe(true);
    expect(starts(["note"])).toBe(false);
    expect(starts(["ticket", "note"])).toBe(false);
  });

  it("an issue labelled spec starts no build", () => {
    const { job } = workflow();
    const starts = (labels: string[]) => holds(job.if ?? "true", { labels });

    expect(starts(["spec"])).toBe(false);
    expect(starts(["ticket", "spec"])).toBe(false);
  });

  it("an issue a stranger files or reopens starts no build, since its checks run as shell with the App's token", () => {
    const { job } = workflow();
    const starts = (sender: string) => holds(job.if ?? "true", { sender });

    expect(starts("collod873")).toBe(true);
    expect(starts("stranger")).toBe(false);
  });

  it("every ticket the App opens reaches bin/fix, which holds it to a follow-up or an owner's open spec, and nothing a stranger files does (#865, #1022)", () => {
    const { job } = workflow();
    const starts = (sender: string, body: string) => holds(job.if ?? "true", { sender, body });
    const followUp = "## Why\n\nFollow-up of #865: its review found this after the builder's one turn.\n";

    expect(starts("collod873-machine[bot]", followUp)).toBe(true);
    expect(starts("collod873-machine[bot]", "## Why\n\nA ticket the slicer filed under a spec.\n")).toBe(true);
    expect(starts("stranger", followUp)).toBe(false);
    expect(holds(job.if ?? "true", { sender: "collod873-machine[bot]", body: followUp, labels: ["note"] })).toBe(false);
  });

  it("builds nothing on the App's reopen", () => {
    const { job } = workflow();
    const followUp = "## Why\n\nFollow-up of #865: its review found this after the builder's one turn.\n";

    expect(holds(job.if ?? "true", { sender: "collod873-machine[bot]", body: followUp, action: "opened" })).toBe(true);
    expect(holds(job.if ?? "true", { sender: "collod873-machine[bot]", body: followUp, action: "reopened" })).toBe(false);
    expect(holds(job.if ?? "true", { sender: "collod873-machine[bot]", action: "unlabeled", label: "waiting", body: "## Why\n\nThe owner's own words.\n" })).toBe(true);
  });

  it("a ticket split by its builder builds what waited once `waiting` comes off, and no other label change starts a build (#910)", () => {
    const { on, job } = workflow();
    const starts = (sender: string, label: string) => holds(job.if ?? "true", { sender, action: "unlabeled", label, body: "## Why\n\nThe owner's own words.\n" });

    expect(on.issues?.types).toContain("unlabeled");
    expect(starts("collod873-machine[bot]", "waiting")).toBe(true);
    expect(starts("collod873", "waiting")).toBe(true);
    expect(starts("collod873-machine[bot]", "fixing")).toBe(false);
    expect(starts("collod873", "needs-human")).toBe(false);
    expect(starts("stranger", "waiting")).toBe(false);
    expect(holds(job.if ?? "true", { sender: "collod873-machine[bot]", action: "unlabeled", label: "waiting", labels: ["note"] })).toBe(false);
  });

  it("a follow-up the reviewer files labelled `waiting` starts no build when opened, only once `waiting` comes off (#1033)", () => {
    const { job } = workflow();
    const followUp = "## Why\n\nFollow-up of #865: its review found this after its builder's repair.\n";

    expect(holds(job.if ?? "true", { sender: "collod873-machine[bot]", body: followUp, action: "opened", labels: ["waiting"] })).toBe(false);
    expect(holds(job.if ?? "true", { sender: "collod873-machine[bot]", body: followUp, action: "unlabeled", label: "waiting" })).toBe(true);
  });

  it("admits the ticket before start marks it, and a refused ticket runs neither start nor its builder, ending green so no Fix starts (#1022)", () => {
    const { job } = workflow();
    const admit = job.steps.find((step) => step.id === "admit");

    expect(admit?.run).toMatch(/bin\/admit \$\{\{ github\.event\.issue\.number \}\} >>"\$GITHUB_OUTPUT"/);
    expect(String(admit?.env?.GH_TOKEN)).toMatch(/steps\.app\.outputs\.token/);
    expect(job.steps.indexOf(admit as Step)).toBeLessThan(job.steps.indexOf(stageStep(job, "start")));
    expect(stagesRun(job, undefined, { admit: { admitted: "false" } })).toEqual([]);
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
    const checkouts = job.steps.filter((step) => step.uses?.startsWith("actions/checkout@") === true);

    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) {
      expect(String(checkout.with?.token)).toMatch(token);
      expect(checkout.with?.["persist-credentials"]).not.toBe(false);
    }
  });

  it("keeps the session the builder built in, whatever ended it, so the first red resumes it through fix.yml (#931)", () => {
    const { job } = workflow();
    const fix = namedJob(fixWorkflow().jobs, "fix", FIX_WORKFLOW);
    const saved = job.steps.find((step) => step.uses?.startsWith("actions/cache/save@") === true);
    const restored = fix.steps.find((step) => step.uses?.startsWith("actions/cache/restore@") === true);
    const key = String(saved?.with?.key).replace("${{ github.event.issue.number }}", "9");
    const resumedFrom = String(restored?.with?.["restore-keys"]).replace("${{ env.HEAD_REF }}", "ticket/9");
    const ended = (fixed: string) => holds(saved?.if ?? "success()", { steps: { ...allSkipped(job.steps), fix: outcome(fixed) }, failed: fixed === "failure" });

    expect(job["cache-mode"]).toBe("write");
    expect(saved?.with?.path).toBe(restored?.with?.path);
    expect(key.startsWith(resumedFrom), `${key} resumes from ${resumedFrom}`).toBe(true);
    expect(ended("success")).toBe(true);
    expect(ended("failure")).toBe(true);
    expect(ended("skipped")).toBe(false);
  });
});

describe("build.yml checks out main as it is when the job runs, not the SHA of the issue event (#860)", () => {
  it("every checkout in build.yml pins a ref, so a rerun after a merge starts from fresh main as it is when the job runs, not the stale SHA the issue event carried", () => {
    const { jobs } = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> };
    const checkouts = Object.values(jobs).flatMap((job) => job.steps.filter((step) => step.uses?.startsWith("actions/checkout@") === true));

    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) expect(checkout.with?.ref, JSON.stringify(checkout)).toBe("main");
  });
});

function expanded(steps: Step[]): Step[] {
  return steps.flatMap((step) => {
    if (step.uses?.startsWith("./") !== true) return [step];
    const action = parse(readFileSync(join(REPO, step.uses, "action.yml"), "utf8")) as { runs: { steps: Step[] } };
    return action.runs.steps.map((inner) => ({ ...inner, if: inner.if ?? step.if }));
  });
}

const everyJob = (): Job[] =>
  readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => Object.values((parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow).jobs))
    .map((job) => ({ ...job, steps: expanded(job.steps) }));
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

  it("every job hands its stages the owner's hooks, read with a token that can only read agent-hooks", () => {
    for (const { steps } of modelJobs()) {
      const minted = steps.findIndex((step) => step.with?.repositories === "agent-hooks");
      const handed = steps.findIndex((step) => /AGENT_HOOKS_SETTINGS=.*GITHUB_ENV/.test(step.run ?? ""));
      expect(steps[minted]?.with).toMatchObject({ owner: "collod873", "permission-contents": "read" });
      expect(minted).toBeGreaterThanOrEqual(0);
      expect(handed).toBeGreaterThan(minted);
      expect(handed).toBeLessThan(steps.findIndex(spendsModel));
    }
  });

  it("every job files its stages' captures into the knowledge base whatever ended it, with a write token minted only after the model is done", () => {
    for (const { steps } of modelJobs()) {
      const minted = steps.findIndex((step) => step.with?.repositories === "Knowledge-Base" && step.with["permission-contents"] !== "read");
      const filed = steps.findIndex((step) => /Knowledge-Base\/raw/.test(step.run ?? ""));
      const lastModel = steps.length - 1 - [...steps].reverse().findIndex(spendsModel);
      expect(steps[minted]?.with).toMatchObject({ owner: "collod873", "permission-contents": "write" });
      expect(minted).toBeGreaterThan(lastModel);
      expect(filed).toBeGreaterThan(minted);
      expect(steps[minted]?.if).toBe("always()");
      expect(steps[filed]?.if).toBe("always()");
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

  it("every step that spends a model shows what its stage's model does in the log as it happens, and ends with the stage's own status", () => {
    for (const step of modelJobs().flatMap(({ steps }) => steps.filter(spendsModel))) {
      const run = (step.run ?? "").replaceAll(BARE_EXPRESSIONS, "9");
      const transcript = `.git/machine-logs/${transcriptOf(run)}-9.jsonl`;
      const cwd = scratch("feed-");
      mkdirSync(join(cwd, ".git", "machine-logs"), { recursive: true });
      const stage = [`printf '%s\\n' '${JSON.stringify(SAID)}' >>${transcript}`, "sleep 1.5", "exit 3"].join("\n");

      const watched = spawnSync("bash", ["-e", "-c", `${run.split("\n")[0]}\n${stage}`], { cwd, env: { ...process.env, FEED, HEAD_REF: "ticket/9", TICKET: "9" }, encoding: "utf8", timeout: 10000 });

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

const FIX_WORKFLOW = join(WORKFLOWS, "fix.yml");
const BARE_EXPRESSIONS = /\$\{\{[^}]*\}\}/g;

function fixWorkflow(): { on: { workflow_run?: { workflows?: string[]; types?: string[] }; issues?: { types?: string[] } }; jobs: Record<string, Job> } {
  return parse(readFileSync(FIX_WORKFLOW, "utf8")) as { on: { workflow_run?: { workflows?: string[]; types?: string[] } }; jobs: Record<string, Job> };
}

function ranStep(step: Step, cwd: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string; output: Record<string, string> } {
  const output = join(cwd, "..", `output-${Math.random().toString(36).slice(2)}`);
  const outsideGit = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const ran = spawnSync("bash", ["-e", "-c", (step.run ?? "").replaceAll(BARE_EXPRESSIONS, "owner")], { cwd, env: { ...outsideGit, GITHUB_OUTPUT: output, ...env }, encoding: "utf8" });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, output: parseOutput(output) };
}

function lookedUp(env: Record<string, string>, labels = ""): ReturnType<typeof ranStep> {
  const which = namedJob(fixWorkflow().jobs, "which", FIX_WORKFLOW).steps.find((step) => step.id === "which") as Step;
  const root = scratch("which-");
  script(join(root, "bin", "gh"), `printf '%s\\n' ${labels}\n`);
  return ranStep(which, root, { ISSUE: "", RAN: "", RAN_ON: "", TITLE: "", PATH: `${join(root, "bin")}:${process.env.PATH}`, ...env });
}

const ticketNamed = (env: Record<string, string>, labels = ""): string | undefined => lookedUp(env, labels).output.ticket;

describe("fix.yml hands every red run of a ticket to its builder, however the run died (#898)", () => {
  it("starts on GitHub's own word that a Build or Check run finished", () => {
    const { on } = fixWorkflow();

    expect(on.workflow_run?.workflows).toEqual(["Build", "Check"]);
    expect(on.workflow_run?.types).toEqual(["completed"]);
  });

  it("starts the builder on no reopen", () => {
    const { on } = parse(readFileSync(FIX_WORKFLOW, "utf8")) as { on: Record<string, unknown> };

    expect(on.workflow_run).toBeDefined();
    expect(on.workflow_dispatch).toBeDefined();
    expect(on.issues).toBeUndefined();
  });

  it("reads the ticket from a Check run's branch, a Build run's name, or the closer's dispatch, and from nothing else", () => {
    const buildName = (parse(readFileSync(WORKFLOW, "utf8")) as { "run-name": string })["run-name"]
      .replace("${{ github.event.issue.number }}", "894")
      .replace("${{ github.event.issue.title }}", "Give the Builder's one turn a single record: ticket/5");

    expect(ticketNamed({ RAN: ".github/workflows/check.yml", RAN_ON: "ticket/891", TITLE: "Stamp the session id" })).toBe("891");
    expect(ticketNamed({ RAN: ".github/workflows/build.yml", RAN_ON: "main", TITLE: buildName })).toBe("894");
    expect(ticketNamed({ DISPATCHED: "812" })).toBe("812");
    expect(ticketNamed({ RAN: ".github/workflows/check.yml", RAN_ON: "land/4b58f3372b91", TITLE: "Build ticket/7: a land PR's title" })).toBe("");
  });

  it("starts no builder on a red run of a ticket labelled needs-human, whose builder already called the owner, but does on the closer's dispatch (#931)", () => {
    const building = { RAN: ".github/workflows/build.yml", RAN_ON: "main", TITLE: "Build ticket/9: Give the builder the build" };
    const checking = { RAN: ".github/workflows/check.yml", RAN_ON: "ticket/9", TITLE: "Give the builder the build" };

    expect(ticketNamed(building, "2-building needs-human")).toBe("");
    expect(ticketNamed(checking, "needs-human")).toBe("");
    expect(ticketNamed(building, "2-building")).toBe("9");
    expect(ticketNamed(checking, "3-checking")).toBe("9");
    expect(ticketNamed({ DISPATCHED: "9" }, "needs-human")).toBe("9");
  });

  it("goes red, rather than skipping green, when a red Build run's name carries no ticket, so a red nobody fixes still shows", () => {
    const nameless = lookedUp({ RAN: ".github/workflows/build.yml", RAN_ON: "main", TITLE: "Build" });

    expect(nameless.status).not.toBe(0);
    expect(nameless.stderr).toContain("Build");
    expect(nameless.output.ticket).toBeUndefined();
  });

  it("stands down, spending no model, when the ticket moved on since the run that went red", () => {
    const fix = namedJob(fixWorkflow().jobs, "fix", FIX_WORKFLOW);
    const branch = fix.steps.find((step) => step.id === "branch") as Step;
    const root = scratch("fix-branch-");
    const { session } = cloned(root, "main as it was");
    git(session, "checkout", "--quiet", "-b", "ticket/9");
    git(session, "commit", "--quiet", "--allow-empty", "-m", "Build #9 against its failing tests");
    const judged = git(session, "rev-parse", "HEAD");
    git(session, "push", "--quiet", "origin", "ticket/9");
    git(session, "checkout", "--quiet", "main");
    const env = { HEAD_REF: "ticket/9", EVENT: "workflow_run", RAN: ".github/workflows/check.yml", ENDED: "2026-09-25T02:37:28Z" };

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

  it("calls the owner by name whatever ends the builder's job, unless the builder already did", () => {
    const job = namedJob(fixWorkflow().jobs, "fix", FIX_WORKFLOW);
    const calling = job.steps.find((step) => /gh issue comment/.test(step.run ?? "")) as Step;
    const labelled = (labels: string) => {
      const root = scratch("fix-called-");
      const calls = join(root, "calls");
      script(join(root, "bin", "gh"), `printf '%s\\n' "$*" >>"${calls}"\n[[ $2 == view ]] && printf '%s\\n' ${labels}\nexit 0\n`);
      ranStep(calling, root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, TICKET: "9" });
      return existsSync(calls) ? readFileSync(calls, "utf8") : "";
    };

    expect(holdsAlone(calling.if ?? "success()", job.steps, { failed: true })).toBe(true);
    expect(holdsAlone(calling.if ?? "success()", job.steps, { cancelled: true })).toBe(true);
    expect(labelled("fixing")).toMatch(/issue edit 9 --add-label needs-human/);
    expect(labelled("fixing")).toMatch(/issue comment 9 --body @owner /);
    expect(labelled("fixing needs-human")).not.toMatch(/issue (edit|comment)/);
  });

  it("saves the builder's session when a finished run woke it, which GitHub otherwise gives a read-only cache", () => {
    const fix = namedJob(fixWorkflow().jobs, "fix", FIX_WORKFLOW);

    expect(fix.steps.some((step) => step.uses?.startsWith("actions/cache/save@"))).toBe(true);
    expect(fix["cache-mode"]).toBe("write");
  });
});

describe("every step that runs gh names its repo, since gh otherwise reads it from a checkout that may never have run (#864)", () => {
  it("every step that runs gh sets GH_REPO or runs only once a checkout succeeded", () => {
    const runsGh = (step: Step) => /(^|[\s|;&(])gh\s/.test(step.run ?? "");
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

describe("build.yml re-runs an open PR's failed checks instead of building, when the owner reopens a ticket whose PR is open (#851)", () => {
  it("builds nothing and re-runs the failed checks when the owner reopens a ticket whose PR is open, but still builds when it has none", () => {
    const { job } = workflow();
    const start = stageStep(job, "start");

    const withOpenPr = scratch("reopen-open-");
    const openCalls = join(withOpenPr, "calls");
    const openOutput = join(withOpenPr, "output");
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
    const opened = spawnSync("bash", ["-e", "-c", runOf(start, "9", "reopened")], {
      cwd: withOpenPr,
      env: { ...process.env, PATH: `${join(withOpenPr, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: openOutput },
      encoding: "utf8",
    });

    expect(opened.status, opened.stderr).toBe(0);
    const openLog = readFileSync(openCalls, "utf8");
    expect(openLog).not.toContain("mark 9 1-defining");
    expect(openLog).toMatch(/rerun/i);
    expect(stagesRun(job, undefined, { start: parseOutput(openOutput) })).toEqual(["start"]);

    const withNoPr = scratch("reopen-none-");
    const noCalls = join(withNoPr, "calls");
    const noOutput = join(withNoPr, "output");
    script(join(withNoPr, "bin", "mark"), `printf 'mark %s\\n' "$*" >>"${noCalls}"\n`);
    script(
      join(withNoPr, "bin", "gh"),
      [`printf '%s\\n' "$*" >>"${noCalls}"`, 'case "$*" in', '  *"pr view ticket/9"*) exit 1 ;;', '  *"pr checks ticket/9"*) exit 1 ;;', "  *) exit 0 ;;", "esac", ""].join(
        "\n",
      ),
    );
    const none = spawnSync("bash", ["-e", "-c", runOf(start, "9", "reopened")], {
      cwd: withNoPr,
      env: { ...process.env, PATH: `${join(withNoPr, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: noOutput },
      encoding: "utf8",
    });

    expect(none.status, none.stderr).toBe(0);
    expect(readFileSync(noCalls, "utf8")).toContain("mark 9 1-defining");
    expect(stagesRun(job, undefined, { start: parseOutput(noOutput) })).toEqual(["start", "fix"]);
  });
});

const CALLERS = [
  { file: "research.yml", job: "research", names: "github.event.issue.number" },
  { file: "slice.yml", job: "slice", names: "github.event.issue.number" },
  { file: "reslice.yml", job: "reslice", names: "steps.ended.outputs.spec" },
  { file: "done-check.yml", job: "check", names: "github.event.issue.number" },
];

describe("a research, slice, reslice or done check run that ends red marks its issue needs-human and calls the owner, so it leaves a trace (#1057)", () => {
  for (const caller of CALLERS) {
    const job = namedJob((parse(readFileSync(join(WORKFLOWS, caller.file), "utf8")) as { jobs: Record<string, Job> }).jobs, caller.job, caller.file);
    const calling = job.steps.find((step) => /bin\/mark "\$ISSUE" needs-human/.test(step.run ?? ""));
    const named = { ...allSkipped(job.steps), ended: { outcome: "success", conclusion: "success", outputs: { spec: "9" } } };
    const calls = (labels: string) => {
      const root = scratch("called-");
      const called = join(root, "calls");
      mkdirSync(join(root, "bin"), { recursive: true });
      copyFileSync(join(REPO, "bin", "mark"), join(root, "bin", "mark"));
      script(join(root, "stub", "gh"), `printf '%s\\n' "$*" >>"${called}"\n[[ $2 == view ]] && printf '%s\\n' ${labels}\nexit 0\n`);
      const ran = ranStep(calling ?? {}, root, { PATH: `${join(root, "stub")}:${process.env.PATH}`, ISSUE: "9" });
      expect(ran.status, ran.stderr).toBe(0);
      return existsSync(called) ? readFileSync(called, "utf8") : "";
    };

    it(`${caller.file} marks its issue and comments to the owner with the run's link when it ends red, and not when it ends green`, () => {
      expect(calling, `a step in ${caller.file} running bin/mark "$ISSUE" needs-human`).toBeDefined();
      expect(String(calling?.env?.ISSUE)).toContain(caller.names);
      expect(holds(calling?.if ?? "success()", { steps: named, failed: true })).toBe(true);
      expect(holds(calling?.if ?? "success()", { steps: named, cancelled: true })).toBe(true);
      expect(holds(calling?.if ?? "success()", { steps: named })).toBe(false);
      expect(job.steps.indexOf(calling ?? {})).toBeLessThan(job.steps.findIndex((step) => step.uses === "./.github/actions/stage-logs"));
      expect(calls("spec")).toMatch(/issue edit 9 --add-label needs-human/);
      expect(calls("spec")).toMatch(/issue comment 9 --body @owner .*\/actions\/runs\/owner/);
    });

    it(`${caller.file} does nothing when its issue already carries needs-human`, () => {
      expect(calls("spec needs-human")).not.toMatch(/issue (edit|comment)/);
    });
  }

  it("reslice.yml marks nothing when its run ends red before it names its spec", () => {
    const job = namedJob((parse(readFileSync(join(WORKFLOWS, "reslice.yml"), "utf8")) as { jobs: Record<string, Job> }).jobs, "reslice", "reslice.yml");
    const calling = job.steps.find((step) => /bin\/mark "\$ISSUE" needs-human/.test(step.run ?? ""));
    const unnamed = { ...allSkipped(job.steps), ended: { outcome: "failure", conclusion: "failure", outputs: { spec: "" } } };

    expect(holds(calling?.if ?? "false", { steps: unnamed, failed: true })).toBe(false);
  });
});
