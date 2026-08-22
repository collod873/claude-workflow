import { z } from "zod";

/**
 * One tracer-bullet vertical slice of a spec, as emitted by the slice stage
 * and returned unchanged in shape by the audit stage. Stated as a type shape
 * here because prose encodes it less precisely — see PRD #13.
 */
export const Slice = z.object({
  title: z.string().min(1).max(200),
  whatToBuild: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  // May be empty; an empty list renders in the published body as
  // "None — no files."
  filesClaimed: z.array(z.string()),
  // Seam manifest lines this slice consumes, verbatim.
  seamsConsumed: z.array(z.string()),
  // One sentence, the auditor's input: why this slice does not fold into a
  // neighbour.
  whyNotMerged: z.string().min(1),
  // 1-based positions into the plan array. Convention is EARLIER positions
  // only; validate-graph.ts is what actually enforces graph shape.
  dependsOn: z.array(z.number().int().positive()).default([]),
});

export type Slice = z.infer<typeof Slice>;

/** The whole ticket graph a slice (or audit) stage emits: one or more slices. */
export const Plan = z.array(Slice).min(1);

export type Plan = z.infer<typeof Plan>;
