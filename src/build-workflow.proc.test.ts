import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { holds, scratch, script, type StepOutcome } from "./scenarios.ts";

const REPO = join(import.meta.dirname, "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const WORKFLOW = join(WORKFLOWS, "build.yml");
const FEED = join(REPO, ".github", "actions", "stage", "feed.jq");
const STAGES = ["start", "test-author", "build", "save"] as const;
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
  env?: Record<string, unknown>;
  steps: Step[];
}

interface Workflow {
  on: { issues?: { types?: string[] } };
  jobs: Record<string, Job>;
}

function workflow(): { on: Workflow["on"]; job: Job } {
  const { on, jobs } = parse(readFileSync(WORKFLOW, "utf8")) as Workflow;
  const building = Object.values(jobs).filter(({ steps }) => steps.some((step) => /(^|\s|\/)bin\/start(\s|$)/.test(step.run ?? "")));
  expect(building).toHaveLength(1);
  return { on, job: building[0] };
}

function stageStep(job: Job, stage: Stage): Step {
  const step = job.steps.find((candidate) => new RegExp(`(^|\\s|/)bin/${stage}(\\s|$)`).test(candidate.run ?? ""));
  expect(step, `a step that runs bin/${stage}`).toBeDefined();
  return step as Step;
}

function stagesRun(job: Job, failing: Stage | undefined, outputs: Record<string, Record<string, string>> = {}): Stage[] {
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

  it("an issue anyone but the owner files or reopens starts no build, since its checks run as shell with the App's token", () => {
    const { job } = workflow();
    const starts = (sender: string) => holds(job.if ?? "true", { sender });

    expect(starts("collod873")).toBe(true);
    expect(starts("stranger")).toBe(false);
    expect(starts("collod873-machine[bot]")).toBe(false);
  });

  it("the branch is saved when the build ends red and nothing runs after a start refusal", () => {
    const { job } = workflow();

    expect(stagesRun(job, "start")).toEqual(["start"]);
    expect(stagesRun(job, "test-author")).toEqual(["start", "test-author", "save"]);
    expect(stagesRun(job, "build")).toEqual(["start", "test-author", "build", "save"]);
    expect(stagesRun(job, undefined)).toEqual(["start", "test-author", "build", "save"]);
    const at = STAGES.map((stage) => job.steps.indexOf(stageStep(job, stage)));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("every stage has its own time cap and the run acts as the App", () => {
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
    for (const checkout of job.steps.filter((step) => step.uses?.startsWith("actions/checkout@") === true)) {
      expect(String(checkout.with?.token)).toMatch(token);
    }
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
      const minted = steps.findIndex((step) => step.with?.repositories === "Knowledge-Base");
      const filed = steps.findIndex((step) => /Knowledge-Base\/raw/.test(step.run ?? ""));
      const lastModel = steps.length - 1 - [...steps].reverse().findIndex(spendsModel);
      expect(steps[minted]?.with).toMatchObject({ owner: "collod873", "permission-contents": "write" });
      expect(minted).toBeGreaterThan(lastModel);
      expect(filed).toBeGreaterThan(minted);
      expect(steps[minted].if).toBe("always()");
      expect(steps[filed].if).toBe("always()");
    }
  });

  it("every job keeps its machine logs as a run artifact, whatever ended it", () => {
    for (const { steps } of modelJobs()) {
      const last = steps[steps.length - 1];
      expect(last.uses).toMatch(/^actions\/upload-artifact@/);
      expect(last.if).toBe("always()");
      expect(last.with).toMatchObject({ path: ".git/machine-logs", "include-hidden-files": true });
    }
  });

  it("every step that spends a model shows what its stage's model does in the log as it happens, and ends with the stage's own status", () => {
    for (const step of modelJobs().flatMap(({ steps }) => steps.filter(spendsModel))) {
      const run = (step.run ?? "").replaceAll(/\$\{\{ github\.event\.(issue|pull_request)\.number \}\}/g, "9");
      const transcript = `.git/machine-logs/${transcriptOf(run)}-9.jsonl`;
      const cwd = scratch("feed-");
      mkdirSync(join(cwd, ".git", "machine-logs"), { recursive: true });
      const stage = [`printf '%s\\n' '${JSON.stringify(SAID)}' >>${transcript}`, "sleep 1.5", "exit 3"].join("\n");

      const watched = spawnSync("bash", ["-e", "-c", `${run.split("\n")[0]}\n${stage}`], { cwd, env: { ...process.env, FEED, HEAD_REF: "ticket/9" }, encoding: "utf8", timeout: 10000 });

      expect(watched.stdout).toContain("said: reading the brief");
      expect(watched.status).toBe(3);
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
    script(join(withOpenPr, "bin", "mark"), "exit 0\n");
    script(join(withOpenPr, "bin", "start"), `printf 'start called\\n' >>"${openCalls}"\n`);
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
    expect(openLog).not.toContain("start called");
    expect(openLog).toMatch(/rerun/i);
    expect(stagesRun(job, undefined, { start: parseOutput(openOutput) })).toEqual(["start"]);

    const withNoPr = scratch("reopen-none-");
    const noCalls = join(withNoPr, "calls");
    const noOutput = join(withNoPr, "output");
    script(join(withNoPr, "bin", "mark"), "exit 0\n");
    script(join(withNoPr, "bin", "start"), `printf 'start called\\n' >>"${noCalls}"\n`);
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
    expect(readFileSync(noCalls, "utf8")).toContain("start called");
    expect(stagesRun(job, undefined, { start: parseOutput(noOutput) })).toEqual(["start", "test-author", "build", "save"]);
  });
});
