import { z } from "zod";

/**
 * The four issue fields a counter reads to decide whether its own signal issue is still open.
 * Lane 07's counter and the bypass counter ask `gh` for exactly these; `shared/` is the only legal
 * crossing between two lanes (docs/agents/module-boundaries.md, rule 1).
 */
export const SignalIssueSchema = z.object({
  number: z.number(),
  body: z.string().nullable(),
  state: z.string(),
  stateReason: z.string().nullable().optional(),
});
