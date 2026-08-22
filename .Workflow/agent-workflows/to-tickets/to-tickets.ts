import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { extractOutput } from "../shared/output-block";
import { Plan } from "../shared/plan-schema";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { validatePlan } from "../shared/validate-graph";
import { SeamManifest } from "./seam-sweep/schema";

/**
 * The repo-relative fallback for `handoffPath()` — used for a local run,
 * where the runner's `FAILURE_REASON_PATH` env var is never set.
 */
const DEFAULT_HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

/**
 * The fixed path every stage hands its typed output to the next stage
 * through, and where a dying stage's failure reason lands instead. One
 * path, reused across the pipeline's sequential steps: whichever stage runs
 * last before a failure overwrites it, which is exactly what the workflow's
 * `if: failure()` reporter (see `.github/workflows/to-tickets.yml`) reads to
 * name which stage died. There is no per-stage path — a stage's own output
 * is consumed (via `{{VAR}}` substitution into the next stage's prompt)
 * before the next stage's write would overwrite this file.
 *
 * Resolved live, not fixed at import time, so both venues this pipeline
 * runs in agree on the same file rather than two paths that can drift
 * apart: the runner sets `FAILURE_REASON_PATH` to
 * `${{ runner.temp }}/failure_reason.txt`, which `to-tickets.yml`'s
 * `if: failure()` step reads, so a runner run must write there; a local
 * debug run has no such env var, so it falls back to a repo-relative path
 * instead. Every write in this file — success or failure — goes through
 * this one function.
 */
export function handoffPath(): string {
  return process.env.FAILURE_REASON_PATH || DEFAULT_HANDOFF_PATH;
}

/**
 * Writes a stage's failure reason to the handoff path. Overwrites whatever
 * was there — on failure there is nothing downstream left to read a stale
 * success from.
 */
export function writeFailure(stage: string, reason: string): void {
  writeHandoff(`${stage}: ${reason}\n`);
}

function writeHandoff(contents: string): void {
  const path = handoffPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

/**
 * Local-debug entrypoint for the plan half of the pipeline: extracts and
 * validates a raw agent response's `<output>` block as a `Plan`, then runs
 * graph validation against it. Exits 0 on a well-formed plan; exits
 * nonzero, printing the offending slice and writing the failure surface,
 * otherwise. There is no repair path — a rejected response is a failed run.
 */
export function validatePlanFile(filePath: string): Plan {
  const raw = readFileSync(filePath, "utf8");
  const plan = extractOutput(raw, Plan);
  validatePlan(plan);
  return plan;
}

/**
 * The stages this entrypoint can run headlessly, keyed by the `--stage`
 * flag's value. Each stage is one committed prompt paired with the zod
 * schema its `<output>` block must satisfy. Only seam-sweep is wired so
 * far; slice and audit-and-publish add their own entries here without
 * changing this shape.
 */
const STAGES = {
  "seam-sweep": {
    promptPath: ".Workflow/agent-workflows/to-tickets/seam-sweep/prompt.md",
    schema: SeamManifest,
  },
} as const;

type StageName = keyof typeof STAGES;

function isStageName(value: string | undefined): value is StageName {
  return value !== undefined && value in STAGES;
}

/**
 * Runs one stage end to end: substitutes the PRD's issue number into its
 * prompt, spawns it through the injected `exec`, extracts and
 * schema-validates its `<output>` block, and writes the typed result to the
 * handoff path. A bad spawn, a missing block, or a schema mismatch all
 * throw — there is no repair path here; the caller reports and exits.
 */
export function runNamedStage(stageName: StageName, issueNumber: string, exec: StageExec): unknown {
  const stage = STAGES[stageName];
  const raw = runStage(stage.promptPath, { ISSUE_NUMBER: issueNumber }, exec);
  const output = extractOutput(raw, stage.schema);
  writeHandoff(JSON.stringify(output));
  return output;
}

function usage(): never {
  console.error(
    "usage: to-tickets.ts --validate-plan <file>\n" + "       to-tickets.ts --stage <name> --issue <n>",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const stageFlagIndex = args.indexOf("--stage");
  if (stageFlagIndex !== -1) {
    const stageName = args[stageFlagIndex + 1];
    const issueFlagIndex = args.indexOf("--issue");
    const issueNumber = issueFlagIndex === -1 ? undefined : args[issueFlagIndex + 1];

    if (!isStageName(stageName) || !issueNumber) {
      usage();
    }

    try {
      const output = runNamedStage(stageName, issueNumber, execClaude);
      console.log(`${stageName}: wrote a schema-valid output to ${handoffPath()}`);
      console.log(JSON.stringify(output, null, 2));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`${stageName} failed: ${reason}`);
      writeFailure(stageName, reason);
      process.exitCode = 1;
    }
    return;
  }

  const flagIndex = args.indexOf("--validate-plan");
  if (flagIndex === -1 || !args[flagIndex + 1]) {
    usage();
  }

  const filePath = args[flagIndex + 1];
  const plan = validatePlanFile(filePath);
  console.log(`plan is valid: ${plan.length} slice${plan.length === 1 ? "" : "s"}`);
}

// Only run when invoked directly (`npx tsx to-tickets.ts ...`), not when
// to-tickets.ts is imported for its exports (tests, future --stage modes).
// Built through pathToFileURL rather than a raw `file://${...}` template:
// import.meta.url is percent-encoded (spaces, etc.), and a repo checkout
// path is not guaranteed to be free of characters that encoding affects —
// this repo's own path has a space in it — so a naive string comparison
// silently never matches and main() never runs.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err: unknown) => {
    // A fallback for anything main() throws before its own mode-specific
    // handling runs — in practice, today, only a --validate-plan failure
    // reaches here, since the --stage branch catches and reports itself.
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`validate-plan failed: ${reason}`);
    writeFailure("validate-plan", reason);
    process.exitCode = 1;
  });
}
