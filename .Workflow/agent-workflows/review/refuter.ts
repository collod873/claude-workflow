import { z } from "zod";
import { LANE_BUDGET_MINUTES } from "../shared/claim";
import { PATH_LINE_RE } from "../shared/ticket-shape";
import { runStageSessionWithinBudget, startLaneBudget, type LaneBudget, type StageExec } from "../shared/stage";
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
  budget: LaneBudget,
): Promise<RefuterVerdict> {
  const { value } = await runStageSessionWithinBudget(
    PROMPT_PATH,
    {
      FINDING: finding.message,
      DIFF: diff,
      GREEN_GATE_CHECKS: greenGateChecks.length ? greenGateChecks.join(", ") : "(none)",
    },
    exec,
    REFUTER_OUTPUT,
    {
      budget,
      model: REFUTER_MODEL,
      promptViaStdin: true,
      stage: "refuter",
    },
  );
  return value;
}

export async function runRefuter(
  exec: StageExec,
  findings: Finding[],
  diff: string,
  greenGateChecks: GreenGateCheck[],
  budgetMinutes?: number,
): Promise<Finding[]> {
  const budget = startLaneBudget(budgetMinutes ?? LANE_BUDGET_MINUTES);
  const survivors: Finding[] = [];
  for (const finding of findings) {
    const verdict = await runOne(exec, finding, diff, greenGateChecks, budget);
    if (survivesRefutation(verdict, greenGateChecks)) survivors.push(finding);
  }
  return survivors;
}

