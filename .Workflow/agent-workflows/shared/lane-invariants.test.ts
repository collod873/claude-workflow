import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow";

/**
 * The classes, not the instances.
 *
 * On 2026-09-02 seven defects were found one runner cycle at a time — ten to forty-five minutes to
 * *discover* each, about ninety seconds to fix. Every one of them lived in the thin YAML layer or
 * the wiring between lanes rather than in the TypeScript the unit suites already cover well, and
 * four of the seven were the same three shapes repeating:
 *
 * - **Parity drift.** `recover.yml` was the one lane that writes into a target and never installed
 *   the target's dependencies, so its regenerated `.claude/contract.json` reported "no test runner
 *   here" and PR #348 was red through Verify, Integrate and the fixer.
 * - **A condition that names one death.** `implement.yml`'s Recover dispatch and
 *   `recover-caller.yml`'s door both asked for `failure`, and a `timeout-minutes` kill reports
 *   `cancelled` — so the one death they most existed for reached neither.
 * - **A call shape that changes the verb.** `gh api` becomes a POST the moment a `-f` field is
 *   present, and POST on a workflow's runs endpoint is a 404 that `bin/close-ticket` read as "no
 *   run found" — every closing record it ever wrote said `Verify: unjudged`.
 *
 * A test per instance would have caught none of them, because each instance was written by someone
 * who already believed they had got it right. These sweep the whole estate for the shape instead,
 * so the *next* lane that gets one wrong fails here in under a second rather than on a runner in
 * forty-five minutes.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const AGENT_WORKFLOWS = join(REPO_ROOT, ".Workflow/agent-workflows");

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
}
interface Workflow {
  name?: string;
  on?: Record<string, unknown> | string[];
  jobs?: Record<string, Job>;
}

const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));
const workflows = workflowFiles.map((name) => {
  const { workflow, source } = readWorkflow<Workflow>(name);
  return { name, workflow, source, steps: Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []) };
});

/** Every non-test TypeScript file under the lanes, plus everything in `bin/`. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git" || entry.endsWith(".fixtures")) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (!path.endsWith(".test.ts")) out.push(path);
    }
  };
  walk(AGENT_WORKFLOWS);
  walk(join(REPO_ROOT, "bin"));
  return out;
}

describe("a lane that writes into a target installs that target's dependencies", () => {
  /**
   * Why an uninstalled target poisons the regenerated contract: `recover.yml`'s "Install target
   * dependencies" step comment (PR #348).
   */
  const WRITES_TARGET = /regenerateArtifacts|landAnswer/;

  /** The lane entrypoints a workflow's `run:` steps invoke, as repo-relative paths. */
  function entrypoints(source: string): string[] {
    return [...source.matchAll(/npx tsx (\.Workflow\/[^\s"']+\.ts)/g)].map((m) => m[1]);
  }

  /** Whether `entry`, or anything it imports from its own lane, regenerates or lands into a target. */
  function writesTarget(entry: string): boolean {
    const path = join(REPO_ROOT, entry);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      return false;
    }
    if (WRITES_TARGET.test(source)) return true;
    return [...source.matchAll(/from "(\.[^"]+)"/g)].some((m) => {
      const imported = join(dirname(path), m[1].endsWith(".ts") ? m[1] : `${m[1]}.ts`);
      try {
        return WRITES_TARGET.test(readFileSync(imported, "utf8"));
      } catch {
        return false;
      }
    });
  }

  const writers = workflows.filter((w) => entrypoints(w.source).some(writesTarget));

  it("finds the lanes that write into a target, so this sweep is not vacuous", () => {
    expect(writers.map((w) => w.name).sort()).toContain("implement.yml");
    expect(writers.map((w) => w.name).sort()).toContain("recover.yml");
  });

  it.each(writers.map((w) => w.name))("%s installs the target's dependencies before it writes", (name) => {
    const target = workflows.find((w) => w.name === name)!;
    const install = target.steps.find(
      (step) => step["working-directory"] === "target" && /npm ci|npm install|pnpm i|yarn/.test(step.run ?? ""),
    );
    expect(
      install,
      `${name} regenerates or lands into the target checkout but never installs its dependencies. ` +
        `check-contract.ts's probe reads <target>/node_modules/.bin, so the contract it writes will ` +
        `claim the target has no test runner — PR #348, red through three lanes until it was fixed ` +
        `by hand.`,
    ).toBeDefined();
  });
});

describe("a step that reports a dead run covers every way a run dies", () => {
  /**
   * Why `cancelled()` belongs beside `failure()` on a step that rings a recovery lane: the comment
   * on `implement.yml`'s "Tell Recover this run failed" step (#342).
   */
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
      `this step tells a recovery lane a run died, but its \`if:\` is \`${condition}\` — a ` +
        `timeout-minutes kill reports cancelled, not failure, so the death it most exists for ` +
        `would skip it (#342, run 33687023105).`,
    ).toBe(true);
  });

  /**
   * The same blindness one level down. A job killed by its own `timeout-minutes` reports
   * `cancelled` to `needs.<job>.result`, so a downstream job that fans out over `result ==
   * 'failure'` alone cannot see it — which is how a hung Verify reached the fixer through neither
   * of its two doors.
   */
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
  /**
   * Why a read route must take its query in the path is written where the fix landed:
   * `fetch_verify_verdict`'s comment in `bin/close-ticket`.
   */
  const offenders = sourceFiles().flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const hits = [...source.matchAll(/gh[_ ]?api[\s\S]{0,400}?actions\/[\s\S]{0,400}?\)/gi)];
    return hits
      .filter((hit) => /["']-f["']|\s-f\s|--field/.test(hit[0]))
      .filter((hit) => !/--method|["']-X["']|-X GET/.test(hit[0]))
      .map(() => path.slice(REPO_ROOT.length + 1));
  });

  it("no call sends fields to an Actions read route, which would make it a POST", () => {
    expect(
      [...new Set(offenders)],
      "an Actions read route takes its query in the path, never as `-f` fields — see " +
        "`fetch_verify_verdict` in `bin/close-ticket`, and `integrate.ts`'s `repoRunsPath`.",
    ).toEqual([]);
  });
});

describe("every dispatch wire has a sender and a receiver", () => {
  /**
   * A wire name declared on one side only is unreachable code that looks wired. Both of
   * `verify.yml`'s jobs were dead this way until #145's seam audit, because the sender and the
   * receiver each declared their own spelling and each slice tested against its own constant.
   */
  const declared = [...new Set(
    readdirSync(join(AGENT_WORKFLOWS, "shared"))
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
      .flatMap((n) => [
        ...readFileSync(join(AGENT_WORKFLOWS, "shared", n), "utf8")
          .matchAll(/DISPATCH_ACTION(?:_TYPE)?\s*=\s*"([a-z-]+)"/g),
      ])
      .map((m) => m[1]),
  )];

  it("finds the wire names, so this sweep is not vacuous", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared)("some workflow listens for %s", (action) => {
    const listeners = workflows.filter((w) => JSON.stringify(w.workflow.on ?? {}).includes(action));
    expect(
      listeners.map((w) => w.name),
      `\`${action}\` is declared in shared/ but no workflow's \`on:\` names it — a wire with a ` +
        `sender and no receiver, which is what left both of verify.yml's jobs unreachable (#145).`,
    ).not.toEqual([]);
  });

  it.each(declared)("something sends %s", (action) => {
    const senders = sourceFiles().filter((path) => {
      const source = readFileSync(path, "utf8");
      return source.includes(`event_type=${action}`) || new RegExp(`"${action}"`).test(source);
    });
    expect(
      senders.length,
      `\`${action}\` has a receiver but nothing sends it — lane 03 published 26 tickets lane 05 ` +
        `could never be told about, exactly this way (#167).`,
    ).toBeGreaterThan(0);
  });
});
