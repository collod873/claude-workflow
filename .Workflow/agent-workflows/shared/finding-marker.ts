import type { Observation } from "./observation-schema";

const MARKER_PREFIX = "<!-- release-finding:";
const MARKER_SUFFIX = "-->";

export interface FindingMarker {
  finding: string;
  sites: string[];
  landedAs?: string;
}

export function encodeFindingMarker(observation: Observation, landedAs?: string): string {
  const payload: FindingMarker = { finding: observation.finding, sites: observation.sites, landedAs };
  return `${MARKER_PREFIX}${JSON.stringify(payload)}${MARKER_SUFFIX}`;
}

export function parseFindingMarker(line: string): FindingMarker | null {
  const start = line.indexOf(MARKER_PREFIX);
  if (start === -1) return null;
  const end = line.indexOf(MARKER_SUFFIX, start + MARKER_PREFIX.length);
  if (end === -1) return null;

  try {
    const parsed: unknown = JSON.parse(line.slice(start + MARKER_PREFIX.length, end));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { finding?: unknown }).finding === "string" &&
      Array.isArray((parsed as { sites?: unknown }).sites) &&
      (parsed as { sites: unknown[] }).sites.every((site) => typeof site === "string") &&
      ["string", "undefined"].includes(typeof (parsed as { landedAs?: unknown }).landedAs)
    ) {
      return parsed as FindingMarker;
    }
    return null;
  } catch {
    return null;
  }
}
