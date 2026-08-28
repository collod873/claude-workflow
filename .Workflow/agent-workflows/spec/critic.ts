import { z } from "zod";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";

/**
 * Lane 02's critic (ADR-0062): a second stage, reading the author's own
 * output in the same chain — "which is exactly how lane 01's refuter reads
 * the shaper's" (ADR-0062). It hunts a drafted PRD for a sentence that admits
 * two implementations and a criterion nobody could observe, and proposes no
 * fixes: "proposing lets it paper over the ambiguity it exists to surface"
 * (§02, quoted in ADR-0062). Its findings feed the open-question count
 * (ADR-0061) rather than editing the draft — `spec.ts` is what folds them in
 * and never lets them touch the author's `body`.
 */

/** §3: being subtly wrong is expensive and invisible. Low volume, high consequence. */
export const SPEC_CRITIC_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/critic/prompt.md";

/** The drafted PRD the critic reads — a title, a body, and whatever the owner has already answered. */
export interface SpecCriticInput {
  title: string;
  body: string;
  /**
   * The owner's answering comments on an already-published spec, in the order
   * he wrote them. Absent on the author's own chain, where the draft has
   * never been seen by anyone and there is nothing to have answered.
   *
   * They exist for the critic-only door, which has no author behind it: there
   * the body is fixed, so re-reading it alone would report the same findings
   * forever and the gate count could never fall. ADR-0062's *"his answer
   * re-runs the chain, which recomputes the count"* holds on that door only
   * because the answer reaches this stage.
   */
  answers?: string[];
}

/** What the prompt reads when no answers ride along — a stated absence, never an empty hole. */
const NO_ANSWERS = "Nothing has been answered — this is the first read of this spec.";

/**
 * What the critic hands back: the sentences it flagged, each naming what it
 * found and why — never a fix, and never a rewrite of `body`. Empty when the
 * draft held up.
 */
export interface SpecCriticOutput {
  findings: string[];
}

export const SPEC_CRITIC_OUTPUT = structuredOutput(
  z.object({ findings: z.array(z.string().min(1)) }),
);

/** Runs the critic on one drafted PRD and returns what it flagged. */
export async function runSpecCritic(
  exec: StageExec,
  input: SpecCriticInput,
): Promise<SpecCriticOutput> {
  const answers = input.answers?.filter((answer) => answer.trim() !== "") ?? [];

  return runStage(
    PROMPT_PATH,
    {
      TITLE: input.title,
      BODY: input.body,
      ANSWERS: answers.length === 0 ? NO_ANSWERS : answers.join("\n\n---\n\n"),
    },
    exec,
    SPEC_CRITIC_OUTPUT,
    {
      model: SPEC_CRITIC_MODEL,
      // The draft's body has no upper bound by construction — the same
      // reasoning `stage.ts` documents for the Decided context this draft
      // was itself built from.
      promptViaStdin: true,
    },
  );
}
