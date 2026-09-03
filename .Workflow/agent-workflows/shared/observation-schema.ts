import { z } from "zod";

export const Observation = z.object({
  finding: z.string().min(1),
  lens: z.string().min(1),
  sites: z.array(z.string().min(1)).min(1),
  released: z.boolean(),
});

export type Observation = z.infer<typeof Observation>;

export const PROPOSED_LENS = "PROPOSED";
export const VIOLATION_LENS = "VIOLATION";
