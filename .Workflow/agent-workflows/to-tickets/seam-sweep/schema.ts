import { z } from "zod";

/**
 * One seam manifest line: naming what a shared shape is, where it lives or
 * should live, and what consumes it, held to a single line because every
 * entry is injected into the body of each ticket that consumes it — see
 * `CONTEXT.md`'s "Seam manifest" entry.
 */
export const SeamManifestEntry = z
  .string()
  .min(1)
  .refine((line) => !line.includes("\n"), {
    message: "a seam manifest entry must be a single line (no newline characters)",
  });

export type SeamManifestEntry = z.infer<typeof SeamManifestEntry>;

/**
 * The whole seam manifest the seam-sweep stage emits: zero or more entries.
 * Zero is a valid, complete answer — a sweep that finds nothing to share
 * is not a sweep that failed to try.
 */
export const SeamManifest = z.array(SeamManifestEntry);

export type SeamManifest = z.infer<typeof SeamManifest>;
