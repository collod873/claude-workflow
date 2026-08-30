import { z } from "zod";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";

/**
 * Lane 02's critic (ADR-0062, amended by the sweep-and-pen redesign): a
 * second stage, reading the author's own output in the same chain — "which
 * is exactly how lane 01's refuter reads the shaper's" (ADR-0062). It hunts
 * a drafted PRD for a sentence that admits two implementations and a
 * criterion nobody could observe, and now **resolves** what it finds rather
 * than merely reporting it: "the critic gains a pen and loses its outbox …
 * it stops returning a findings list for someone else to post and starts
 * returning its resolutions." Its bound is that it may sharpen an acceptance
 * criterion, never remove one, and never reduce the scope of the work to
 * make an ambiguity go away — `reconcile.ts` is what turns that bound into
 * arithmetic rather than trusting the prompt below to hold it.
 *
 * `spec.ts` is what folds a resolution into the draft's body, through
 * `reconcile.ts`'s reconciler — never the critic's own job, and never done
 * by editing `body` here.
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
   * the body is fixed, so re-reading it alone would resolve the same
   * ambiguity the same way every time. A comment thread the critic can read
   * is context it may use in reaching its own decision, the same way it
   * reads the body itself.
   */
  answers?: string[];
}

/** What the prompt reads when no answers ride along — a stated absence, never an empty hole. */
const NO_ANSWERS = "Nothing has been answered — this is the first read of this spec.";

/**
 * One thing the critic decided: what it resolved an ambiguity or an
 * unobservable criterion to mean, and why.
 *
 * Two fields rather than one sentence carrying both, because "carrying its
 * reason" is a property nothing can check when the reason is a convention
 * inside prose and everything can check when it is a field
 * (spec #236's own implementation decision).
 */
export interface Resolution {
  /** What the critic decided — the sharpened criterion or the disambiguated reading, stated plainly. */
  decision: string;
  /** Why it decided that, rather than the alternative. */
  reason: string;
}

/**
 * What the critic hands back: every ambiguity and unobservable criterion it
 * found, each already resolved rather than left for someone else to answer.
 * Empty when the draft held up.
 */
export interface SpecCriticOutput {
  resolutions: Resolution[];
}

export const SPEC_CRITIC_OUTPUT = structuredOutput(
  z.object({
    resolutions: z.array(
      z.object({
        decision: z.string().min(1),
        reason: z.string().min(1),
      }),
    ),
  }),
);

/** Runs the critic on one drafted PRD and returns what it resolved. */
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
