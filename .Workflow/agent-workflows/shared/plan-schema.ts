import { z } from "zod";
import { structuredOutput } from "./structured-output";

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

/**
 * The slice stage's structured-output contract. A `Plan` is a bare array, and
 * a tool input schema must be object-rooted — the API refuses an array root
 * with `tools.N.custom.input_schema.type: Input should be 'object'` — so it
 * rides under `slices` on the wire and is unwrapped back to a `Plan` here.
 */
export const SLICE_OUTPUT = structuredOutput(Plan, "slices");

/**
 * The audit stage's structured-output contract: the same plan, plus the
 * grading notes as a field of the answer rather than as prose ahead of it.
 *
 * **Why the notes are typed now.** They used to be whatever the auditor wrote
 * before its `<output>` block, recovered by splitting the raw response on the
 * tag. There is no such text any more — a structured answer is a tool call,
 * and the run's earlier turns are progress this pipeline discards — so notes
 * that stayed untyped would simply stop reaching the run log. They are worth
 * keeping: the run that motivated this change (33112792733) produced notes
 * that caught a seven-file slice overload and two missed overlap edges, and
 * then threw them away along with the plan.
 */
export const AuditOutput = z.object({
  /** The auditor's grading of the plan it was given — printed to the run log, never commented. */
  notes: z.string().default(""),
  slices: Plan,
});

export type AuditOutput = z.infer<typeof AuditOutput>;

export const AUDIT_OUTPUT = structuredOutput(AuditOutput);
