import { z } from "zod";
import { structuredOutput } from "./structured-output";

/**
 * The character ceilings on a slice's prose fields, in one place so the
 * schema, both stage prompts, and the measurement line all read the same
 * numbers (`prompt-skeleton.test.ts` pins the prompts to these).
 *
 * **Why the prose is capped and the counts are not.** The three prose fields
 * were almost all of the 38KB a 26-slice plan cost, and the audit stage pays
 * that twice — once inlined into its prompt as `{{PLAN}}`, once re-emitted as
 * its answer (#148). `filesClaimed` and `acceptanceCriteria` deliberately
 * carry no `maxItems`: a wide expand-contract migration legitimately claims a
 * dozen files, a cap there buys no tokens, and it hands the model a reason to
 * under-declare the one field the file-overlap edges are read from (#151).
 */
export const SLICE_CAPS = {
  whatToBuild: 400,
  whyNotMerged: 200,
  /** Per entry, not the whole array. */
  acceptanceCriteria: 200,
} as const;

/**
 * One tracer-bullet vertical slice of a spec, as emitted by the slice stage
 * and returned unchanged in shape by the audit stage. Stated as a type shape
 * here because prose encodes it less precisely — see PRD #13.
 */
export const Slice = z.object({
  title: z.string().min(1).max(200),
  whatToBuild: z.string().min(1).max(SLICE_CAPS.whatToBuild),
  acceptanceCriteria: z.array(z.string().min(1).max(SLICE_CAPS.acceptanceCriteria)).min(1),
  // May be empty; an empty list renders in the published body as
  // "None — no files."
  filesClaimed: z.array(z.string()),
  // Seam manifest lines this slice consumes, verbatim.
  seamsConsumed: z.array(z.string()),
  // One sentence, the auditor's input: why this slice does not fold into a
  // neighbour.
  whyNotMerged: z.string().min(1).max(SLICE_CAPS.whyNotMerged),
  // 1-based positions into the plan array. Convention is EARLIER positions
  // only; validate-graph.ts is what actually enforces graph shape.
  dependsOn: z.array(z.number().int().positive()).default([]),
});

export type Slice = z.infer<typeof Slice>;

/** The whole ticket graph a slice (or audit) stage emits: one or more slices. */
export const Plan = z.array(Slice).min(1);

export type Plan = z.infer<typeof Plan>;

/**
 * One line describing how close a plan came to the caps above: the slice
 * count, the widest `filesClaimed`, and the longest value of each capped
 * field against its ceiling. Every stage that emits a plan prints it, so the
 * next decision about the audit stage (#148) — whether the plan is still
 * worth paying for twice — is made on measurements across runs rather than
 * on the one run that raised the question.
 *
 * `filesClaimed` is measured even though it is uncapped, because it is the
 * count the "no `maxItems`" ruling is betting on: if the widest claim across
 * many runs is three files, the ruling was cheap; if it is thirty, it wasn't.
 */
export function measurePlan(plan: Plan): string {
  const longest = (values: string[]) => Math.max(...values.map((value) => value.length));
  const widestClaim = Math.max(...plan.map((slice) => slice.filesClaimed.length));
  const fields: Array<[keyof typeof SLICE_CAPS, number]> = [
    ["whatToBuild", longest(plan.map((slice) => slice.whatToBuild))],
    ["whyNotMerged", longest(plan.map((slice) => slice.whyNotMerged))],
    ["acceptanceCriteria", longest(plan.flatMap((slice) => slice.acceptanceCriteria))],
  ];
  return [
    `${plan.length} slice${plan.length === 1 ? "" : "s"}`,
    `widest filesClaimed ${widestClaim}`,
    ...fields.map(([field, length]) => `longest ${field} ${length}/${SLICE_CAPS[field]}`),
  ].join(", ");
}

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
