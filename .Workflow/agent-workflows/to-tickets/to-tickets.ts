import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { ZodType, ZodTypeDef } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { extractOutput } from "../shared/output-block";
import { Plan } from "../shared/plan-schema";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { validatePlan } from "../shared/validate-graph";
import { sliceAndPublish } from "./slice-and-publish";
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
 * One stage this entrypoint can run headlessly: a committed prompt, the zod
 * schema its `<output>` block must satisfy, how to build the `{{VAR}}`
 * substitution map for its prompt from the CLI's `--issue` value, and any
 * validation beyond the schema (e.g. graph shape) that must also pass before
 * the stage's output is handed off. Kept as one shape so the auditor (the
 * third stage) uses it directly rather than growing a second one.
 */
interface StageDef<T> {
  promptPath: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  buildVars: (issueNumber: string) => Record<string, string>;
  /** Throws to fail the stage; there is no repair path. */
  validate?: (output: T) => void;
}

const SEAM_SWEEP_STAGE: StageDef<SeamManifest> = {
  promptPath: ".Workflow/agent-workflows/to-tickets/seam-sweep/prompt.md",
  schema: SeamManifest,
  buildVars: (issueNumber) => ({ ISSUE_NUMBER: issueNumber }),
};

/**
 * The slice stage consumes the seam manifest the seam-sweep stage just wrote
 * to the shared handoff path — read live here, at call time, so this stage
 * always sees whatever currently sits there rather than a value captured at
 * import time. Its own output (a `Plan`) then overwrites that same file,
 * which is how the pipeline hands work from one stage to the next (see
 * `handoffPath()` above). Beyond schema validation, a plan must also pass
 * `validatePlan` (graph shape: no self-reference, no cycle, no out-of-range
 * edge, at least one unblocked root) before it's handed off.
 */
const SLICE_STAGE: StageDef<Plan> = {
  promptPath: ".Workflow/agent-workflows/to-tickets/slice/prompt.md",
  schema: Plan,
  buildVars: (issueNumber) => ({
    ISSUE_NUMBER: issueNumber,
    SEAM_MANIFEST: readPriorHandoff("slice"),
  }),
  validate: validatePlan,
};

/**
 * Reads whatever the previous stage left at the shared handoff path, for a
 * stage (like slice, or audit) whose prompt needs that as an input. Wraps
 * the read error with which stage needed it and where it looked, since
 * "ENOENT" alone doesn't say a prior stage never ran.
 */
function readPriorHandoff(stageName: string): string {
  try {
    return readFileSync(handoffPath(), "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${stageName} needs the prior stage's handoff at ${handoffPath()}, but it could not be read: ${reason}`,
    );
  }
}

/**
 * The third and last stage: grades the slice stage's plan against the same
 * reference leaves it was drafted against — granularity, edge correctness,
 * merge/split candidates, balance — and returns a plan in the same `Slice`
 * shape, merged, split, re-edged, or unchanged. Schema-checked like every
 * other stage; graph shape is deliberately *not* re-checked here (no
 * `validate`) because `sliceAndPublish`, which this stage's raw response is
 * handed to next, already owns that check before its first `gh` write — see
 * `runAuditAndPublish` below.
 */
const AUDIT_STAGE: StageDef<Plan> = {
  promptPath: ".Workflow/agent-workflows/to-tickets/audit/prompt.md",
  schema: Plan,
  buildVars: (issueNumber) => ({
    ISSUE_NUMBER: issueNumber,
    PLAN: readPriorHandoff("audit"),
  }),
};

const TYPED_STAGE_NAMES = ["seam-sweep", "slice"] as const;
type TypedStageName = (typeof TYPED_STAGE_NAMES)[number];

export const STAGE_NAMES = [...TYPED_STAGE_NAMES, "audit-and-publish"] as const;
type StageName = (typeof STAGE_NAMES)[number];

function isStageName(value: string | undefined): value is StageName {
  return value !== undefined && (STAGE_NAMES as readonly string[]).includes(value);
}

/**
 * Runs one stage end to end: substitutes the PRD's issue number (and, for a
 * stage that declares one, the prior stage's handoff) into its prompt,
 * spawns it through the injected `exec`, extracts and schema-validates its
 * `<output>` block, runs any additional validation the stage declares, and
 * writes the typed result to the handoff path. A bad spawn, a missing block,
 * a schema mismatch, or a failed validation all throw — there is no repair
 * path here; the caller reports and exits.
 */
export function runNamedStage(stageName: TypedStageName, issueNumber: string, exec: StageExec): unknown {
  switch (stageName) {
    case "seam-sweep":
      return runTypedStage(SEAM_SWEEP_STAGE, issueNumber, exec);
    case "slice":
      return runTypedStage(SLICE_STAGE, issueNumber, exec);
  }
}

function runTypedStage<T>(stage: StageDef<T>, issueNumber: string, exec: StageExec): T {
  return runTypedStageWithRaw(stage, issueNumber, exec).output;
}

/**
 * Same work as `runTypedStage`, but also returns the model's raw response —
 * needed only by the audit stage: its prose ahead of the `<output>` block
 * (grading notes and any unapplied flags) is printed rather than discarded,
 * and its raw response is what `sliceAndPublish` re-parses. See
 * `runAuditAndPublish` below.
 */
function runTypedStageWithRaw<T>(
  stage: StageDef<T>,
  issueNumber: string,
  exec: StageExec,
): { raw: string; output: T } {
  const raw = runStage(stage.promptPath, stage.buildVars(issueNumber), exec);
  const output = extractOutput(raw, stage.schema);
  stage.validate?.(output);
  writeHandoff(JSON.stringify(output));
  return { raw, output };
}

/**
 * The audit-and-publish stage: runs the auditor against the plan slice just
 * wrote, prints its grading notes and any unapplied flags to stdout — the
 * Actions run log, never a comment on the issue — then hands its raw
 * response straight to `sliceAndPublish`, the deterministic publisher's own
 * extract → parse → validate → render → create → attach → wire → verify
 * pipeline. `sliceAndPublish`'s own `validatePlan` call is what makes an
 * audited plan that fails graph validation exit nonzero with zero `gh`
 * calls made — nothing here re-checks graph shape separately.
 */
export function runAuditAndPublish(
  issueNumber: string,
  exec: StageExec,
  gh: GhExec,
): PublishedIssue[] {
  const { raw } = runTypedStageWithRaw(AUDIT_STAGE, issueNumber, exec);
  const notes = auditorNotes(raw);
  if (notes) {
    console.log(notes);
  }
  return sliceAndPublish(raw, Number(issueNumber), gh);
}

/**
 * Everything the auditor wrote before its `<output>` block — its grading
 * notes and any unapplied flags — or the whole trimmed response when there
 * is no block to split on (a malformed response `extractOutput` will have
 * already rejected by the time this is called in practice, but this stays
 * defined for any response shape).
 */
function auditorNotes(raw: string): string {
  const openIndex = raw.indexOf("<output>");
  return (openIndex === -1 ? raw : raw.slice(0, openIndex)).trim();
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

    if (stageName === "audit-and-publish") {
      try {
        const published = runAuditAndPublish(issueNumber, execClaude, execGh);
        console.log(
          `audit-and-publish: published ${published.length} sub-issue${published.length === 1 ? "" : "s"} under #${issueNumber}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`audit-and-publish failed: ${reason}`);
        writeFailure("audit-and-publish", reason);
        process.exitCode = 1;
      }
      return;
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
