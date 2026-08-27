import { z } from "zod";
import { structuredOutput } from "../../shared/structured-output";

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

/**
 * The seam-sweep stage's structured-output contract. Wrapped under `entries`
 * because a tool input schema must be object-rooted and a manifest is a bare
 * array.
 *
 * `SeamManifestEntry`'s no-newline rule survives the trip in zod only:
 * `.refine()` is a predicate with no JSON Schema keyword behind it, so the
 * API enforces "array of strings" and the `parse` on the way back enforces
 * the rest.
 */
export const SEAM_SWEEP_OUTPUT = structuredOutput(SeamManifest, "entries");
