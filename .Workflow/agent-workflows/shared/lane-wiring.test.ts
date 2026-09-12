import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as TypeScript from "typescript";
import { describe, expect, it, test } from "vitest";
import { RECONCILE_DISPATCH_ACTIONS, RECONCILE_ENDINGS, SESSION_CAPTURED_DISPATCH_ACTION, TO_BUILD_LABEL } from "../dispatch/reconcile";
import { derivedSecretNames } from "../enrol/secrets";
import { IMPLEMENT_DISPATCH_EVENT_TYPE } from "../implement/implement";
import { signalsReview } from "../integrate/doors";
import { GATE_JOB, IMMUTABILITY_JOB } from "../integrate/integrate";
import { FIXER_NEEDED_WIRE, REVIEW_WANTED_WIRE } from "../integrate/signal";
import { BYPASS_STEP } from "../watchdog/bypass";
import { AUDIT_DISPATCH_ACTION, KNOWLEDGE_BASE_CHECKOUT_DIR } from "../observations/run-audit";
import { PRD_LABEL as ACCEPTANCE_PRD_LABEL } from "../acceptance/doors";
import { CLOSE_STATE_REASON, PRD_LABEL } from "../ratify/prd-close";
import { LABELS_APPLIED } from "../shape/shape";
import { SLICEABLE_LABEL, SPEC_DISPATCH_EVENT_TYPE } from "../spec/open-questions";
import { STAGES } from "../to-tickets/to-tickets";
import { WATCHDOG_DISPATCH_ACTION } from "../watchdog/run-watchdog";
import { expectMachineAndTargetCheckouts } from "./checkout-pair.fixture";
import { BUDGETED_LANES, laneBudget } from "./lane-budget";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";
import {
  doors,
  DEAD_RUN_WIRES,
  ENDING_LANES,
  LANE_OWNED,
  LANE_WIRING,
  MACHINE_REPOSITORY,
  MAIN_MOVED,
  REVIEW_WANTED,
  RUN_ENDED,
  SHAPE_LABELS_APPLIED,
  type Checkout,
  type Gate,
  type JobFacts,
  type LaneWiring,
  type StepFact,
} from "./lane-wiring";
import { GRAPH_CHANGED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "./ready-set";
import {
  readWorkflow,
  readWorkflows,
  STUB_SUFFIX,
  WORKFLOWS_DIR,
  workflowNames,
  type WorkflowJob,
  type WorkflowStep,
} from "./read-workflow";
import { binSources, entrypointsOf, envReadsOf, repoFileExists } from "./repo-sources";
import { VERIFY_DISPATCH_EVENT_TYPE } from "./verify-dispatch";

interface Workflow {
  name?: string;
  "run-name"?: string;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, WorkflowJob>;
}
interface CallOn {
  workflow_call?: { inputs?: Record<string, { required?: boolean; default?: string }> };
}

const rows = Object.entries(LANE_WIRING).map(([lane, row]) => ({ lane, row, file: `${lane}.yml` }));
const estate = readWorkflows<Workflow>();
const stubOf = (lane: string) => `${lane}${STUB_SUFFIX}`;

function expectGate(condition: string, gate: Gate): void {
  if (gate.is !== undefined) expect(condition).toBe(gate.is);
  for (const action of gate.actions ?? []) expect(condition).toContain(`github.event.action == '${action}'`);
  if (gate.actions) expect(condition.match(/github\.event\.action ==/g) ?? []).toHaveLength(gate.actions.length);
  for (const fragment of gate.has ?? []) expect(condition).toContain(fragment);
  for (const fragment of gate.lacks ?? []) expect(condition).not.toContain(fragment);
}

function stepIndex(steps: WorkflowStep[], name: string): number {
  const index = steps.findIndex((step) => step.name === name);
  expect(index, `no step named "${name}"`).toBeGreaterThanOrEqual(0);
  return index;
}

function expectStep(steps: WorkflowStep[], fact: StepFact): void {
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

function expectCheckout(file: string, jobName: string, facts: JobFacts, steps: WorkflowStep[]): void {
  const shape: Checkout = facts.checkout ?? "none";
  const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  const machine = steps.find((step) => step.name === "Checkout machine");

  if (shape === "none") {
    expect(checkouts).toEqual([]);
  } else if (shape === "plain") {
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

function expectJob(file: string, jobName: string, facts: JobFacts, job: WorkflowJob | undefined): void {
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
      expect(stub["run-name"]).toBe(caller.runName);
      expect(doors(stub.on)).toEqual(caller.on);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].permissions).toEqual(caller.permissions);
      if (caller.gate) expectGate(jobs[0].if ?? "", caller.gate);
      else expect(jobs[0].if).toBeUndefined();
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

describe("a name LANE_WIRING spells for a lane agrees with the lane's own export", () => {
  it.each([
    ["session-captured", LANE_OWNED.sessionCaptured, [SESSION_CAPTURED_DISPATCH_ACTION, AUDIT_DISPATCH_ACTION, WATCHDOG_DISPATCH_ACTION]],
    ["prd-sliceable", LANE_OWNED.prdSliceable, [SPEC_DISPATCH_EVENT_TYPE]],
    ["sliceable", LANE_OWNED.sliceable, [SLICEABLE_LABEL]],
    ["prd", LANE_OWNED.prd, [PRD_LABEL, ACCEPTANCE_PRD_LABEL]],
    ["to-build", LANE_OWNED.toBuild, [TO_BUILD_LABEL]],
    ["close state reason", LANE_OWNED.closeStateReason, [CLOSE_STATE_REASON]],
    ["Immutability job", LANE_OWNED.immutabilityJob, [IMMUTABILITY_JOB]],
    ["gate job", LANE_OWNED.gateJob, [GATE_JOB]],
    ["gate step", LANE_OWNED.gateStep, [BYPASS_STEP]],
    ["knowledge-base dir", LANE_OWNED.knowledgeBaseDir, [KNOWLEDGE_BASE_CHECKOUT_DIR]],
    ["ticket-ready", TICKET_READY_DISPATCH_ACTION, [IMPLEMENT_DISPATCH_EVENT_TYPE]],
    ["implementation-opened", IMPLEMENTATION_PR_DISPATCH_ACTION, [VERIFY_DISPATCH_EVENT_TYPE]],
    ["fixer-needed", DEAD_RUN_WIRES.fixerNeeded, [FIXER_NEEDED_WIRE]],
    ["review-wanted", REVIEW_WANTED, [REVIEW_WANTED_WIRE]],
  ])("%s", (_what, spelled, owners) => {
    for (const owner of owners) expect(spelled).toBe(owner);
  });

  it("the reconciler answers exactly the dispatch actions its caller listens for", () => {
    expect([...RECONCILE_DISPATCH_ACTIONS]).toEqual(LANE_WIRING["dispatch-reconcile"].caller?.on.repository_dispatch);
    expect([...RECONCILE_DISPATCH_ACTIONS]).toContain(RUN_ENDED);
  });

  it("the reconciler hears every caller stub end except its own, so no lane's death goes unread (#384)", () => {
    const callers = Object.values(LANE_WIRING)
      .flatMap((row) => (row.caller ? [row.caller.name] : []))
      .filter((name) => name !== LANE_WIRING["dispatch-reconcile"].caller?.name)
      .sort();
    expect([...ENDING_LANES].sort()).toEqual(callers);
    expect([...RECONCILE_ENDINGS]).toEqual([...RECONCILE_DISPATCH_ACTIONS, MAIN_MOVED]);
  });

  it("a lane that holds a claim says its own ending, since GitHub starts nothing from a bot-started run's completion (#445)", () => {
    for (const lane of ["implement", "mechanic"]) {
      const steps = LANE_WIRING[lane].jobs[lane].steps ?? [];
      const wake = steps.find((step) => step.run?.includes(`event_type=${RUN_ENDED}`));
      expect(wake?.if, `${lane} wakes the reconciler on every ending`).toBe("always()");
    }
  });

  it("the author says its own ending from a job of its own, since the jobs that spend a model hold contents: read (#457)", () => {
    const tail = LANE_WIRING.acceptance.jobs["wake-reconciler"];
    const modelJobs = ["refire", "author"];
    expect(tail.needs).toEqual(expect.arrayContaining(modelJobs));
    expect(tail.gate?.is).toContain("always()");
    expect(tail.permissions).toEqual({ contents: "write" });
    for (const job of modelJobs) expect(LANE_WIRING.acceptance.jobs[job].permissions).toBeUndefined();
    expect(tail.steps?.some((step) => step.run?.includes(`event_type=${RUN_ENDED}`))).toBe(true);
  });

  it("a judged run rings its readers by dispatch, and neither reader keeps a workflow_run door, since one never opens for a bot-started Verify (#456)", () => {
    const signal = LANE_WIRING.verify.jobs["signal-review"];
    expect(signal.gate?.is).toBe("always()");
    expect(signalsReview({ eventAction: IMPLEMENTATION_PR_DISPATCH_ACTION, immutability: "success", verify: "success" })).toBe(true);
    expect(signal.steps?.some((step) => step.run?.some((line) => line.includes("integrate/signal.ts")))).toBe(true);
    expect(LANE_WIRING.review.caller?.on).toEqual({ repository_dispatch: [REVIEW_WANTED] });
    for (const input of ["head_sha", "base_sha"]) expect(LANE_WIRING.review.caller?.with?.[input]).toContain(`client_payload.${input}`);
    expect(Object.keys(LANE_WIRING.fixer.caller?.on ?? {})).not.toContain("workflow_run");
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

describe("fixer.yml's jq job selects agree with the verify.yml jobs they are copies of", () => {
  const jobSelects = readWorkflow("fixer.yml")
    .source.split("\n")
    .flatMap((line) => {
      const match = /^\s*(\w+)=.*select\(\.name == "([^"]+)" or \(\.name \| endswith\(" \/ ([^"]+)"\)\)\)/.exec(line);
      return match ? [{ variable: match[1], bare: match[2], throughCaller: match[3] }] : [];
    });

  it("finds a select for each job the lane reads, so this pin is not vacuous", () => {
    expect(jobSelects.map((select) => select.variable)).toEqual(expect.arrayContaining(["GATE_CONCLUSION", "RESOLVE_JOB_ID"]));
  });

  it.each([
    ["GATE_CONCLUSION", LANE_OWNED.gateJob],
    ["RESOLVE_JOB_ID", LANE_OWNED.immutabilityJob],
  ])("%s selects the job verify.yml names", (variable, owned) => {
    const select = jobSelects.find((each) => each.variable === variable);
    expect(select?.bare, `fixer.yml's ${variable} select`).toBe(owned);
    expect(select?.throughCaller, `fixer.yml's ${variable} select, reached through uses:`).toBe(owned);
  });

  it("restates no job name verify.yml does not own", () => {
    for (const select of jobSelects) {
      expect([LANE_OWNED.gateJob, LANE_OWNED.immutabilityJob], `fixer.yml selects a job named ${select.bare}`).toContain(select.bare);
      expect(select.throughCaller, `fixer.yml's ${select.variable} select disagrees with itself`).toBe(select.bare);
    }
  });
});

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
      const bindsSecret = /\$\{\{ secrets\./.test(readWorkflow(`${lane}.yml`).source);
      expect(job.secrets, `${name} secrets:`).toBe(bindsSecret ? "inherit" : undefined);
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

const ts = createRequire(import.meta.url)("typescript") as typeof TypeScript;
const SHARED_TYPES = fileURLToPath(new URL("./read-workflow.ts", import.meta.url));
const THIS_SUITE = fileURLToPath(import.meta.url);
const WORKFLOW_STEP_MEMBERS = ["name", "id", "if", "run", "uses", "with", "env", "working-directory"];
const WORKFLOW_JOB_MEMBERS = ["name", "if", "needs", "timeout-minutes", "permissions", "env", "steps", "uses", "with", "secrets"];
const STEP_STRING_MEMBERS = ["name", "id", "if", "run", "uses", "working-directory"];

function declarationsOf(path: string): TypeScript.SourceFile {
  const program = ts.createProgram([path], { noResolve: true, noLib: true, target: ts.ScriptTarget.ESNext });
  const source = program.getSourceFile(path);
  expect(source, `no declarations at ${path}`).toBeDefined();
  return source as TypeScript.SourceFile;
}

function exportedInterface(source: TypeScript.SourceFile, name: string): TypeScript.InterfaceDeclaration {
  const found = source.statements.find(
    (statement): statement is TypeScript.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === name &&
      (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
  expect(found, `${source.fileName} exports no interface ${name}`).toBeDefined();
  return found as TypeScript.InterfaceDeclaration;
}

function declaredInterfaceNames(source: TypeScript.SourceFile): string[] {
  return source.statements
    .filter((statement): statement is TypeScript.InterfaceDeclaration => ts.isInterfaceDeclaration(statement))
    .map((declaration) => declaration.name.text);
}

function propertySignatures(declaration: TypeScript.InterfaceDeclaration): TypeScript.PropertySignature[] {
  return declaration.members.filter((member): member is TypeScript.PropertySignature => ts.isPropertySignature(member));
}

function memberName(member: TypeScript.PropertySignature): string {
  const name = member.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
}

function namedImportsFrom(source: TypeScript.SourceFile, specifier: string): string[] {
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement)) return [];
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== specifier) return [];
    const bindings = statement.importClause?.namedBindings;
    return bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.map((element) => element.name.text) : [];
  });
}

function carriesWorkflowStep(node: TypeScript.TypeNode | undefined): boolean {
  if (node === undefined) return false;
  if (ts.isArrayTypeNode(node)) return carriesWorkflowStep(node.elementType);
  if (ts.isTypeOperatorNode(node)) return carriesWorkflowStep(node.type);
  if (ts.isParenthesizedTypeNode(node)) return carriesWorkflowStep(node.type);
  if (ts.isUnionTypeNode(node)) return node.types.some((each) => carriesWorkflowStep(each));
  if (ts.isTypeReferenceNode(node)) {
    const named = ts.isIdentifier(node.typeName) && node.typeName.text === "WorkflowStep";
    return named || (node.typeArguments ?? []).some((each) => carriesWorkflowStep(each));
  }
  return false;
}

test("#493.1: WorkflowStep and WorkflowJob are exported from read-workflow.ts", () => {
  const source = declarationsOf(SHARED_TYPES);
  const step = propertySignatures(exportedInterface(source, "WorkflowStep")).map(memberName);
  const job = propertySignatures(exportedInterface(source, "WorkflowJob")).map(memberName);
  expect(step, "WorkflowStep members").toEqual(expect.arrayContaining(WORKFLOW_STEP_MEMBERS));
  expect(job, "WorkflowJob members").toEqual(expect.arrayContaining(WORKFLOW_JOB_MEMBERS));
});

test("#493.2: lane-wiring.test.ts imports WorkflowStep/WorkflowJob instead of declaring its own", () => {
  const source = declarationsOf(THIS_SUITE);
  expect(namedImportsFrom(source, "./read-workflow")).toEqual(expect.arrayContaining(["WorkflowStep", "WorkflowJob"]));
  const declared = declaredInterfaceNames(source);
  expect(declared, "a local Step is still declared here").not.toContain("Step");
  expect(declared, "a local Job is still declared here").not.toContain("Job");
});

test("#493.3: the suite still passes with the shared types wired in", () => {
  const source = declarationsOf(SHARED_TYPES);
  expect(propertySignatures(exportedInterface(source, "WorkflowJob")).map(memberName)).toContain("steps");
  expect(propertySignatures(exportedInterface(source, "WorkflowStep")).map(memberName)).toContain("run");

  const named = estate.flatMap(({ name, workflow }) =>
    Object.entries(workflow.jobs ?? {}).map(([jobName, job]) => ({ where: `${name} › ${jobName}`, job })),
  );
  expect(named.length, "the estate the suite reads").toBeGreaterThan(0);

  let seen = 0;
  for (const { where, job } of named) {
    const read: Record<string, unknown> = { ...job };
    if (read["timeout-minutes"] !== undefined) expect(typeof read["timeout-minutes"], `${where} › timeout-minutes`).toBe("number");
    if (read.if !== undefined) expect(typeof read.if, `${where} › if`).toBe("string");
    if (read.name !== undefined) expect(typeof read.name, `${where} › name`).toBe("string");
    if (read.steps !== undefined) expect(Array.isArray(read.steps), `${where} › steps`).toBe(true);
    for (const step of job.steps ?? []) {
      seen += 1;
      const readStep: Record<string, unknown> = { ...step };
      for (const member of STEP_STRING_MEMBERS) {
        if (readStep[member] !== undefined) expect(typeof readStep[member], `${where} › step ${member}`).toBe("string");
      }
    }
  }
  expect(seen, "the steps the suite reads").toBeGreaterThan(0);
});

test("#493.4: the repo still typechecks", () => {
  const source = declarationsOf(SHARED_TYPES);
  const step = propertySignatures(exportedInterface(source, "WorkflowStep"));
  const job = propertySignatures(exportedInterface(source, "WorkflowJob"));
  for (const member of [...step, ...job]) {
    expect(member.questionToken, `${memberName(member)} is not optional`).toBeDefined();
  }
  const steps = job.find((member) => memberName(member) === "steps");
  expect(steps, "WorkflowJob declares no steps").toBeDefined();
  expect(carriesWorkflowStep(steps?.type), "WorkflowJob.steps carries WorkflowStep").toBe(true);
});

describe("#520: a lane's budget fits inside the cap that could kill it", () => {
  it.each(BUDGETED_LANES)("%s stops itself before the runner stops it", (lane) => {
    const { workflow } = readWorkflow<Workflow>(`${lane}.yml`);
    const caps = Object.values(workflow.jobs ?? {}).flatMap((job) =>
      (job.steps ?? [])
        .filter((step) => step.run?.includes(`agent-workflows/${lane}/`))
        .map((step) => Math.min(job["timeout-minutes"] ?? Infinity, step["timeout-minutes"] ?? Infinity)),
    );
    expect(caps.length, `${lane}.yml runs its own lane entry`).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap, `${lane} declares a cap its budget can beat`).toBeLessThan(Infinity);
      expect(laneBudget(lane), `${lane} budget under its ${cap}-minute cap`).toBeLessThan(cap);
    }
  });
});

const RESULT_GATES: Readonly<Record<string, string>> = {
  "verify.yml › verify": "always() && needs.immutability.result != 'failure'",
};

describe("#519: the one if: a workflow may carry is always()", () => {
  const conditions = estate.flatMap(({ name, workflow }) =>
    Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) => [
      ...(job.if === undefined ? [] : [{ where: `${name} › ${jobName}`, condition: job.if }]),
      ...(job.steps ?? []).flatMap((step) =>
        step.if === undefined ? [] : [{ where: `${name} › ${jobName} › ${step.name}`, condition: step.if }],
      ),
    ]),
  );

  it("finds the conditions the estate carries, so this sweep is not vacuous", () => {
    expect(conditions.length).toBeGreaterThan(20);
  });

  it.each(conditions)("$where", ({ where, condition }) => {
    expect(
      condition,
      `${where} carries a condition no venue but production evaluates; move it into the lane's own ` +
        "TypeScript with a case per branch, and leave always() behind",
    ).toBe(RESULT_GATES[where] ?? "always()");
  });

  it("names no exception the estate has since folded away", () => {
    const carried = conditions.filter(({ condition }) => condition !== "always()").map(({ where }) => where);
    expect(Object.keys(RESULT_GATES).sort()).toEqual(carried.sort());
  });
});
