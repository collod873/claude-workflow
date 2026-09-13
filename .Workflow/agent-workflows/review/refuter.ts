import { z } from "zod";
import { laneBudget } from "../shared/lane-budget";
import { PATH_LINE_RE } from "../shared/ticket-shape";
import { runStageSessionWithinBudget, startLaneBudget, type LaneBudget, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import type { Finding } from "./structural-refusal";

export const REFUTER_MODEL = "claude-sonnet-5";

export const PROMPT_PATH = ".Workflow/agent-workflows/review/refuter/prompt.md";

export const REFUTER_OUTPUT = structuredOutput(
  z.object({ refuted: z.boolean(), reason: z.string() }),
);

export type RefuterVerdict = z.infer<typeof REFUTER_OUTPUT.schema>;

export function refusalNamesReason(reason: string): boolean {
  return PATH_LINE_RE.test(reason);
}

export function survivesRefutation(verdict: RefuterVerdict): boolean {
  return !verdict.refuted || !refusalNamesReason(verdict.reason);
}

async function runOne(exec: StageExec, finding: Finding, diff: string, budget: LaneBudget): Promise<RefuterVerdict> {
  const { value } = await runStageSessionWithinBudget(
    PROMPT_PATH,
    { FINDING: finding.message, DIFF: diff },
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
  budgetMinutes: number = laneBudget("review"),
): Promise<Finding[]> {
  const budget = startLaneBudget(budgetMinutes);
  const survivors: Finding[] = [];
  for (const finding of findings) {
    const verdict = await runOne(exec, finding, diff, budget);
    if (survivesRefutation(verdict)) survivors.push(finding);
  }
  return survivors;
}

