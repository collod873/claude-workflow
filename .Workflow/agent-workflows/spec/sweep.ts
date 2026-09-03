import { z } from "zod";
import type { PriorArt } from "../shared/sweep-schema";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { SPEC_AUTHOR_ALLOWED_TOOLS, type DecidedContext } from "./author-contract";

/**
 * Lane 02's sweep — the stage this file puts ahead of the spec author: a cheap read of the
 * repository for whatever bears on the work, so the author quotes and cites what is already on
 * the record instead of restating a collector's summary of it or, worse, inventing it.
 *
 * It exists because a collector's own `rulings` is only ever what *that* trigger's source happened
 * to cite — an accepted sheet cites the ADRs its own accept filed, and nothing else. A ruling filed
 * after the sheet, or one the sheet's author never linked, is invisible to the collector and,
 * before this stage, invisible to the author too. The sweep's whole job is to go and look, on the
 * author's own toolbelt, and its answer **replaces** the collector's `rulings` rather than sitting
 * beside it — two sources writing one field is how they come to disagree, and a stale citation the
 * sweep did not independently confirm should not survive next to one it did.
 */

/** §3: high volume, zero discretion, trivially reversible — the tier lane 01's own sweep runs on. */
const SPEC_SWEEP_MODEL = "claude-haiku-4-5-20251001";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/sweep/prompt.md";

/** One line the sweep found: where it lives, and the sentence it quotes from there. */
const SweepCitation = z.object({
  ref: z.string().min(1),
  quote: z.string().min(1),
});

export const SpecSweep = z.object({
  rulings: z.array(SweepCitation),
});

export type SpecSweep = z.infer<typeof SpecSweep>;

export const SPEC_SWEEP_OUTPUT = structuredOutput(SpecSweep);

/**
 * Runs the sweep over one Decided context's own words — never its `rulings`, which is the field
 * this stage exists to replace — and returns whatever it found.
 *
 * On the author's own allow-list (`SPEC_AUTHOR_ALLOWED_TOOLS`, read from `./spec` rather than
 * restated here): both stages read the repository and must reach no second source of intent
 * (ADR-0060), and a sweep bound to a toolbelt of its own could drift from the author's without
 * anything noticing.
 */
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

/** One of the sweep's own findings, cast into lane 01's own `PriorArt` shape (`shape/sweep-schema.ts`) for rendering. */
function toPriorArt(citation: z.infer<typeof SweepCitation>): PriorArt {
  return { ref: citation.ref, url: citation.ref, bearing: citation.quote, verdict: "related" };
}

/** Renders the sweep's findings for the author's own "The rulings already filed" section. */
export function renderSweepRulings(rulings: SpecSweep["rulings"]): string {
  if (rulings.length === 0) {
    return "_The sweep found nothing. `none found` is a legal line here too._";
  }
  return rulings
    .map(toPriorArt)
    .map((entry) => `- **${entry.ref}** — ${entry.bearing}`)
    .join("\n");
}

/**
 * Replaces a Decided context's `rulings` with the sweep's own findings — never appended, so a
 * ruling the sweep did not independently confirm does not survive alongside one it did.
 */
export function applySweep(context: DecidedContext, sweep: SpecSweep): DecidedContext {
  return { ...context, rulings: renderSweepRulings(sweep.rulings) };
}
