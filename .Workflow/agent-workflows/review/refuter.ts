import { z } from "zod";
import { PATH_LINE_RE } from "../shared/ticket-shape";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import type { Finding, GreenGateCheck } from "./structural-refusal";

export const REFUTER_MODEL = "claude-sonnet-5";

export const PROMPT_PATH = ".Workflow/agent-workflows/review/refuter/prompt.md";

export const REFUTER_OUTPUT = structuredOutput(
  z.object({ refuted: z.boolean(), reason: z.string() }),
);

export type RefuterVerdict = z.infer<typeof REFUTER_OUTPUT.schema>;

export function refusalNamesReason(reason: string, greenGateChecks: GreenGateCheck[]): boolean {
  return PATH_LINE_RE.test(reason) || greenGateChecks.some((check) => reason.includes(check));
}

export function survivesRefutation(
  verdict: RefuterVerdict,
  greenGateChecks: GreenGateCheck[],
): boolean {
  return !verdict.refuted || !refusalNamesReason(verdict.reason, greenGateChecks);
}

async function runOne(
  exec: StageExec,
  finding: Finding,
  diff: string,
  greenGateChecks: GreenGateCheck[],
): Promise<RefuterVerdict> {
  return runStage(
    PROMPT_PATH,
    {
      FINDING: finding.message,
      DIFF: diff,
      GREEN_GATE_CHECKS: greenGateChecks.length ? greenGateChecks.join(", ") : "(none)",
    },
    exec,
    REFUTER_OUTPUT,
    {
      model: REFUTER_MODEL,
      promptViaStdin: true,
      stage: "refuter",
    },
  );
}

export async function runRefuter(
  exec: StageExec,
  findings: Finding[],
  diff: string,
  greenGateChecks: GreenGateCheck[],
): Promise<Finding[]> {
  const survivors: Finding[] = [];
  for (const finding of findings) {
    const verdict = await runOne(exec, finding, diff, greenGateChecks);
    if (survivesRefutation(verdict, greenGateChecks)) survivors.push(finding);
  }
  return survivors;
}

