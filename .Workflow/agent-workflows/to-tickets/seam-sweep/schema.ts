import { z } from "zod";
import { structuredOutput } from "../../shared/structured-output";

export const SeamManifestEntry = z
  .string()
  .min(1)
  .refine((line) => !line.includes("\n"), {
    message: "a seam manifest entry must be a single line (no newline characters)",
  });

export type SeamManifestEntry = z.infer<typeof SeamManifestEntry>;

export const SeamManifest = z.array(SeamManifestEntry);

export type SeamManifest = z.infer<typeof SeamManifest>;

export const SEAM_SWEEP_OUTPUT = structuredOutput(SeamManifest, "entries");
