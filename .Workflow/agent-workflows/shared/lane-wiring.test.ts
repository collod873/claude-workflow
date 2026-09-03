import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECONCILE_DISPATCH_ACTIONS, SESSION_CAPTURED_DISPATCH_ACTION, TO_BUILD_LABEL } from "../dispatch/reconcile";
import { derivedSecretNames } from "../enrol/secrets";
import { IMPLEMENT_DISPATCH_EVENT_TYPE } from "../implement/implement";
import { GATE_JOB, IMMUTABILITY_JOB } from "../integrate/integrate";
import { BYPASS_STEP } from "../watchdog/bypass";
import { AUDIT_DISPATCH_ACTION, KNOWLEDGE_BASE_CHECKOUT_DIR } from "../observations/run-audit";
import { RATIFIER_PR_TITLE } from "../ratify/land";
import { CLOSE_STATE_REASON, PRD_LABEL } from "../ratify/prd-close";
import { LABELS_APPLIED } from "../shape/shape";
import { SLICEABLE_LABEL, SPEC_DISPATCH_EVENT_TYPE } from "../spec/open-questions";
import { STAGES } from "../to-tickets/to-tickets";
import { WATCHDOG_DISPATCH_ACTION } from "../watchdog/run-watchdog";
import { expectMachineAndTargetCheckouts } from "./checkout-pair.fixture";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";
import {
  doors,
  LANE_OWNED,
  LANE_WIRING,
  MACHINE_REPOSITORY,
  OWNER_GATE,
  SHAPE_LABELS_APPLIED,
  type Checkout,
  type Gate,
  type JobFacts,
  type LaneWiring,
  type StepFact,
} from "./lane-wiring";
import { GRAPH_CHANGED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "./ready-set";
import { readWorkflow, readWorkflows, STUB_SUFFIX, WORKFLOWS_DIR, workflowNames } from "./read-workflow";
import { binSources, entrypointsOf, envReadsOf, repoFileExists } from "./repo-sources";
import { VERIFY_DISPATCH_EVENT_TYPE } from "./verify-dispatch";

/**
 * `LANE_WIRING`, read back against `.github/workflows`. Every row is one lane's claim about its
 * reusable workflow and its caller stub, and every `it` below is that claim held to the YAML —
 * see `lane-wiring.ts` for why the facts live in one table rather than one file per lane.
 *
 * The estate-wide sweeps at the bottom are the ones no other file already carries: every file
 * parses; every caller pins its reusable half at `@main` and inherits secrets exactly when that
 * half spends one; every `npx tsx` entrypoint exists; every label a lane creates is created
 * idempotently; every variable an entrypoint reads is set by the job that runs it. The token,
 * committer, runner-input, dead-run and display-name sweeps stay where they are
 * (`workflow-permissions`, `runner-committer`, `lane-invariants`, `lane-identity`).
 */

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  "working-directory"?: string;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string[];
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps?: Step[];
  uses?: string;
  with?: Record<string, string>;
  secrets?: string;
}
interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, Job>;
}
interface CallOn {
  workflow_call?: { inputs?: Record<string, { required?: boolean; default?: string }> };
}

const rows = Object.entries(LANE_WIRING).map(([lane, row]) => ({ lane, row, file: `${lane}.yml` }));
const estate = readWorkflows<Workflow>();
const stubOf = (lane: string) => `${lane}${STUB_SUFFIX}`;

/* -------------------------------------------------------------------------------------------- */
/* Assertion vocabulary                                                                          */
/* -------------------------------------------------------------------------------------------- */

function expectGate(condition: string, gate: Gate): void {
  if (gate.is !== undefined) expect(condition).toBe(gate.is);
  for (const action of gate.actions ?? []) expect(condition).toContain(`github.event.action == '${action}'`);
  if (gate.actions) expect(condition.match(/github\.event\.action ==/g) ?? []).toHaveLength(gate.actions.length);
  for (const fragment of gate.has ?? []) expect(condition).toContain(fragment);
  for (const fragment of gate.lacks ?? []) expect(condition).not.toContain(fragment);
  const branches = condition.split(") ||").map((branch) => branch.trim());
  if (gate.doors !== undefined) expect(branches).toHaveLength(gate.doors);
  if (gate.ownerGatesIssues) {
    for (const branch of branches) {
      expect(branch.includes(OWNER_GATE), `owner gate on: ${branch}`).toBe(branch.includes("github.event_name == 'issues'"));
    }
  }
}

function stepIndex(steps: Step[], name: string): number {
  const index = steps.findIndex((step) => step.name === name);
  expect(index, `no step named "${name}"`).toBeGreaterThanOrEqual(0);
  return index;
}

function expectStep(steps: Step[], fact: StepFact): void {
  const matches = steps.filter(
    (step) =>
      (fact.name === undefined || step.name === fact.name) &&
      (fact.id === undefined || step.id === fact.id) &&
      (fact.uses === undefined || step.uses === fact.uses) &&
      (fact.with?.phase === undefined || step.with?.phase === fact.with.phase),
  );
  const label = fact.name ?? fact.id ?? `${fact.uses} ${fact.with?.phase ?? ""}`;
  if (fact.absent) {
    expect(matches, `${label} should not exist`).toEqual([]);
    return;
  }
  const step = matches[0];
  expect(step, `no step matches ${label}`).toBeDefined();
  const at = steps.indexOf(step);

  if (fact.if !== undefined) expect(step.if).toBe(fact.if);
  for (const fragment of fact.run ?? []) expect(step.run, label).toContain(fragment);
  for (const fragment of fact.runLacks ?? []) expect(step.run ?? "").not.toContain(fragment);
  if (fact.env) expect(step.env).toMatchObject(fact.env);
  if (fact.with) expect(step.with).toMatchObject(fact.with);
  if (fact.workingDirectory !== undefined) expect(step["working-directory"]).toBe(fact.workingDirectory);
  if (fact.index !== undefined) expect(at).toBe(fact.index);
  if (fact.follows !== undefined) expect(at).toBe(stepIndex(steps, fact.follows) + 1);
  if (fact.before !== undefined) expect(at).toBeLessThan(stepIndex(steps, fact.before));
  if (fact.after !== undefined) expect(at).toBeGreaterThan(stepIndex(steps, fact.after));
}

function expectCheckout(file: string, jobName: string, facts: JobFacts, steps: Step[]): void {
  const shape: Checkout = facts.checkout ?? "none";
  const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  const machine = steps.find((step) => step.name === "Checkout machine");

  if (shape === "none") {
    expect(checkouts).toEqual([]);
  } else if (shape === "plain") {
    // One checkout of this repository itself: a lane that only ever runs here has no target.
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with?.repository).toBeUndefined();
  } else if (shape === "machine") {
    expect(machine?.with?.repository).toBe(MACHINE_REPOSITORY);
    expect(steps.some((step) => step.name?.startsWith("Checkout target"))).toBe(false);
  } else {
    const pair = shape === "pair" ? { pair: true as const } : shape;
    expectMachineAndTargetCheckouts({
      workflow: file,
      job: jobName,
      runs: pair.workspace === false ? undefined : facts.runs,
      targets: pair.targets,
      fetchDepth: pair.fetchDepth,
    });
  }
}

function expectJob(file: string, jobName: string, facts: JobFacts, job: Job | undefined): void {
  expect(job, `${file} has no job ${jobName}`).toBeDefined();
  const steps = job?.steps ?? [];

  if (facts.name !== undefined) expect(job?.name).toBe(facts.name);
  if (facts.gate) expectGate(job?.if ?? "", facts.gate);
  if (facts.ungated) expect(job?.if).toBeUndefined();
  if (facts.needs) expect(job?.needs).toEqual(facts.needs);
  if (facts.runs !== undefined) expect(steps.some((step) => step.run?.includes(facts.runs as string)), `runs ${facts.runs}`).toBe(true);
  expectCheckout(file, jobName, facts, steps);
  if (facts.permissions === null) expect(job?.permissions).toBeUndefined();
  else if (facts.permissions) expect(job?.permissions).toEqual(facts.permissions);
  for (const [name, value] of Object.entries(facts.env ?? {})) {
    if (value === true) expect(job?.env, `${jobName} sets ${name}`).toHaveProperty(name);
    else expect(job?.env?.[name]).toBe(value);
  }
  if (facts.timeout !== undefined) expect(job?.["timeout-minutes"]).toBe(facts.timeout);
  if (facts.secrets === false) expect(JSON.stringify(job)).not.toMatch(/secrets\./);
  for (const fact of facts.steps ?? []) expectStep(steps, fact);
}

/* -------------------------------------------------------------------------------------------- */
/* The table, row by row                                                                         */
/* -------------------------------------------------------------------------------------------- */

describe("LANE_WIRING names every workflow file in the estate", () => {
  it("has a row for every file, and a file for every row", () => {
    const claimed = rows.flatMap(({ lane, row, file }) => [file, ...(row.caller ? [stubOf(lane)] : [])]);
    expect([...claimed].sort()).toEqual(workflowNames().sort());
  });
});

describe.each(rows)("$lane", ({ lane, row, file }) => {
  const { workflow, source } = readWorkflow<Workflow>(file);
  const on = workflow.on ?? {};

  if (row.caller) {
    const caller = row.caller;
    it("has a caller stub carrying the plain name, exactly these doors, and this grant", () => {
      const stub = readWorkflow<Workflow>(stubOf(lane)).workflow;
      const jobs = Object.values(stub.jobs ?? {});
      expect(stub.name).toBe(caller.name);
      expect(doors(stub.on)).toEqual(caller.on);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].permissions).toEqual(caller.permissions);
      if (caller.gate) expectGate(jobs[0].if ?? "", caller.gate);
      else expect(jobs[0].if).toBeUndefined();
      // A subset: a caller may pass a fact of its own the machine has no row for (`fixer-caller.yml`'s
      // `test_dir`, which is this repository's answer and not the lane's).
      if (caller.with) expect(jobs[0].with).toMatchObject(caller.with);
      else expect(jobs[0].with).toBeUndefined();
    });

    it("is reusable: its own on: is workflow_call and nothing else", () => {
      expect(Object.keys(on)).toEqual(["workflow_call"]);
    });
  } else {
    it("is standalone: fires on exactly these doors and has no caller stub", () => {
      expect(doors(on)).toEqual(row.on);
      expect(workflowNames()).not.toContain(stubOf(lane));
    });
  }

  it("declares the workflow_call inputs the row lists, required and defaulted as stated", () => {
    const inputs = (on as CallOn).workflow_call?.inputs ?? {};
    for (const [name, shape] of Object.entries(row.inputs ?? {})) {
      expect(inputs[name], `${file} declares no input ${name}`).toBeDefined();
      expect(inputs[name].required ?? false).toBe(shape.required);
      expect(inputs[name].default).toBe(shape.default);
    }
  });

  it("holds exactly the token the row says, and queues rather than cancels", () => {
    expect(workflow.permissions).toEqual(row.permissions);
    if (row.concurrency === undefined) expect(workflow.concurrency).toBeUndefined();
    else expect(workflow.concurrency).toEqual({ group: row.concurrency, "cancel-in-progress": false });
  });

  it.each(Object.entries(row.jobs))("job %s is wired as the row says", (jobName, facts) => {
    expectJob(file, jobName, facts, workflow.jobs?.[jobName]);
  });

  it("carries the spellings the row names and none it forbids", () => {
    for (const fragment of row.source?.has ?? []) expect(source).toContain(fragment);
    for (const fragment of row.source?.lacks ?? []) expect(source).not.toContain(fragment);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* Names the table spells for a lane, held to the lane that owns them                            */
/* -------------------------------------------------------------------------------------------- */

describe("a name LANE_WIRING spells for a lane agrees with the lane's own export", () => {
  it.each([
    ["session-captured", LANE_OWNED.sessionCaptured, [SESSION_CAPTURED_DISPATCH_ACTION, AUDIT_DISPATCH_ACTION, WATCHDOG_DISPATCH_ACTION]],
    ["prd-sliceable", LANE_OWNED.prdSliceable, [SPEC_DISPATCH_EVENT_TYPE]],
    ["sliceable", LANE_OWNED.sliceable, [SLICEABLE_LABEL]],
    ["prd", LANE_OWNED.prd, [PRD_LABEL]],
    ["to-build", LANE_OWNED.toBuild, [TO_BUILD_LABEL]],
    ["close state reason", LANE_OWNED.closeStateReason, [CLOSE_STATE_REASON]],
    ["ratifier PR title", LANE_OWNED.ratifierPrTitle, [RATIFIER_PR_TITLE]],
    ["Immutability job", LANE_OWNED.immutabilityJob, [IMMUTABILITY_JOB]],
    ["gate job", LANE_OWNED.gateJob, [GATE_JOB]],
    ["gate step", LANE_OWNED.gateStep, [BYPASS_STEP]],
    ["knowledge-base dir", LANE_OWNED.knowledgeBaseDir, [KNOWLEDGE_BASE_CHECKOUT_DIR]],
    ["ticket-ready", TICKET_READY_DISPATCH_ACTION, [IMPLEMENT_DISPATCH_EVENT_TYPE]],
    ["implementation-opened", IMPLEMENTATION_PR_DISPATCH_ACTION, [VERIFY_DISPATCH_EVENT_TYPE]],
  ])("%s", (_what, spelled, owners) => {
    for (const owner of owners) expect(spelled).toBe(owner);
  });

  it("the reconciler answers exactly the two actions its caller listens for", () => {
    expect([...RECONCILE_DISPATCH_ACTIONS]).toEqual([LANE_OWNED.sessionCaptured, GRAPH_CHANGED_DISPATCH_ACTION]);
  });

  it("shape.yml creates every label shape.ts applies", () => {
    expect([...LABELS_APPLIED]).toEqual(SHAPE_LABELS_APPLIED);
  });

  it("to-tickets.yml invokes exactly the stages STAGES declares", () => {
    const invoked = [...readWorkflow("to-tickets.yml").source.matchAll(/--stage\s+([a-z0-9-]+)/g)].map((match) => match[1]);
    expect(new Set(invoked)).toEqual(new Set(Object.keys(STAGES)));
  });

  it("enrol.yml hands enrol.ts every secret its own scan of the workflows derives (#327)", () => {
    const names = derivedSecretNames(WORKFLOWS_DIR);
    expect(names.length).toBeGreaterThan(0);
    const { workflow } = readWorkflow<Workflow>("enrol.yml");
    const bound = JSON.stringify(workflow.jobs?.enrol?.steps ?? []);
    for (const name of names) expect(bound, `enrol.yml never binds secrets.${name}`).toContain(`secrets.${name}`);
  });

  it("enrol.yml's push filter matches every caller stub it ships", () => {
    const { workflow } = readWorkflow<{ on: { push: { paths: string[] } } }>("enrol.yml");
    const matchers = workflow.on.push.paths.map(
      (glob) => new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`),
    );
    const stubs = workflowNames().filter((name) => name.endsWith(STUB_SUFFIX));
    expect(stubs.length).toBeGreaterThan(0);
    for (const stub of stubs) expect(matchers.some((m) => m.test(`.github/workflows/${stub}`)), stub).toBe(true);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* bin/close-ticket's Python copy of the two job names                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * `bin/close-ticket` reads the same two Verify jobs from the Actions API and cannot import a `.ts`
 * module at a workstation, so it restates both names as Python literals. The block above holds
 * `LANE_OWNED` to `verify.yml`'s own `name:`; this holds the Python copy to `LANE_OWNED`.
 */
describe("bin/close-ticket's job names agree with the verify.yml jobs they are copies of", () => {
  const source = binSources().find((file) => file.relative === "bin/close-ticket")?.source;

  it("finds the script, so this pin is not vacuous", () => expect(source).toBeDefined());

  it.each([
    ["IMMUTABILITY_JOB", LANE_OWNED.immutabilityJob],
    ["GATE_JOB", LANE_OWNED.gateJob],
  ])("%s is the name verify.yml gives that job", (constant, owned) => {
    const spelled = new RegExp(`^${constant} = "([^"]+)"$`, "m").exec(source ?? "")?.[1];
    expect(spelled, `bin/close-ticket's ${constant}`).toBe(owned);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* fixer.yml reads the pull request out of the line verify.yml echoes (ADR-0104)                 */
/* -------------------------------------------------------------------------------------------- */

describe("fixer.yml's resolve grep matches what verify.yml's Immutability job prints", () => {
  const grepped = /grep -oE '([^']+)'/.exec(readWorkflow("fixer.yml").source)?.[1];
  const pattern = new RegExp(grepped ?? "$^");

  it("greps for a pattern at all", () => expect(grepped).toBeDefined());

  it.each([
    ["a real pull request on a claim branch", "judging https://github.com/collod873/claude-workflow/pull/250 on implement/issue-241", true],
    ["the echoed command line itself, which carries the literal $PR", 'echo "judging $PR on $BRANCH"', false],
    ["a branch that is not an implementation claim", "judging https://github.com/collod873/claude-workflow/pull/250 on somebodys-branch", false],
  ])("%s", (_case, line, matches) => {
    expect(pattern.test(line)).toBe(matches);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* Estate-wide                                                                                   */
/* -------------------------------------------------------------------------------------------- */

describe("every workflow file", () => {
  it("parses, and resolves under .github/workflows by name alone", () => {
    expect(estate.length).toBeGreaterThan(0);
    for (const { name } of estate) expect(readWorkflow(name).path).toBe(join(WORKFLOWS_DIR, name));
  });

  it.each(estate.filter((w) => w.name.endsWith(STUB_SUFFIX)))(
    "$name calls its reusable half at @main and inherits secrets exactly when that half spends one",
    ({ name, workflow }) => {
      const lane = name.slice(0, -STUB_SUFFIX.length);
      const [job] = Object.values(workflow.jobs ?? {});
      expect(job.uses).toBe(`${MACHINE_REPOSITORY}/.github/workflows/${lane}.yml@main`);
      // A `uses:` job passes no secret unless told to, so a lane binding one fails closed without
      // `inherit`; a lane binding none has nothing to inherit and says so by omission.
      const bindsSecret = /\$\{\{ secrets\./.test(readWorkflow(`${lane}.yml`).source);
      expect(job.secrets, `${name} secrets:`).toBe(bindsSecret ? "inherit" : undefined);
      // A workflow file handed across the call is a path segment of `actions/workflows/<file>/runs`
      // (ADR-0132): it must name a stub, the only half that carries runs.
      for (const value of Object.values(job.with ?? {}).filter((v) => v.endsWith(".yml"))) {
        expect(value.endsWith(STUB_SUFFIX), `${name} passes ${value}`).toBe(true);
        expect(workflowNames()).toContain(value);
      }
    },
  );

  it.each(estate)("$name runs entrypoints that exist, and creates labels idempotently", ({ name, workflow }) => {
    for (const entrypoint of entrypointsOf(JSON.stringify(workflow))) {
      expect(repoFileExists(entrypoint), `${name} runs ${entrypoint}`).toBe(true);
    }
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const creates = step.run?.match(/gh label create/g)?.length ?? 0;
        const forced = step.run?.match(/--force/g)?.length ?? 0;
        expect(forced, `${name}: ${step.name} creates a label without --force`).toBeGreaterThanOrEqual(creates);
      }
    }
  });
});

/** Variables every runner carries, which a workflow is not expected to restate. */
const AMBIENT = /^(GITHUB_|RUNNER_|HOME$|PATH$|CI$)/;

describe("every variable an entrypoint reads is set by the job that runs it", () => {
  const runs = estate.flatMap(({ name, workflow }) =>
    Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) =>
      [...new Set((job.steps ?? []).flatMap((step) => entrypointsOf(step.run ?? "")))].map((entrypoint) => ({
        name,
        jobName,
        job,
        entrypoint,
      })),
    ),
  );

  it("finds the entrypoint steps, so this sweep is not vacuous", () => {
    expect(runs.length).toBeGreaterThan(10);
  });

  it.each(runs)("$name › $jobName sets what $entrypoint reads", ({ name, jobName, job, entrypoint }) => {
    // Set at the job, on any step (a lane whose entrypoint has a second, narrower mode — `fixer.ts
    // escalate` — sets the tree only on the step that reads one), or exported through
    // `$GITHUB_ENV`, which reaches every later step as if the job's own `env:` had set it —
    // `FAILURE_REASON_PATH`, exported because `runner.temp` is not there yet when job-level `env:`
    // is evaluated (#40).
    const steps = job.steps ?? [];
    const exported = steps
      .filter((each) => each.run?.includes("GITHUB_ENV"))
      .flatMap((each) => [...(each.run ?? "").matchAll(/"?([A-Z_]+)=/g)].map((match) => match[1]));
    const set = new Set([...Object.keys(job.env ?? {}), ...steps.flatMap((each) => Object.keys(each.env ?? {})), ...exported]);
    for (const variable of envReadsOf(entrypoint)) {
      if (AMBIENT.test(variable)) continue;
      expect(set.has(variable), `${name}#${jobName} runs ${entrypoint}, which reads ${variable}, and never sets it`).toBe(true);
    }
  });
});
