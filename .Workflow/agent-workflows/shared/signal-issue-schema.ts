import { z } from "zod";

export const SignalIssueSchema = z.object({
  number: z.number(),
  body: z.string().nullable(),
  state: z.string(),
  stateReason: z.string().nullable().optional(),
});
