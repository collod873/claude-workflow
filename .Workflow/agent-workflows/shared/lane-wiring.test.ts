import { describe, expect, it } from "vitest";
import { parse } from "yaml";
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
import { NEEDS_HUMAN_LABEL } from "./labels";
import { BUDGETED_LANES, laneBudget } from "./lane-budget";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";
import {
  DEAD_RUN_WIRES,
  emitReusable,
  emitStub,
  LANE_OWNED,
  LANE_WIRING,
  laneFacts,
  lanesNamed,
  MACHINE_REPOSITORY,
  MAIN_MOVED,
  REVIEW_WANTED,
  RUN_ENDED,
  SHAPE_LABELS_APPLIED,
  stubName,
  wiredLanes,
  type JobWiring,
  type StepWiring,
} from "./lane-wiring";
import { GRAPH_CHANGED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "./ready-set";
import { WORKFLOWS_DIR, newCoreSecretNames } from "./read-workflow";
import { binSources, entrypointsOf, envReadsOf, repoFileExists } from "./repo-sources";
import { VERIFY_DISPATCH_EVENT_TYPE } from "./verify-dispatch";

interface EmittedStep {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "timeout-minutes"?: number;
}
interface EmittedJob {
  name?: string;
  needs?: string[];
  if?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps?: EmittedStep[];
  uses?: string;
  with?: Record<string, string>;
  secrets?: string;
}
interface EmittedWorkflow {
  name?: string;
  "run-name"?: string;
  on?: Record<string, { inputs?: Record<string, { type?: string; required?: boolean; default?: string }> }>;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, EmittedJob>;
}

const lanes = wiredLanes();
const reusable = (lane: string) => parse(emitReusable(lane)) as EmittedWorkflow;
const stub = (lane: string) => parse(emitStub(lane) ?? "{}") as EmittedWorkflow;
const rows = lanes.map((lane) => ({ lane, row: LANE_WIRING[lane] }));
const shipped = rows.filter(({ row }) => row.stub !== undefined);
const jobsOf = (lane: string): [string, JobWiring][] => Object.entries(LANE_WIRING[lane].jobs);
const stepsOf = (lane: string): StepWiring[] => jobsOf(lane).flatMap(([, job]) => [...job.steps]);
const runText = (step: StepWiring) => (step.run ?? []).join("\n");

describe("a reusable workflow is what the row declares", () => {
  it.each(shipped.map(({ lane }) => lane))("%s takes the row's inputs plus the two every reusable takes", (lane) => {
    const inputs = reusable(lane).on?.workflow_call?.inputs ?? {};
    expect(Object.keys(inputs)).toEqual([...Object.keys(LANE_WIRING[lane].inputs ?? {}), "runner", "machine_ref"]);
    expect(inputs.runner.default).toBe("ubuntu-latest");
    expect(inputs.machine_ref.default).toBe("main");
    for (const [name, declared] of Object.entries(LANE_WIRING[lane].inputs ?? {})) {
      expect(inputs[name]).toEqual({ type: "string", required: declared.required, ...(declared.default === undefined ? {} : { default: declared.default }) });
    }
  });

  it.each(rows.map(({ lane }) => lane))("%s holds the grant the row names and queues rather than cancels", (lane) => {
    const row = LANE_WIRING[lane];
    const workflow = reusable(lane);
    expect(workflow.permissions).toEqual(row.permissions);
    if (row.concurrency === undefined) expect(workflow.concurrency).toBeUndefined();
    else expect(workflow.concurrency).toEqual({ group: row.concurrency, "cancel-in-progress": false });
  });

  it.each(rows.map(({ lane }) => lane))("%s runs every job on the runner the caller chose", (lane) => {
    const standalone = LANE_WIRING[lane].stub === undefined;
    for (const job of Object.values(reusable(lane).jobs ?? {})) {
      expect(job["runs-on"]).toBe(standalone ? "ubuntu-latest" : "${{ inputs.runner }}");
      expect(job["timeout-minutes"]).toBeGreaterThan(0);
    }
  });

  it.each(rows.map(({ lane }) => lane))("%s emits every step the row declares, in order", (lane) => {
    const emitted = Object.values(reusable(lane).jobs ?? {}).flatMap((job) => job.steps ?? []);
    expect(emitted.map((step) => step.name)).toEqual(stepsOf(lane).map((step) => step.name));
    for (const [index, step] of stepsOf(lane).entries()) {
      expect((emitted[index].run ?? "").replace(/\n$/, "")).toBe(runText(step));
      expect(emitted[index].env).toEqual(step.env);
    }
  });

  it("a standalone lane carries its own doors instead of workflow_call", () => {
    expect(Object.keys(reusable("enrol").on ?? {})).toEqual(["push", "workflow_dispatch"]);
    expect(emitStub("enrol")).toBeUndefined();
  });
});

describe("a Stub is a call, carrying the plain name and the doors that wake the lane", () => {
  it.each(shipped.map(({ lane }) => lane))("%s calls its reusable half at @main", (lane) => {
    const workflow = stub(lane);
    const [job] = Object.values(workflow.jobs ?? {});
    expect(workflow.name).toBe(LANE_WIRING[lane].name);
    expect(workflow["run-name"]).toBe(LANE_WIRING[lane].runName);
    expect(job.uses).toBe(`${MACHINE_REPOSITORY}/.github/workflows/${lane}.yml@main`);
    expect(job.permissions).toEqual(LANE_WIRING[lane].stub?.permissions);
    expect(job.with).toEqual(LANE_WIRING[lane].stub?.with);
  });

  it.each(shipped.map(({ lane }) => lane))("%s inherits secrets exactly when its reusable half spends one", (lane) => {
    const [job] = Object.values(stub(lane).jobs ?? {});
    expect(job.secrets).toBe(emitReusable(lane).includes("${{ secrets.") ? "inherit" : undefined);
  });

  it.each(shipped.map(({ lane }) => lane))("%s passes on a file name only when that file is a Stub the registry emits", (lane) => {
    for (const value of Object.values(LANE_WIRING[lane].stub?.with ?? {}).filter((each) => each.endsWith(".yml"))) {
      expect(lanes.map(stubName)).toContain(value);
    }
  });

  it("the job a Stub calls is the reusable's first, unless the row names another", () => {
    expect(Object.keys(stub("shape").jobs ?? {})).toEqual([Object.keys(LANE_WIRING.shape.jobs)[0]]);
    expect(Object.keys(stub("verify").jobs ?? {})).toEqual(["verify"]);
    expect(Object.keys(stub("acceptance").jobs ?? {})).toEqual(["acceptance"]);
  });
});

describe("a name the registry spells for a lane agrees with the lane's own export", () => {
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

  it("the job names verify.yml gives its gates are the ones the registry owns", () => {
    const jobs = reusable("verify").jobs ?? {};
    expect(jobs.immutability.name).toBe(LANE_OWNED.immutabilityJob);
    expect(jobs.verify.name).toBe(LANE_OWNED.gateJob);
    expect((jobs.verify.steps ?? []).map((step) => step.name)).toContain(LANE_OWNED.gateStep);
  });

  it("the reconciler answers exactly the dispatch actions its Stub listens for", () => {
    expect([...RECONCILE_DISPATCH_ACTIONS]).toEqual(LANE_WIRING["dispatch-reconcile"].stub?.on.repository_dispatch);
    expect([...RECONCILE_DISPATCH_ACTIONS]).toContain(RUN_ENDED);
  });

  it("neither half of the reconciler mentions workflow_run, a door that opens only when a person started the chain (#575)", () => {
    expect(LANE_WIRING["dispatch-reconcile"].stub?.on.workflow_run).toBeUndefined();
    expect(emitStub("dispatch-reconcile")).not.toContain("workflow_run");
    expect(emitReusable("dispatch-reconcile")).not.toContain("workflow_run");
    expect([...RECONCILE_ENDINGS]).toEqual([...RECONCILE_DISPATCH_ACTIONS, MAIN_MOVED]);
  });

  it("every lane holding a claim reaches the reconciler by dispatch, the one wire a bot-started run may pull (#575)", () => {
    const claimants = ["acceptance", "implement", "mechanic", "to-tickets"];
    for (const { lane } of shipped) {
      expect(laneFacts(lane).rings?.includes(RUN_ENDED) ?? false, lane).toBe(claimants.includes(lane));
    }
  });

  it("a lane that holds a claim says its own ending, since GitHub starts nothing from a bot-started run's completion (#445)", () => {
    for (const lane of ["implement", "mechanic"]) {
      expect(laneFacts(lane).rings).toContain(RUN_ENDED);
      const wake = stepsOf(lane).find((step) => step.rings?.includes(RUN_ENDED));
      expect(wake?.if, `${lane} wakes the reconciler on every ending`).toBe("always()");
    }
  });

  it("the author says its own ending from a job of its own, since the jobs that spend a model hold contents: read (#457)", () => {
    const tail = LANE_WIRING.acceptance.jobs["wake-reconciler"];
    const modelJobs = ["refire", "author"];
    expect(tail.needs).toEqual(expect.arrayContaining(modelJobs));
    expect(tail.if).toBe("always()");
    expect(tail.permissions).toEqual({ contents: "write" });
    for (const job of modelJobs) expect(LANE_WIRING.acceptance.jobs[job].permissions).toBeUndefined();
    expect(tail.steps.some((step) => step.rings?.includes(RUN_ENDED))).toBe(true);
  });

  it("a judged run rings its readers by dispatch, and neither reader keeps a workflow_run door, since one never opens for a bot-started Verify (#456)", () => {
    const signal = LANE_WIRING.verify.jobs["signal-review"];
    expect(signal.if).toBe("always()");
    expect(signalsReview({ eventAction: IMPLEMENTATION_PR_DISPATCH_ACTION, immutability: "success", verify: "success" })).toBe(true);
    expect(signal.steps.some((step) => step.entrypoint === "integrate/signal.ts")).toBe(true);
    expect(LANE_WIRING.review.stub?.on).toEqual({ repository_dispatch: [REVIEW_WANTED] });
    for (const input of ["head_sha", "base_sha"]) expect(LANE_WIRING.review.stub?.with?.[input]).toContain(`client_payload.${input}`);
    expect(Object.keys(LANE_WIRING.fixer.stub?.on ?? {})).not.toContain("workflow_run");
  });

  it("shape.ts applies exactly the labels the registry says it does", () => {
    expect([...LABELS_APPLIED]).toEqual(SHAPE_LABELS_APPLIED);
  });

  it("to-tickets invokes exactly the stages STAGES declares", () => {
    const invoked = stepsOf("to-tickets").flatMap((step) => [...runText(step).matchAll(/--stage\s+([a-z0-9-]+)/g)].map((match) => match[1]));
    expect(new Set(invoked)).toEqual(new Set(Object.keys(STAGES)));
  });

  it("enrol hands enrol.ts every secret its own scan of the emitted estate derives (#327)", () => {
    const ownedByNewCore = newCoreSecretNames(WORKFLOWS_DIR);
    const names = derivedSecretNames(WORKFLOWS_DIR).filter((name) => !ownedByNewCore.includes(name));
    expect(names.length).toBeGreaterThan(0);
    const bound = JSON.stringify(stepsOf("enrol").map((step) => step.env ?? {}));
    for (const name of names) expect(bound, `enrol.yml never binds secrets.${name}`).toContain(`secrets.${name}`);
  });

  it("enrol's push filter matches every Stub it ships", () => {
    const matchers = (LANE_WIRING.enrol.on?.push?.paths ?? []).map(
      (glob) => new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`),
    );
    const stubs = shipped.map(({ lane }) => stubName(lane));
    expect(stubs.length).toBeGreaterThan(0);
    for (const name of stubs) expect(matchers.some((matcher) => matcher.test(`.github/workflows/${name}`)), name).toBe(true);
  });

  it("a lane the registry names is the lane a workflow_run door can be traced back to", () => {
    expect(lanesNamed(LANE_OWNED.gateJob)).toEqual(["verify"]);
    expect(lanesNamed("nothing carries this name")).toEqual([]);
  });
});

describe("every job that runs Claude keeps its raw stream", () => {
  const claudeJobs = lanes.flatMap((lane) =>
    jobsOf(lane)
      .filter(([, job]) => job.steps.some((step) => step.name === "Install Claude Code"))
      .map(([key, job]) => [`${lane} › ${key}`, job] as const),
  );

  it("finds the jobs that install Claude, so this pin is not vacuous", () => expect(claudeJobs.length).toBeGreaterThan(5));

  it.each(claudeJobs)("%s uploads the stream once Claude is installed, whatever ended the run", (_, job) => {
    const names = job.steps.map((step) => step.name);
    const kept = job.steps.find((step) => step.uses === "actions/upload-artifact@v4" && String(step.with?.path).includes("claude-streams"));
    expect(kept?.if).toBe("always()");
    expect(names.indexOf(kept?.name ?? "")).toBeGreaterThan(names.indexOf("Install Claude Code"));
  });
});

const SPELLINGS: [string, { has?: readonly string[]; lacks?: readonly string[] }][] = [
  ["shape", { lacks: ["refused-raw-response"] }],
  ["shape-accept", { lacks: ["'go-long'", "'go-short'"] }],
  ["to-tickets", { lacks: ["refused-raw-response"] }],
  ["implement", { lacks: ["implementation-pr-opened", "implement-failed", "implementer-answer"] }],
  ["verify", { lacks: ["implementation-pr-opened"] }],
  ["integrate", { lacks: ["implementation-pr-opened"] }],
  ["dispatch-reconcile", { lacks: ["@anthropic-ai/claude-code", "CLAUDE_CODE_OAUTH_TOKEN"] }],
  ["audit", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["ratify", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["record-ratifications", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["decline-on-revert", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["run-watchdog", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["bypass-counter", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["lost-dispatch-counter", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["missing-trailer-counter", { lacks: [NEEDS_HUMAN_LABEL] }],
  ["enrol", { has: ["secrets.ENROL_PAT"] }],
  ["walk-home", { has: ["secrets.ENROL_PAT"] }],
];

describe("a lane's emitted half carries the spellings it must and none it must not", () => {
  it.each(SPELLINGS)("%s", (lane, pins) => {
    const emitted = emitReusable(lane);
    for (const fragment of pins.has ?? []) expect(emitted, `${lane}.yml never spells ${fragment}`).toContain(fragment);
    for (const fragment of pins.lacks ?? []) expect(emitted, `${lane}.yml spells ${fragment}`).not.toContain(fragment);
  });
});

describe("bin/close-ticket's job names agree with the verify jobs they are copies of", () => {
  const source = binSources().find((file) => file.relative === "bin/close-ticket")?.source;

  it("finds the script, so this pin is not vacuous", () => expect(source).toBeDefined());

  it.each([
    ["IMMUTABILITY_JOB", LANE_OWNED.immutabilityJob],
    ["GATE_JOB", LANE_OWNED.gateJob],
  ])("%s is the name the registry gives that job", (constant, owned) => {
    const spelled = new RegExp(`^${constant} = "([^"]+)"$`, "m").exec(source ?? "")?.[1];
    expect(spelled, `bin/close-ticket's ${constant}`).toBe(owned);
  });
});

describe("the fixer's jq job selects agree with the verify jobs they are copies of", () => {
  const source = stepsOf("fixer").map(runText).join("\n");
  const jobSelects = source.split("\n").flatMap((line) => {
    const match = /^\s*(\w+)=.*select\(\.name == "([^"]+)" or \(\.name \| endswith\(" \/ ([^"]+)"\)\)\)/.exec(line);
    return match ? [{ variable: match[1], bare: match[2], throughCaller: match[3] }] : [];
  });

  it("finds a select for each job the lane reads, so this pin is not vacuous", () => {
    expect(jobSelects.map((select) => select.variable)).toEqual(expect.arrayContaining(["GATE_CONCLUSION", "RESOLVE_JOB_ID"]));
  });

  it.each([
    ["GATE_CONCLUSION", LANE_OWNED.gateJob],
    ["RESOLVE_JOB_ID", LANE_OWNED.immutabilityJob],
  ])("%s selects the job the registry names", (variable, owned) => {
    const select = jobSelects.find((each) => each.variable === variable);
    expect(select?.bare, `the fixer's ${variable} select`).toBe(owned);
    expect(select?.throughCaller, `the fixer's ${variable} select, reached through uses:`).toBe(owned);
  });

  it("restates no job name verify does not own", () => {
    for (const select of jobSelects) {
      expect([LANE_OWNED.gateJob, LANE_OWNED.immutabilityJob], `the fixer selects a job named ${select.bare}`).toContain(select.bare);
      expect(select.throughCaller, `the fixer's ${select.variable} select disagrees with itself`).toBe(select.bare);
    }
  });

  it("greps for what the Immutability job prints", () => {
    const grepped = /grep -oE '([^']+)'/.exec(source)?.[1];
    expect(grepped).toBeDefined();
    const pattern = new RegExp(grepped ?? "$^");
    expect(pattern.test("judging https://github.com/collod873/claude-workflow/pull/250 on implement/issue-241")).toBe(true);
    expect(pattern.test('echo "judging $PR on $BRANCH"')).toBe(false);
    expect(pattern.test("judging https://github.com/collod873/claude-workflow/pull/250 on somebodys-branch")).toBe(false);
  });
});

describe("every lane the registry wires", () => {
  it.each(rows.map(({ lane }) => lane))("%s runs entrypoints that exist, and creates labels idempotently", (lane) => {
    for (const entrypoint of entrypointsOf(stepsOf(lane).map(runText).join("\n"))) {
      expect(repoFileExists(entrypoint), `${lane} runs ${entrypoint}`).toBe(true);
    }
    for (const step of stepsOf(lane)) {
      const run = runText(step);
      const creates = run.match(/gh label create/g)?.length ?? 0;
      const forced = run.match(/--force/g)?.length ?? 0;
      expect(forced, `${lane}: ${step.name} creates a label without --force`).toBeGreaterThanOrEqual(creates);
    }
  });

  it("no lane seeds a label by hand; the catalogue sync is the one seeder", () => {
    for (const { lane } of rows) {
      expect(stepsOf(lane).map(runText).join("\n"), `${lane} runs gh label create`).not.toContain("gh label create");
    }
  });
});

const AMBIENT = /^(GITHUB_|RUNNER_|HOME$|PATH$|CI$)/;

describe("every variable an entrypoint reads is set by the job that runs it", () => {
  const runs = rows.flatMap(({ lane }) =>
    jobsOf(lane).flatMap(([jobName, job]) =>
      [...new Set(job.steps.flatMap((step) => entrypointsOf(runText(step))))].map((entrypoint) => ({ lane, jobName, job, entrypoint })),
    ),
  );

  it("finds the entrypoint steps, so this sweep is not vacuous", () => {
    expect(runs.length).toBeGreaterThan(10);
  });

  it.each(runs)("$lane › $jobName sets what $entrypoint reads", ({ lane, jobName, job, entrypoint }) => {
    const exported = job.steps
      .filter((step) => runText(step).includes("GITHUB_ENV"))
      .flatMap((step) => [...runText(step).matchAll(/"?([A-Z_]+)=/g)].map((match) => match[1]));
    const set = new Set([...Object.keys(job.env ?? {}), ...job.steps.flatMap((step) => Object.keys(step.env ?? {})), ...exported]);
    for (const variable of envReadsOf(entrypoint)) {
      if (AMBIENT.test(variable)) continue;
      expect(set.has(variable), `${lane}#${jobName} runs ${entrypoint}, which reads ${variable}, and never sets it`).toBe(true);
    }
  });
});

describe("#520: a lane's budget fits inside the cap that could kill it", () => {
  it.each(BUDGETED_LANES)("%s stops itself before the runner stops it", (lane) => {
    const caps = jobsOf(lane).flatMap(([, job]) =>
      job.steps.filter((step) => step.entrypoint?.startsWith(`${lane}/`)).map((step) => Math.min(job.timeout, step.timeout ?? Infinity)),
    );
    expect(caps.length, `${lane} runs its own lane entry`).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap, `${lane} declares a cap its budget can beat`).toBeLessThan(Infinity);
      expect(laneBudget(lane), `${lane} budget under its ${cap}-minute cap`).toBeLessThan(cap);
    }
  });
});

describe("#519: the one if: a workflow may carry is always()", () => {
  const conditions = rows.flatMap(({ lane }) =>
    jobsOf(lane).flatMap(([jobName, job]) => [
      ...(job.if === undefined ? [] : [{ where: `${lane} › ${jobName}`, condition: job.if }]),
      ...job.steps.flatMap((step) => (step.if === undefined ? [] : [{ where: `${lane} › ${jobName} › ${step.name}`, condition: step.if }])),
    ]),
  );

  it("finds the conditions the registry carries, so this sweep is not vacuous", () => {
    expect(conditions.length).toBeGreaterThan(20);
  });

  it.each(conditions)("$where", ({ where, condition }) => {
    expect(
      condition,
      `${where} carries a condition no venue but production evaluates; move it into the lane's own ` +
        "TypeScript with a case per branch, and leave always() behind",
    ).toBe("always()");
  });
});
