import { z } from "zod";
import { structuredOutput } from "./structured-output";

const REF = /^(#\d+|ADR-\d{4})$/;

export const PriorArt = z.object({
  ref: z.string().regex(REF, "prior art must cite `#<number>` or `ADR-NNNN`"),
  url: z.string().min(1),
  bearing: z.string().min(1),
  verdict: z.enum(["duplicate", "ruled", "related"]),
});

export type PriorArt = z.infer<typeof PriorArt>;

export const ReadingListItem = z.object({
  ref: z.string().min(1),
  because: z.string().min(1),
});

export type ReadingListItem = z.infer<typeof ReadingListItem>;

export const Sweep = z.object({
  priorArt: z.array(PriorArt),
  readingList: z.array(ReadingListItem),
});

export type Sweep = z.infer<typeof Sweep>;

export const SWEEP_OUTPUT = structuredOutput(Sweep);
