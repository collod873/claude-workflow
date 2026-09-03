import { z } from "zod";
import { structuredOutput } from "./structured-output";

/**
 * What the sweep — lane 01's first stage, one Haiku — emits.
 *
 * The sweep does two jobs: it finds prior art, and it
 * builds the shaper's reading list. Both are on this shape, and both are
 * read by something deterministic rather than by another model: `refusal.ts`
 * turns `priorArt` into a verdict, and `shape.ts` turns `readingList` into
 * the only context the shaper will ever have.
 *
 * **Why the verdict is a field rather than a sentence.** §01's refusal —
 * *an idea that already exists, or that an ADR has already ruled on* — needs
 * a record the idea's author did not write, which is
 * [ADR-0014](../../../docs/adr/0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md)'s
 * exact shape: the model reads whatever evidence exists and expresses it in
 * the gate's grammar, and the grammar decides. `verdict` and `ref` are that
 * grammar. A sweep that writes "this looks a lot like #42" in prose has said
 * nothing a gate can fire on; a sweep that writes
 * `{verdict: "duplicate", ref: "#42"}` has, and `refusal.ts` checks the
 * citation's shape before it believes the verdict.
 */

/** A citation the refusal gate can check: `#42` for an issue, `ADR-0007` for a ruling. */
const REF = /^(#\d+|ADR-\d{4})$/;

export const PriorArt = z.object({
  /**
   * What was found, as a citation: `#42` or `ADR-0007`. Free prose belongs
   * in `bearing`; this field is read by a gate.
   */
  ref: z.string().regex(REF, "prior art must cite `#<number>` or `ADR-NNNN`"),
  /** The link, for the sheet's Prior art section — one line, with `bearing`. */
  url: z.string().min(1),
  /** Why it bears on *this* idea. §01 funds three lines here and no more. */
  bearing: z.string().min(1),
  /**
   * Which of §01's two refusal conditions this hit, or neither.
   *
   * - `duplicate` — the idea already exists. `ref` must be an issue.
   * - `ruled` — an ADR has already ruled on it. `ref` must be an ADR.
   * - `related` — worth the owner's eye, refuses nothing. The ordinary case.
   */
  verdict: z.enum(["duplicate", "ruled", "related"]),
});

export type PriorArt = z.infer<typeof PriorArt>;

export const ReadingListItem = z.object({
  /** A repo-relative path, or `#<number>` for an issue the shaper should see. */
  ref: z.string().min(1),
  /**
   * Which part of the idea this bears on.
   * [ADR-0030](../../../docs/adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md):
   * *an item with no reason is dropped*. `min(1)` is that drop, done by the
   * grammar — a sweep that cannot say why the shaper needs a file has not
   * earned the shaper's attention for it.
   */
  because: z.string().min(1),
});

export type ReadingListItem = z.infer<typeof ReadingListItem>;

export const Sweep = z.object({
  priorArt: z.array(PriorArt),
  readingList: z.array(ReadingListItem),
});

export type Sweep = z.infer<typeof Sweep>;

/** The sweep stage's structured-output contract; object-rooted already, so unwrapped. */
export const SWEEP_OUTPUT = structuredOutput(Sweep);
