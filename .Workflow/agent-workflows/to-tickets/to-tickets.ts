import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { extractOutput } from "../shared/output-block";
import { Plan } from "../shared/plan-schema";
import { validatePlan } from "../shared/validate-graph";

/**
 * The fixed path every stage hands its typed output to the next stage
 * through, and where a dying stage's failure reason lands instead. One path,
 * reused across the pipeline's sequential steps: whichever stage runs last
 * before a failure overwrites it, which is exactly what the workflow's
 * `if: failure()` reporter (see `.github/workflows/to-tickets.yml`) reads to
 * name which stage died. There is no per-stage path — a stage's own output is
 * consumed (via `{{VAR}}` substitution into the next stage's prompt) before
 * the next stage's write would overwrite this file.
 */
export const HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

/**
 * Writes a stage's failure reason to the fixed handoff path. Overwrites
 * whatever was there — on failure there is nothing downstream left to read
 * a stale success from.
 */
export function writeFailure(stage: string, reason: string): void {
  mkdirSync(dirname(HANDOFF_PATH), { recursive: true });
  writeFileSync(HANDOFF_PATH, `${stage}: ${reason}\n`, "utf8");
}

/**
 * Local-debug entrypoint for the plan half of the pipeline: extracts and
 * validates a raw agent response's `<output>` block as a `Plan`, then runs
 * graph validation against it. Exits 0 on a well-formed plan; exits nonzero,
 * printing the offending slice and writing the failure surface, otherwise.
 * There is no repair pass and no retry — a rejected response is a failed run.
 */
export function validatePlanFile(filePath: string): Plan {
  const raw = readFileSync(filePath, "utf8");
  const plan = extractOutput(raw, Plan);
  validatePlan(plan);
  return plan;
}

function usage(): never {
  console.error("usage: to-tickets.ts --validate-plan <file>");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
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
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`validate-plan failed: ${reason}`);
    writeFailure("validate-plan", reason);
    process.exitCode = 1;
  });
}
