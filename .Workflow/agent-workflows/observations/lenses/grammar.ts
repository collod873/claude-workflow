import { normalizeSite } from "../../shared/site";

export interface GrammarFinding {
  finding: string;
  site: string;
}

const FINDING_LINE = /^Finding:\s*(.+)$/;
const SITE_LINE = /^Site:\s*(.+)$/;

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
