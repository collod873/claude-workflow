import { z } from "zod";
import { structuredOutput } from "../shared/structured-output";

export const RatifierVerdictKind = z.enum(["mechanise", "prose", "reject", "violation-fix"]);
export type RatifierVerdictKind = z.infer<typeof RatifierVerdictKind>;

export const RatifierFallback = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
});
export type RatifierFallback = z.infer<typeof RatifierFallback>;

export const RatifierVerdict = z
  .object({
    verdict: RatifierVerdictKind,
    landedAs: z.string().min(1).optional(),
    reason: z.string().min(1),
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

export const RATIFIER_OUTPUT = structuredOutput(RatifierVerdict);
