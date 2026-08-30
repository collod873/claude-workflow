import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { moduleUrl } from "./237-spec-pass.fixture";
import { runProbe } from "./262-critic-pen.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The two out-of-process drivers #272's tests share, and the temp venue both of them run in.
 *
 * Not a `.test.ts`, so the acceptance include never collects it as a suite - it is only ever
 * imported by the test files beside it.
 *
 * It exists because six of this ticket's seven criteria ask one of two questions of the same two
 * modules - "given this checkpoint directory, did runStage spawn a model?" and "given this
 * checkpoint directory, what did a to-tickets stage read, spawn and write?" - and the machinery for
 * asking either one is a fake StageExec, a temp handoff venue and a child process. Copied into six
 * files that is six fakes to get subtly different from each other; here it is one.
 *
 * Why a child process: CI restores tests/acceptance/ from trunk and restores only that directory,
 * so nothing here may import the subject - an import is a specifier the branch under test controls,
 * and an implementer could satisfy a criterion by editing the thing imported instead of building
 * the ticket. The subjects are reached the way a shell reaches them: a script run under `npx tsx -e`
 * imports shared/stage.ts and to-tickets/to-tickets.ts by absolute file URL, drives them through
 * their own injected seams, and prints one PROBE: line. The spawn-and-parse pair is already written
 * next door (runProbe in 262-critic-pen.fixture.ts, over runTsx in 237-spec-pass.fixture.ts), so it
 * is imported rather than restated.
 *
 * Two things these probes deliberately do not assume:
 *
 * - How the stage name is spelled on StageOptions. The ticket makes a stage name a required field
 *   without fixing its key, so every call passes `stage`, `stageName` and `name`, all set to the
 *   same value. A TypeScript interface is not a runtime validator, so the superset costs nothing -
 *   the same move 261-spec-sweep.fixture.ts makes for a wire shape the implementer still owns.
 * - Where the key's commit half comes from. GITHUB_SHA is pinned inside the child, so two child
 *   processes against one temp directory are a run and its retry rather than two unrelated runs.
 *   The one case that is about an uncomputable key deletes it and moves the child's cwd outside any
 *   checkout, so the `git rev-parse HEAD` fallback has nothing to answer with either.
 *
 * The venue is one temp directory per scenario: FAILURE_REASON_PATH is set to <tmp>/handoff.txt, so
 * join(dirname(handoffPath()), "checkpoints") is <tmp>/checkpoints - the directory the ticket names,
 * reached the way the code reaches it rather than by hard-coding a runner path.
 */

const lane = (...parts: string[]): string =>
  path.join(repoRoot, ".Workflow", "agent-workflows", ...parts);

/** The seam every lane's model call goes through, and where the checkpoint code lands. */
export const STAGE_SOURCE = lane("shared", "stage.ts");

/** `structuredOutput`, so a probe's schema is built the way a real stage's is. */
export const STRUCTURED_OUTPUT_SOURCE = lane("shared", "structured-output.ts");

export const TO_TICKETS_SOURCE = lane("to-tickets", "to-tickets.ts");

/** The per-test-file isolation the last criterion is about. */
export const ISOLATE_CHECKPOINTS_SETUP = lane("shared", "isolate-checkpoints.setup.ts");

/** The test file the first criterion's own check command names. */
export const RESUME_TEST_SOURCE = lane("to-tickets", "resume.test.ts");

export const VITEST_CONFIG = path.join(repoRoot, "vitest.config.ts");

/** The commit a run and its retry both pin, so the SHA half of the key is the same on each. */
export const PINNED_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f009182736";

/** A prompt carrying no placeholder, so its resolved text is the file's text and never varies. */
export const DEFAULT_PROMPT =
  "Greet the reader. Nothing in this prompt changes between the runs of one probe.";

/** The title the plan fixture carries, and the marker a handoff file must not be caught holding. */
export const PLAN_TITLE = "A slice the checkpoint probes wrote";

/** One schema- and graph-valid slice: one unblocked root, one runnable criterion, no cycle. */
export function fixturePlan(seam: string): Array<Record<string, unknown>> {
  return [
    {
      title: PLAN_TITLE,
      whatToBuild: "Build the one slice this plan carries, so the stage has a schema-valid answer.",
      acceptanceCriteria: ["The slice comes back from its checkpoint — check: `true`"],
      filesClaimed: [".Workflow/agent-workflows/shared/stage.ts"],
      seamsConsumed: [seam],
      whyNotMerged: "It is the only slice, so there is nothing left to merge it into.",
      dependsOn: [],
    },
  ];
}

export function makeTmp(): string {
  return mkdtempSync(path.join(tmpdir(), "acceptance-272-"));
}

export function cleanUp(dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

/** FAILURE_REASON_PATH for a probe - the runner's shape, in a directory one test owns. */
export function handoffOf(tmp: string): string {
  return path.join(tmp, "handoff.txt");
}

/** join(dirname(handoffPath()), "checkpoints"), resolved for this venue. */
export function checkpointDirOf(tmp: string): string {
  return path.join(tmp, "checkpoints");
}

/** One stage's own named output file: <stage>.json under the checkpoint directory. */
export function checkpointOf(tmp: string, stage: string): string {
  return path.join(checkpointDirOf(tmp), stage + ".json");
}

/** A file's text, or null when it is absent or is not a readable file. */
export function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Every file under `dir`, recursively and in path order; empty when the directory is absent. */
export function filesUnder(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else if (entry.isFile()) found.push(full);
  }
  return found.sort();
}

/**
 * Breaks every checkpoint a run left behind, and reports which files it broke.
 *
 * "garbage" leaves bytes no JSON parser accepts. "directory" leaves the checkpoint's own path
 * unreadable for every user, which is what a chmod cannot promise on a runner that may be root.
 */
export function corruptCheckpoints(tmp: string, mode: "garbage" | "directory"): string[] {
  const files = filesUnder(checkpointDirOf(tmp));
  for (const file of files) {
    if (mode === "garbage") {
      writeFileSync(file, "{{{ this is not JSON", "utf8");
      continue;
    }
    rmSync(file, { force: true });
    mkdirSync(file, { recursive: true });
  }
  return files;
}

export interface ProbeOptions {
  /** GITHUB_SHA for the child; null deletes it, which is the local venue. */
  sha?: string | null;
  /** A cwd for the child. Outside a checkout, the git fallback has nothing to answer with. */
  cwd?: string;
  promptText?: string;
}

/** One runStage call: what it is named, what it is asked, and what its model would answer. */
export interface StageStep {
  stage?: string;
  vars?: Record<string, string>;
  response?: string;
  /** "base" wants only a greeting; "widened" also requires a count. */
  schema?: "base" | "widened";
}

export interface StageStepResult {
  /** How many times the injected StageExec was called - 0 is a stage that spawned no model. */
  execCalls: number;
  /** Everything each call was handed, argv and stdin alike, flattened. */
  prompts: string[];
  result: unknown;
  error: string | null;
}

export interface StageProbe {
  steps: StageStepResult[];
  error: string | null;
}

const STAGE_PROBE = `
const CONFIG = JSON.parse(process.env.PROBE_CONFIG || "{}");
(async () => {
  const out = { steps: [], error: null };
  try {
    const zodModule = await import("zod");
    const z = zodModule.z || zodModule.default;
    const structured = await import(CONFIG.structuredOutputModule);
    const stage = await import(CONFIG.stageModule);
    process.env.FAILURE_REASON_PATH = CONFIG.handoff;
    if (CONFIG.sha === null) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = CONFIG.sha;
    }
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) {
      delete process.env[name];
    }
    if (CONFIG.cwd) process.chdir(CONFIG.cwd);
    const schemas = {
      base: structured.structuredOutput(z.object({ greeting: z.string().min(1) })),
      widened: structured.structuredOutput(
        z.object({ greeting: z.string().min(1), count: z.number() }),
      ),
    };
    for (const step of CONFIG.steps) {
      const prompts = [];
      const exec = async (argv, stdin) => {
        const parts = (argv || []).map(String);
        parts.push(stdin === undefined ? "" : String(stdin));
        prompts.push(parts.join(" "));
        return step.response;
      };
      const name = step.stage || "greeter";
      let result = null;
      let error = null;
      try {
        result = await stage.runStage(
          CONFIG.promptPath,
          step.vars || {},
          exec,
          schemas[step.schema || "base"],
          { stage: name, stageName: name, name: name },
        );
      } catch (err) {
        error = err && err.message ? String(err.message) : String(err);
      }
      out.steps.push({
        execCalls: prompts.length,
        prompts: prompts,
        result: result === undefined ? null : result,
        error: error,
      });
    }
  } catch (err) {
    out.error = String((err && err.stack) || err);
  }
  console.log("PROBE:" + JSON.stringify(out));
})();
`;

/**
 * Runs a sequence of real `runStage` calls in one child process against `tmp`'s checkpoint
 * directory, and reports what each one did.
 *
 * Each call is one process, so calling this twice against the same `tmp` is a run and a rerun.
 */
export function runStageProbe(
  tmp: string,
  steps: StageStep[],
  options: ProbeOptions = {},
): StageProbe {
  const promptPath = path.join(tmp, "prompt.md");
  writeFileSync(promptPath, options.promptText ?? DEFAULT_PROMPT, "utf8");
  return runProbe<StageProbe>(
    STAGE_PROBE,
    {
      PROBE_CONFIG: JSON.stringify({
        stageModule: moduleUrl(STAGE_SOURCE),
        structuredOutputModule: moduleUrl(STRUCTURED_OUTPUT_SOURCE),
        handoff: handoffOf(tmp),
        promptPath: promptPath,
        sha: options.sha === undefined ? PINNED_SHA : options.sha,
        cwd: options.cwd ?? null,
        steps: steps,
      }),
    },
    { steps: [], error: null },
  );
}

/** One `runNamedStage` call: which stage, what its model answers, or how its model dies. */
export interface LaneStep {
  stage: string;
  issue?: string;
  response?: string;
  /** When set, the injected StageExec throws with this message instead of answering. */
  fail?: string;
}

export interface LaneStepResult {
  stage: string;
  execCalls: number;
  prompts: string[];
  ghCalls: string[][];
  result: unknown;
  error: string | null;
}

export interface LaneProbe {
  steps: LaneStepResult[];
  error: string | null;
}

const LANE_PROBE = `
const CONFIG = JSON.parse(process.env.PROBE_CONFIG || "{}");
(async () => {
  const out = { steps: [], error: null };
  try {
    process.env.FAILURE_REASON_PATH = CONFIG.handoff;
    if (CONFIG.sha === null) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = CONFIG.sha;
    }
    const lane = await import(CONFIG.module);
    for (const step of CONFIG.steps) {
      const prompts = [];
      const ghCalls = [];
      const exec = async (argv, stdin) => {
        const parts = (argv || []).map(String);
        parts.push(stdin === undefined ? "" : String(stdin));
        prompts.push(parts.join(" "));
        if (step.fail) throw new Error(step.fail);
        return step.response;
      };
      const gh = (args) => {
        const argv = Array.from(args || []).map(String);
        ghCalls.push(argv);
        if (argv[0] === "issue" && argv[1] === "create") return "https://example.invalid/issues/900";
        if (argv[0] === "api") return "{}";
        return "";
      };
      let result = null;
      let error = null;
      try {
        result = await lane.runNamedStage(step.stage, String(step.issue || "13"), exec, gh);
      } catch (err) {
        error = err && err.message ? String(err.message) : String(err);
      }
      out.steps.push({
        stage: step.stage,
        execCalls: prompts.length,
        prompts: prompts,
        ghCalls: ghCalls,
        result: result === undefined ? null : result,
        error: error,
      });
    }
  } catch (err) {
    out.error = String((err && err.stack) || err);
  }
  console.log("PROBE:" + JSON.stringify(out));
})();
`;

/**
 * Runs a sequence of real `runNamedStage` calls in one child process against `tmp`'s checkpoint
 * directory, and reports what each stage read, spawned and returned.
 *
 * The child keeps the checkout root as its cwd, because the lane's prompt paths and its vocabulary
 * file are repo-relative and a stage that cannot read them is not what any of these criteria are
 * about.
 */
export function runLaneProbe(tmp: string, steps: LaneStep[], options: ProbeOptions = {}): LaneProbe {
  return runProbe<LaneProbe>(
    LANE_PROBE,
    {
      PROBE_CONFIG: JSON.stringify({
        module: moduleUrl(TO_TICKETS_SOURCE),
        handoff: handoffOf(tmp),
        sha: options.sha === undefined ? PINNED_SHA : options.sha,
        steps: steps,
      }),
    },
    { steps: [], error: null },
  );
}
