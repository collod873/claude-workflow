import { z } from "zod";

export const RatificationDecision = z.enum(["ratified", "declined", "superseded", "deferred"]);

export type RatificationDecision = z.infer<typeof RatificationDecision>;

export const RatificationRecord = z.object({
  finding: z.string().min(1),
  decision: RatificationDecision,
  sites: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
  landedAs: z.string().min(1).optional(),
});

export type RatificationRecord = z.infer<typeof RatificationRecord>;
