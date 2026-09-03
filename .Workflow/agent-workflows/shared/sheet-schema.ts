import { z } from "zod";
import { structuredOutput } from "./structured-output";
import { PriorArt } from "./sweep-schema";

export const Decision = z.object({
  question: z.string().min(1),
  recommendation: z.string().min(1),
  rejected: z.string().min(1),
  mark: z.string().default(""),
  adrTitle: z.string().default(""),
  adrReversal: z.string().default(""),
});

export type Decision = z.infer<typeof Decision>;

export const Term = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  avoid: z.array(z.string().min(1)).default([]),
  section: z.enum(["The record", "The charter", "Mechanisms", "The pipeline"]),
});

export type Term = z.infer<typeof Term>;

export const ShaperSheet = z.object({
  kind: z.literal("sheet"),
  restatement: z.string().min(1),
  priorArt: z.array(PriorArt),
  decisions: z.array(Decision).min(1),
  route: z.enum(["short", "long"]),
  routeReason: z.string().min(1),
  newTerms: z.array(Term).default([]),
});

export type ShaperSheet = z.infer<typeof ShaperSheet>;

export const ReSweep = z.object({
  kind: z.literal("re-sweep"),
  needs: z.string().min(1),
  why: z.string().min(1),
});

export type ReSweep = z.infer<typeof ReSweep>;

export const ShaperOutput = z.discriminatedUnion("kind", [ShaperSheet, ReSweep]);

export type ShaperOutput = z.infer<typeof ShaperOutput>;

export const SHAPER_OUTPUT = structuredOutput(ShaperOutput, "answer");

export const Refutations = z.object({
  survivors: z.array(z.string().min(1)).default([]),
});

export type Refutations = z.infer<typeof Refutations>;

export const REFUTER_OUTPUT = structuredOutput(Refutations);

export const Sheet = z.object({
  restatement: z.string().min(1),
  priorArt: z.array(PriorArt),
  decisions: z.array(Decision),
  survivors: z.array(z.string()),
  route: z.enum(["short", "long"]),
  routeReason: z.string().min(1),
  newTerms: z.array(Term),
  round: z.number().int().nonnegative(),
});

export type Sheet = z.infer<typeof Sheet>;
