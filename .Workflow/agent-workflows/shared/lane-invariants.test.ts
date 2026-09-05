import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TARGET_DEPS_ACTION } from "./lane-wiring";
import { readWorkflows } from "./read-workflow";
import { binSources, entrypointsOf, hookSources, laneSources, readRepoText, REPO_ROOT } from "./repo-sources";

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  "working-directory"?: string;
}
interface Job {
  if?: string;
  steps?: Step[];
  uses?: string;
  "runs-on"?: string;
}
interface WorkflowCallInput {
  type?: string;
  required?: boolean;
  default?: unknown;
}
interface Workflow {
  name?: string;
  on?: {
    workflow_call?: { inputs?: Record<string, WorkflowCallInput> };
    repository_dispatch?: { types?: string[] };
    [key: string]: unknown;
  } | string[];
  jobs?: Record<string, Job>;
}

const workflows = readWorkflows<Workflow>().map(({ name, workflow, source }) => ({
  name,
  workflow,
  source,
  steps: Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []),
}));

const sourceFiles = () => [...laneSources(), ...binSources()];

describe("a lane that writes into a target installs that target's dependencies", () => {
  const WRITES_TARGET = /regenerateArtifacts|landAnswer|commitAndPushAttempt/;

  function textOf(path: string): string | undefined {
    try {
      return readRepoText(path);
    } catch {
      return undefined;
    }
  }

  function writesTarget(entry: string): boolean {
    const path = join(REPO_ROOT, entry);
    const source = textOf(path);
    if (source === undefined) return false;
    if (WRITES_TARGET.test(source)) return true;
    return [...source.matchAll(/from "(\.[^"]+)"/g)].some((m) => {
      const imported = join(dirname(path), m[1].endsWith(".ts") ? m[1] : `${m[1]}.ts`);
      return WRITES_TARGET.test(textOf(imported) ?? "");
    });
  }

  const writers = workflows.filter((w) => entrypointsOf(w.source).some(writesTarget));

  it("finds the lanes that write into a target, so this sweep is not vacuous", () => {
    expect(writers.map((w) => w.name).sort()).toContain("implement.yml");
    expect(writers.map((w) => w.name).sort()).toContain("recover.yml");
    expect(writers.map((w) => w.name).sort()).toContain("fixer.yml");
  });

  it.each(writers.map((w) => w.name))("%s installs the target's dependencies before it writes", (name) => {
    const target = workflows.find((w) => w.name === name)!;
    const install = target.steps.find(
      (step) =>
        (step.uses === TARGET_DEPS_ACTION && step.with?.["working-directory"] === "target") ||
        (step["working-directory"] === "target" && /npm ci|npm install|pnpm i|yarn/.test(step.run ?? "")),
    );
    expect(
      install,
      `${name} regenerates or lands into the target checkout but never installs its dependencies. ` +
        `check-contract.ts's probe reads <target>/node_modules/.bin, so the contract it writes will ` +
        `claim the target has no test runner: PR #348, red through three lanes until it was fixed ` +
        `by hand.`,
    ).toBeDefined();
  });
});

describe("a step that reports a dead run covers every way a run dies", () => {
  const notifiers = workflows.flatMap((w) =>
    w.steps
      .filter((step) => /event_type=[a-z-]*failed/.test(step.run ?? ""))
      .map((step) => ({ workflow: w.name, name: step.name ?? "(unnamed)", condition: step.if ?? "" })),
  );

  it("finds the steps that ring a recovery lane, so this sweep is not vacuous", () => {
    expect(notifiers.length).toBeGreaterThan(0);
  });

  it.each(notifiers)("$workflow's '$name' reacts to a cancelled run as well as a failed one", ({ condition }) => {
    expect(
      /cancelled\(\)|always\(\)/.test(condition),
      `this step tells a recovery lane a run died, but its \`if:\` is \`${condition}\`, and a ` +
        `timeout-minutes kill reports cancelled, not failure, so the death it most exists for ` +
        `would skip it (#342, run 33687023105).`,
    ).toBe(true);
  });

  it("no job reacts to a sibling's failure without also reacting to its cancellation", () => {
    const blind = workflows.flatMap((w) =>
      Object.entries(w.workflow.jobs ?? {})
        .filter(([, job]) => /needs\.[\w-]+\.result == 'failure'/.test(job.if ?? ""))
        .filter(([, job]) => !/result == 'cancelled'/.test(job.if ?? ""))
        .map(([jobName]) => `${w.name}:${jobName}`),
    );
    expect(
      blind,
      "a job that fans out over a sibling's `failure` and not its `cancelled` cannot see a " +
        "sibling killed by timeout-minutes",
    ).toEqual([]);
  });

  it("every workflow_run door onto a lane's death accepts a cancelled conclusion too", () => {
    const doors = workflows.filter((w) => JSON.stringify(w.workflow.on ?? {}).includes("workflow_run"));
    const failureOnly = doors.filter((w) => {
      const conditions = Object.values(w.workflow.jobs ?? {}).map((job) => job.if ?? "");
      return conditions.some((c) => c.includes("conclusion == 'failure'") && !c.includes("'cancelled'"));
    });
    expect(
      failureOnly.map((w) => w.name),
      "a workflow_run door that names only 'failure' cannot see a timed-out run",
    ).toEqual([]);
  });
});

describe("a read of the Actions API is a GET", () => {
  const offenders = sourceFiles().flatMap((file) => {
    const hits = [...file.source.matchAll(/gh[_ ]?api[\s\S]{0,400}?actions\/[\s\S]{0,400}?\)/gi)];
    return hits
      .filter((hit) => /["']-f["']|\s-f\s|--field/.test(hit[0]))
      .filter((hit) => !/--method|["']-X["']|-X GET/.test(hit[0]))
      .map(() => file.relative);
  });

  it("no call sends fields to an Actions read route, which would make it a POST", () => {
    expect(
      [...new Set(offenders)],
      "an Actions read route takes its query in the path, never as `-f` fields; see " +
        "`fetch_verify_verdict` in `bin/close-ticket`, and `integrate.ts`'s `repoRunsPath`.",
    ).toEqual([]);
  });
});

describe("every dispatch wire has a sender and a receiver", () => {
  const declared = [
    ...new Set([
      ...laneSources()
        .filter((file) => /\/shared\/[^/]+\.ts$/.test(file.path))
        .flatMap((file) => [...file.source.matchAll(/DISPATCH_ACTION(?:_TYPE)?\s*=\s*"([a-z-]+)"/g)])
        .map((m) => m[1]),
      ...workflows.flatMap((w) => (Array.isArray(w.workflow.on) ? [] : (w.workflow.on?.repository_dispatch?.types ?? []))),
    ]),
  ];

  it("finds the wire names, so this sweep is not vacuous", () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toEqual(expect.arrayContaining(["session-captured", "fixer-needed", "implement-failed", "ticket-ready"]));
  });

  it.each(declared)("some workflow listens for %s", (action) => {
    const listeners = workflows.filter((w) => JSON.stringify(w.workflow.on ?? {}).includes(action));
    expect(
      listeners.map((w) => w.name),
      `\`${action}\` is declared in shared/ but no workflow's \`on:\` names it, a wire with a ` +
        `sender and no receiver, which is what left both of verify.yml's jobs unreachable (#145).`,
    ).not.toEqual([]);
  });

  it.each(declared)("something sends %s", (action) => {
    const sources = [...sourceFiles().map((file) => file.source), ...hookSources().map((file) => file.source), ...workflows.map((w) => w.source)];
    const senders = sources.filter((source) => source.includes(`event_type=${action}`) || new RegExp(`"${action}"`).test(source));
    expect(
      senders.length,
      `\`${action}\` has a receiver but nothing sends it: lane 03 published 26 tickets lane 05 ` +
        `could never be told about, exactly this way (#167).`,
    ).toBeGreaterThan(0);
  });
});

describe("a reusable workflow declares runner and machine_ref and runs on the runner", () => {
  const reusable = workflows.filter(
    (w) => !Array.isArray(w.workflow.on) && (w.workflow.on as Record<string, unknown> | undefined)?.workflow_call !== undefined,
  );

  it("finds the reusable workflows, so this sweep is not vacuous", () => {
    expect(reusable.map((w) => w.name)).toContain("verify.yml");
    expect(reusable.length).toBeGreaterThan(1);
  });

  it.each(reusable.map((w) => w.name))("%s declares both runner and machine_ref inputs", (name) => {
    const target = workflows.find((w) => w.name === name)!;
    const on = target.workflow.on as { workflow_call?: { inputs?: Record<string, WorkflowCallInput> } };
    const inputs = on.workflow_call?.inputs ?? {};
    expect(
      inputs.runner,
      `${name} is a reusable workflow but declares no \`runner\` input, and a canary caller's ` +
        `\`with: runner: canary\` fails this workflow at startup_failure before any job runs ` +
        `(ADR-0146).`,
    ).toBeDefined();
    expect(inputs.runner?.default).toBe("ubuntu-latest");
    expect(
      inputs.machine_ref,
      `${name} is a reusable workflow but declares no \`machine_ref\` input, and without it a caller ` +
        `pinned to any ref but \`main\` runs that ref's YAML around \`main\`'s TypeScript, and a ` +
        `canary fire reads FALSE GREEN because the machine checkout never lands on the branch under ` +
        `test (ADR-0146).`,
    ).toBeDefined();
    expect(inputs.machine_ref?.default).toBe("main");
  });

  it.each(reusable.map((w) => w.name))("every job in %s runs on inputs.runner", (name) => {
    const target = workflows.find((w) => w.name === name)!;
    const offenders = Object.entries(target.workflow.jobs ?? {})
      .filter(([, job]) => job["runs-on"] !== undefined)
      .filter(([, job]) => job["runs-on"] !== "${{ inputs.runner }}")
      .map(([jobName, job]) => `${jobName}: runs-on: ${job["runs-on"]}`);
    expect(
      offenders,
      `${name} has a job whose \`runs-on:\` does not read \`inputs.runner\`, and a canary target's ` +
        `self-hosted runner would never actually run that job (ADR-0146).`,
    ).toEqual([]);
  });
});
