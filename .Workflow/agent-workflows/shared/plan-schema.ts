import { z } from "zod";
import { structuredOutput } from "./structured-output";

export const SLICE_CAPS = {
  whatToBuild: 400,
  whyNotMerged: 200,
  acceptanceCriteria: 200,
} as const;

export const Slice = z.object({
  title: z.string().min(1).max(200),
  whatToBuild: z.string().min(1).max(SLICE_CAPS.whatToBuild),
  acceptanceCriteria: z.array(z.string().min(1).max(SLICE_CAPS.acceptanceCriteria)).min(1),
  filesClaimed: z.array(z.string()),
  seamsConsumed: z.array(z.string()),
  whyNotMerged: z.string().min(1).max(SLICE_CAPS.whyNotMerged),
  dependsOn: z.array(z.number().int().positive()).default([]),
});

export type Slice = z.infer<typeof Slice>;

export const Plan = z.array(Slice).min(1);

export type Plan = z.infer<typeof Plan>;

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

export const SLICE_OUTPUT = structuredOutput(Plan, "slices");

export const AuditOutput = z.object({
  notes: z.string().default(""),
  slices: Plan,
});

export type AuditOutput = z.infer<typeof AuditOutput>;

export const AUDIT_OUTPUT = structuredOutput(AuditOutput);
