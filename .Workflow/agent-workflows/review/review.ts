import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { execGit } from "../shared/git";
import { reason } from "../shared/reason";
import { isStructurallyRefused, type Finding, type GreenGateCheck } from "./structural-refusal";

export type { Finding, GreenGateCheck } from "./structural-refusal";

/**
 * Lane 07's correctness reviewer (PRD #145, move 7a): an Opus stage that reads a diff CI has
 * already passed and hunts for defects in it. It never runs alone — every raw finding it writes
 * down is filtered through [ADR-0036](../../../docs/adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md)'s
 * `isStructurallyRefused` before anything downstream (the owner, or a later refuter — ADR-0035)
 * ever sees it. This file owns that firing and that filter; it does not own the refuter, which is
 * a separate stage reading only what survives here.
 */

/** §3: being subtly wrong is expensive and invisible. Low volume, high consequence. */
const CORRECTNESS_REVIEWER_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/review/correctness-reviewer/prompt.md";

export const CORRECTNESS_REVIEWER_OUTPUT = structuredOutput(
  z.object({ findings: z.array(z.object({ message: z.string().min(1) })) }),
);

/** What the reviewer is asked about: the diff it reads, and the names a green gate already covers. */
export interface CorrectnessReviewInput {
  diff: string;
  greenGateChecks: GreenGateCheck[];
}

/**
 * Drops every finding `isStructurallyRefused` refuses and keeps the rest, in order.
 *
 * This is the whole of ADR-0036 as this lane applies it: no judgement of its own, just the same
 * lookup `structural-refusal.ts` already proves — reused rather than reimplemented, so a
 * finding failing either of its two conditions never reaches a caller of this function, and one
 * failing neither does.
 */
export function keepSurvivingFindings(
  findings: Finding[],
  diff: string,
  greenGateChecks: GreenGateCheck[],
): Finding[] {
  return findings.filter((finding) => !isStructurallyRefused(finding, diff, greenGateChecks));
}

/**
 * Runs the correctness reviewer on one diff and returns only the findings that survive the
 * structural refusal — never the raw list the model wrote down.
 */
export async function runCorrectnessReview(
  exec: StageExec,
  input: CorrectnessReviewInput,
): Promise<Finding[]> {
  const raw = await runStage(
    PROMPT_PATH,
    { DIFF: input.diff },
    exec,
    CORRECTNESS_REVIEWER_OUTPUT,
    {
      model: CORRECTNESS_REVIEWER_MODEL,
      // The diff has no upper bound by construction — see `stage.ts`'s own note on `spec.ts`'s
      // Decided context, the same reasoning applied to a diff instead of a sheet.
      promptViaStdin: true,
    },
  );
  return keepSurvivingFindings(raw.findings, input.diff, input.greenGateChecks);
}

async function main(): Promise<void> {
  const base = process.argv[2];
  const head = process.argv[3] ?? "HEAD";
  const greenGateChecks = process.argv.slice(4);

  if (!base) {
    console.error("usage: review.ts <base-ref> [head-ref] [green-gate-check...]");
    process.exitCode = 1;
    return;
  }

  try {
    const diff = execGit(["diff", `${base}...${head}`]);
    const survivors = await runCorrectnessReview(execClaude, { diff, greenGateChecks });
    console.log(JSON.stringify(survivors));
  } catch (err) {
    console.error(`review failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
