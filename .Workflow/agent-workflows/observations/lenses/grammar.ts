import { normalizeSite } from "../site";

/**
 * The `Finding:`/`Site:` grammar both PROPOSED (`./proposed.ts`) and
 * VIOLATION (`./violation.ts`) ask their lens's raw text to follow, and
 * parse it back out of. One block per candidate: a `Finding:` line naming
 * the pattern's stable identity, then a `Site:` line naming where this run
 * saw it. Extracted here so both lenses read the same two labels the same
 * way instead of drifting apart under separate edits.
 */
export interface GrammarFinding {
  finding: string;
  /**
   * Where this run saw it, in contract form (`../site.ts`) — a path,
   * optionally `:<line>`, and nothing else. Normalized here rather than
   * trusted, because a model told to write `file:line` writes
   * `file:line (theFunction)` and the mechanisms downstream read a site as a
   * path (#108).
   */
  site: string;
}

const FINDING_LINE = /^Finding:\s*(.+)$/;
const SITE_LINE = /^Site:\s*(.+)$/;

/**
 * Reads `Finding:` / `Site:` pairs out of a lens's raw text. A `Site:` line
 * only counts while a `Finding:` line is pending above it, and each pending
 * finding is consumed by the next site — anything else in the raw text
 * (prose, an empty-pass notice, a field the model wasn't asked for) is not
 * one of these two labels and is silently not a finding.
 *
 * The site is narrowed to contract form here, at the one seam both lenses
 * parse through, so that no writer downstream has to hold the rule and no
 * reader downstream has to guess at it. A `Site:` line whose text carries no
 * path at all yields nothing to normalize and is not a finding.
 */
export function parseGrammarFindings(raw: string): GrammarFinding[] {
  const findings: GrammarFinding[] = [];
  let pendingFinding: string | undefined;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    const findingMatch = FINDING_LINE.exec(trimmed);
    if (findingMatch) {
      pendingFinding = findingMatch[1].trim();
      continue;
    }

    const siteMatch = SITE_LINE.exec(trimmed);
    if (siteMatch && pendingFinding !== undefined) {
      const site = normalizeSite(siteMatch[1]);
      if (!site) continue;
      findings.push({ finding: pendingFinding, site });
      pendingFinding = undefined;
    }
  }

  return findings;
}
