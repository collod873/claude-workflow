import { z } from "zod";
import type { PriorArt } from "../shared/sweep-schema";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { SPEC_AUTHOR_ALLOWED_TOOLS, type DecidedContext } from "./author-contract";

const SPEC_SWEEP_MODEL = "claude-haiku-4-5-20251001";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/sweep/prompt.md";

const SweepCitation = z.object({
  ref: z.string().min(1),
  quote: z.string().min(1),
});

export const SpecSweep = z.object({
  rulings: z.array(SweepCitation),
});

export type SpecSweep = z.infer<typeof SpecSweep>;

export const SPEC_SWEEP_OUTPUT = structuredOutput(SpecSweep);

export async function runSpecSweep(exec: StageExec, context: DecidedContext): Promise<SpecSweep> {
  return runStage(
    PROMPT_PATH,
    {
      OWNER_WORDS: context.ownerWords,
      DECISIONS: context.decisions,
      BOUNDARIES: context.boundaries,
      OPEN_GUESSES: context.openGuesses,
    },
    exec,
    SPEC_SWEEP_OUTPUT,
    {
      model: SPEC_SWEEP_MODEL,
      allowedTools: SPEC_AUTHOR_ALLOWED_TOOLS,
      promptViaStdin: true,
      stage: "sweep",
    },
  );
}

function toPriorArt(citation: z.infer<typeof SweepCitation>): PriorArt {
  return { ref: citation.ref, url: citation.ref, bearing: citation.quote, verdict: "related" };
}

export function renderSweepRulings(rulings: SpecSweep["rulings"]): string {
  if (rulings.length === 0) {
    return "_The sweep found nothing. `none found` is a legal line here too._";
  }
  return rulings
    .map(toPriorArt)
    .map((entry) => `- **${entry.ref}**: ${entry.bearing}`)
    .join("\n");
}

export function applySweep(context: DecidedContext, sweep: SpecSweep): DecidedContext {
  return { ...context, rulings: renderSweepRulings(sweep.rulings) };
}
