import type { Observation } from "../observations/observation-schema";

/**
 * Opens the hidden marker every finding section of a ratifier pull request
 * carries — an HTML comment, which every Markdown renderer (GitHub's
 * included) drops from the rendered view but leaves intact in the raw body
 * text. That is what "hidden" buys: the owner reads the prose half of the
 * section, and the merge-time reader (`observations/run-ratification.ts`)
 * recovers the exact `finding` and `sites` the section landed for straight
 * from the merged pull request, with no fuzzy re-matching against prose.
 *
 * The marker's shape is unchanged from the deleted release channel that
 * introduced it (#296 relocates it here rather than reinventing it), so a
 * pull request opened before the overhaul still parses.
 */
const MARKER_PREFIX = "<!-- release-finding:";
const MARKER_SUFFIX = "-->";

/** What one finding section's hidden marker carries — see `MARKER_PREFIX`. */
export interface FindingMarker {
  finding: string;
  sites: string[];
  /**
   * The entry Name or lint rule id this finding landed as — what the revert
   * detector (`./revert-detector.ts`) keys on to notice the owner took it
   * back out. Absent on a marker written before the ratifier existed, which
   * is why the parse treats it as optional rather than as a schema break.
   */
  landedAs?: string;
}

/** Writes one finding's marker for a ratifier pull request's body. */
export function encodeFindingMarker(observation: Observation, landedAs?: string): string {
  const payload: FindingMarker = { finding: observation.finding, sites: observation.sites, landedAs };
  return `${MARKER_PREFIX}${JSON.stringify(payload)}${MARKER_SUFFIX}`;
}

/**
 * Recovers a body line's `FindingMarker`, the inverse of
 * `encodeFindingMarker`. Returns `null` for a line carrying no marker, or one
 * that failed to parse as one, rather than throwing: a hand-edited pull
 * request body is not this function's problem to raise, only to decline to
 * trust.
 */
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
