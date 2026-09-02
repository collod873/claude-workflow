import { z } from "zod";

/**
 * One finding as the notes store persists it: a lens's `GatedProposedFinding`
 * (`lenses/proposed.ts`) plus which lens produced it. `lens` exists because a
 * git note on a commit can hold findings from more than one lens over time —
 * without it, a note's content couldn't say which lens's gate `released`
 * belongs to.
 */
export const Observation = z.object({
  /** The pattern's stable identity — the same text a second sighting would use. */
  finding: z.string().min(1),
  /** Which lens produced this finding, e.g. "PROPOSED". */
  lens: z.string().min(1),
  /** Every distinct site this finding has been named at, across runs. */
  sites: z.array(z.string().min(1)).min(1),
  /** `false` until a second, distinct site names this finding — the two-site gate. */
  released: z.boolean(),
});

export type Observation = z.infer<typeof Observation>;

/**
 * The two lenses that write into a note, named here because `lens` is this
 * schema's own field and three modules read it for different reasons:
 * `run-observations.ts` writes both, `ratify/ratifier.ts` reads VIOLATION to
 * enforce the one verdict that lens may answer with, and `ratify/run-ratify.ts`
 * reads both because only one of them is folded forward between notes.
 */
export const PROPOSED_LENS = "PROPOSED";
export const VIOLATION_LENS = "VIOLATION";
