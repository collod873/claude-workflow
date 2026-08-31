import { z } from "zod";
import { structuredOutput } from "../shared/structured-output";

/**
 * The forced order a ratifier stage decides one finding in (#296 §"The
 * ratifier stage"), plus the one verdict a VIOLATION finding may take.
 *
 * - `mechanise` — a lint rule can express this, so the rule is authored and
 *   every site it flags is fixed in the same branch. `CODING_STANDARDS.md`'s
 *   own header rule ("Before ratifying, ask: can a lint rule enforce this?"),
 *   finally enforced at birth rather than by a later sweep.
 * - `prose` — not mechanisable: the three-line entry lands in
 *   `CODING_STANDARDS.md` instead.
 * - `reject` — not worth a standard at all. No branch involvement; the
 *   finding is remembered as `declined` so it does not come back unless it
 *   grows a new site (`filterByRatificationMemory`).
 * - `violation-fix` — the finding is a VIOLATION of an already-ratified
 *   standard. That is a defect with a deterministic fix, not a decision
 *   anyone should be asked to make (ADR-0019's 13/14-valuable lens), so this
 *   is the only verdict a VIOLATION finding may answer with and the only one
 *   a PROPOSED finding may not.
 */
export const RatifierVerdictKind = z.enum(["mechanise", "prose", "reject", "violation-fix"]);
export type RatifierVerdictKind = z.infer<typeof RatifierVerdictKind>;

/**
 * The demotion a `mechanise` verdict has to bring with it: the three-line
 * `CODING_STANDARDS.md` entry to land *instead* when the rule trial
 * (`./rule-trial.ts`) finds the authored rule cannot reproduce its own
 * evidence.
 *
 * It is asked for up front rather than in a second stage call because the
 * demotion is the harness's decision, not the model's — "a rule that cannot
 * reproduce its own evidence is demoted to verdict 2 or 3" is enforced by
 * code, and code with no fallback text in hand could only ever demote to 3.
 */
export const RatifierFallback = z.object({
  /** The entry's **Name** — what `landedAs` becomes when the demotion fires. */
  name: z.string().min(1),
  /** The whole entry, already in the three-line shape `CODING_STANDARDS.md`'s header specifies. */
  entry: z.string().min(1),
});
export type RatifierFallback = z.infer<typeof RatifierFallback>;

/**
 * One finding's verdict. `landedAs` is the join key the whole decline-by-
 * revert path turns on: the lint rule's id for a `mechanise`, the entry's
 * **Name** for a `prose`, the violated standard's **Name** for a
 * `violation-fix`. A `reject` lands nothing, so it names nothing.
 */
export const RatifierVerdict = z
  .object({
    verdict: RatifierVerdictKind,
    /** The rule id or entry Name this finding landed as. Required for every verdict but `reject`. */
    landedAs: z.string().min(1).optional(),
    /** Why this verdict and not the one above it in the forced order — recorded verbatim on the record. */
    reason: z.string().min(1),
    /** Required on `mechanise`, refused otherwise — see `RatifierFallback`. */
    fallback: RatifierFallback.optional(),
  })
  .superRefine((verdict, ctx) => {
    if (verdict.verdict !== "reject" && !verdict.landedAs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${verdict.verdict} verdict must name what it landed as`,
      });
    }
    if (verdict.verdict === "mechanise" && !verdict.fallback) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a mechanise verdict must carry the fallback entry to land if the rule trial fails",
      });
    }
  });

export type RatifierVerdict = z.infer<typeof RatifierVerdict>;

/** The ratifier stage's structured-output contract (`shared/structured-output.ts`). */
export const RATIFIER_OUTPUT = structuredOutput(RatifierVerdict);
