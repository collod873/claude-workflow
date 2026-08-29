import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * Runs the real `validatePlan` out of process and reports what it did.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one.
 *
 * It exists because both of #240's criteria ask the same question of the same function — "given
 * this plan, did it throw, and saying what?" — and a spawn-and-parse helper copied into two files
 * is two copies to get subtly different. It is also the only way to reach the subject at all:
 * `tests/acceptance/` may not import outward, so `validate-graph.ts` is loaded by absolute file URL
 * inside a child process, where the import is resolved at runtime rather than by this file.
 *
 * The child prints one sentinel-prefixed JSON line so a runner's own chatter on stdout cannot be
 * mistaken for the result.
 */

/** A plan slice, in the shape `plan-schema`'s `Slice` requires. */
export interface ProbeSlice {
  title: string;
  whatToBuild: string;
  acceptanceCriteria: string[];
  filesClaimed: string[];
  seamsConsumed: string[];
  whyNotMerged: string;
  dependsOn: number[];
}

/** What `validatePlan` did: threw with this message, or returned and threw nothing. */
export interface ProbeResult {
  threw: boolean;
  message: string;
}

/** A slice with the given title and dependencies, everything else filled in plausibly. */
export function slice(title: string, dependsOn: number[] = []): ProbeSlice {
  return {
    title,
    whatToBuild: `Build ${title}.`,
    acceptanceCriteria: [`${title} works.`],
    filesClaimed: [],
    seamsConsumed: [],
    whyNotMerged: `${title} is its own vertical slice.`,
    dependsOn,
  };
}

/** The subject under test, as an absolute path in this checkout. */
export const SUBJECT_PATH = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "validate-graph.ts",
);

const SENTINEL = "__VALIDATE_PLAN_PROBE__";

/**
 * Ways to execute a TypeScript snippet in this checkout, tried in order.
 *
 * More than one because the probe must report on `validatePlan`, never on which TypeScript runner
 * happened to be resolvable: a red test here has to mean the plan was judged wrongly.
 */
const RUNNERS: ReadonlyArray<(script: string) => { command: string; args: string[] }> = [
  (script) => ({ command: "npx", args: ["--no-install", "tsx", "-e", script] }),
  (script) => ({
    command: "node",
    args: ["--experimental-strip-types", "--no-warnings", "-e", script],
  }),
  (script) => ({ command: "npx", args: ["tsx", "-e", script] }),
];

function probeScript(plan: ProbeSlice[]): string {
  const url = pathToFileURL(SUBJECT_PATH).href;
  return [
    "(async () => {",
    `  const mod = await import(${JSON.stringify(url)});`,
    "  if (typeof mod.validatePlan !== 'function') {",
    "    throw new Error('validate-graph.ts does not export a validatePlan function');",
    "  }",
    `  const plan = ${JSON.stringify(plan)};`,
    "  let result;",
    "  try {",
    "    mod.validatePlan(plan);",
    "    result = { threw: false, message: '' };",
    "  } catch (err) {",
    "    result = { threw: true, message: err instanceof Error ? err.message : String(err) };",
    "  }",
    `  console.log(${JSON.stringify(SENTINEL)} + JSON.stringify(result));`,
    "})().catch((err) => {",
    "  console.error(err && err.stack ? err.stack : String(err));",
    "  process.exit(1);",
    "});",
  ].join("\n");
}

function sentinelLine(output: string): string | undefined {
  const line = output.split("\n").find((l) => l.startsWith(SENTINEL));
  return line === undefined ? undefined : line.slice(SENTINEL.length);
}

function stream(err: unknown, key: "stdout" | "stderr"): string {
  const value = (err as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : "";
}

function runScript(script: string): string {
  const failures: string[] = [];

  for (const runner of RUNNERS) {
    const { command, args } = runner(script);
    const label = `${command} ${args.slice(0, args.length - 1).join(" ")}`;
    try {
      const stdout = execFileSync(command, args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const found = sentinelLine(stdout);
      if (found !== undefined) return found;
      failures.push(`${label}: ran but printed no probe line\n${stdout}`);
    } catch (err) {
      const found = sentinelLine(stream(err, "stdout"));
      if (found !== undefined) return found;
      const detail = err instanceof Error ? err.message : String(err);
      failures.push(`${label}: ${detail}\n${stream(err, "stderr")}`);
    }
  }

  throw new Error(
    `could not run validatePlan out of process from ${SUBJECT_PATH}:\n${failures.join("\n---\n")}`,
  );
}

/** Calls the real `validatePlan` on `plan` and reports whether it threw, and with what message. */
export function validatePlanProbe(plan: ProbeSlice[]): ProbeResult {
  return JSON.parse(runScript(probeScript(plan))) as ProbeResult;
}
