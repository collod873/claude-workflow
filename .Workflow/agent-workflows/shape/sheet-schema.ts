import { z } from "zod";
import { structuredOutput } from "../shared/structured-output";
import { PriorArt } from "./sweep-schema";

/**
 * The decision sheet, and what the shaper emits to produce one.
 *
 * `CONTEXT.md`: a decision sheet is *the idea restated as work, the prior art
 * found, and each decision the work needs with a recommended answer and the
 * alternatives rejected.* Lane 01 caps it at a phone screen — five
 * sections, no others — and the caps are enforced in `sheet.ts` rather than
 * asked for here, because a cap enforced by a schema is a stage failure and a
 * cap enforced by the renderer is a cut. The rule is **cut, never appended**.
 *
 * The one cap that is *not* a cut is the decision count, and that is
 * deliberate: [ADR-0029](../../../docs/adr/0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md)
 * makes a tree that will not close under five decisions the definition of
 * *needs a live session*. Truncating to five would hide exactly the signal
 * the cap exists to raise, so `sheet.ts` refuses there instead.
 */

export const Decision = z.object({
  /** What has to be decided, as a question. */
  question: z.string().min(1),
  /** The recommended answer. §01 funds two lines for this and `rejected` together. */
  recommendation: z.string().min(1),
  /** The alternative considered and rejected, and why. */
  rejected: z.string().min(1),
  /**
   * The assumption mark, as the thing that **moves** when this answer flips
   * — another decision on this sheet, or a named artifact: an ADR, a shipped
   * lane's contract, a file.
   * [ADR-0028](../../../docs/adr/0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md):
   * *a mark that names nothing is malformed and is stripped mechanically.*
   *
   * The empty string is that malformed mark, and it is legal here on
   * purpose: the strip is `sheet.ts`'s, done without judgement, rather than a
   * schema rejection that would fail the whole stage over one decision's
   * missing pointer. An unmarked decision is the ordinary case and writes
   * `""` too — the two are the same thing by the time the grammar has run,
   * which is what makes the test need no reader.
   */
  mark: z.string().default(""),
  /**
   * The ruling as a sentence, when this decision passes `docs/adr/README.md`'s
   * three-part bar and should be filed at accept
   * ([ADR-0005](../../../docs/adr/0005-accepting-a-shaped-idea-is-what-files-its-adrs.md)).
   * Empty when it does not.
   *
   * A title here is a *draft* — ADR-0006's whole restatement of W5 is that
   * agents draft and the owner signs, and the signature is the `approved`
   * label. Nothing is written to `docs/adr/` until that label lands.
   * `accept.ts` files only a decision carrying **both** a title and a mark,
   * because the mark is the first of the three tests and a title without one
   * is a shaper claiming a bar it did not show its work for.
   */
  adrTitle: z.string().default(""),
});

export type Decision = z.infer<typeof Decision>;

/** A term the shaper had to coin, drafted for `CONTEXT.md` and filed at accept (ADR-0006). */
export const Term = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  /** The near-synonyms `CONTEXT.md` entries carry as `_Avoid_`. */
  avoid: z.array(z.string().min(1)).default([]),
  /**
   * Which of `CONTEXT.md`'s four groupings the entry belongs under.
   *
   * Asked of the shaper rather than worked out at accept, because the accept
   * files rather than judges: a term's grouping is a reading of what kind of
   * thing it names, and that reading is the shaper's to make while it still
   * has the idea in front of it. An enum rather than a free string so the
   * insertion point is found by matching, never by creating a heading.
   */
  section: z.enum(["The record", "The charter", "Mechanisms", "The pipeline"]),
});

export type Term = z.infer<typeof Term>;

/**
 * The shaper's output when it produced a sheet. `route` is its
 * *recommendation* (ADR-0007) — `sheet.ts` may override it to `long` and
 * never to `short`, per ADR-0029's `> half marked` rule.
 */
export const ShaperSheet = z.object({
  kind: z.literal("sheet"),
  restatement: z.string().min(1),
  priorArt: z.array(PriorArt),
  decisions: z.array(Decision).min(1),
  route: z.enum(["short", "long"]),
  /** One line: why that route. §01 caps the Route section at one line. */
  routeReason: z.string().min(1),
  newTerms: z.array(Term).default([]),
});

export type ShaperSheet = z.infer<typeof ShaperSheet>;

/**
 * The shaper's other legal output: one re-sweep request, naming what it needs
 * and why (ADR-0030). Capped at one round by `shape.ts`, not by this shape —
 * a second request is answered by writing the sheet anyway with the affected
 * decision marked at the gap.
 */
export const ReSweep = z.object({
  kind: z.literal("re-sweep"),
  /** What the sweep should go and find. */
  needs: z.string().min(1),
  /** Which part of the idea it bears on — the sweep's second-pass target. */
  why: z.string().min(1),
});

export type ReSweep = z.infer<typeof ReSweep>;

export const ShaperOutput = z.discriminatedUnion("kind", [ShaperSheet, ReSweep]);

export type ShaperOutput = z.infer<typeof ShaperOutput>;

/**
 * The shaper stage's structured-output contract. Wrapped under `answer` for
 * the same reason a bare array is: a union derives to a root `anyOf` with no
 * `type` of its own, and the API takes only an object at the root. The two
 * branches stay exactly as they are inside the wrapper, discriminated on
 * `kind` — a sheet or a re-sweep request, never both.
 */
export const SHAPER_OUTPUT = structuredOutput(ShaperOutput, "answer");

/**
 * The refuter's output. It attacks the **recommendations**, not the idea, and
 * reports only what survives — §01: *silent when it agrees*. An empty array
 * is the good outcome and renders as an **absent** section, never as `none`.
 */
export const Refutations = z.object({
  survivors: z.array(z.string().min(1)).default([]),
});

export type Refutations = z.infer<typeof Refutations>;

/** The refuter stage's structured-output contract; object-rooted already, so unwrapped. */
export const REFUTER_OUTPUT = structuredOutput(Refutations);

/**
 * The sheet as it is posted: the shaper's output after the caps, the mark
 * strip and the route override have run, plus the refuter's survivors. This
 * is the shape that goes into the comment's machine-readable marker, and
 * therefore the shape `accept.ts` reads back months later — so it carries
 * everything the accept needs (`decisions`, `newTerms`) and nothing the
 * accept would have to re-derive.
 */
export const Sheet = z.object({
  restatement: z.string().min(1),
  priorArt: z.array(PriorArt),
  decisions: z.array(Decision),
  survivors: z.array(z.string()),
  route: z.enum(["short", "long"]),
  routeReason: z.string().min(1),
  newTerms: z.array(Term),
  /** Which round produced this sheet: 0 is the first, then one per change request. */
  round: z.number().int().nonnegative(),
});

export type Sheet = z.infer<typeof Sheet>;
