import { z } from "zod";

/** What every session record carries, whichever era wrote it — the two differ only in the payload. */
export const SessionIdentity = z.object({
  sessionId: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
  touchedPaths: z.array(z.string().min(1)),
});

export const SessionRecord = SessionIdentity.extend({
  corpusPath: z.string().min(1),
});

export type SessionRecord = z.infer<typeof SessionRecord>;
