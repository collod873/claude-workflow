import { parseGrammarFindings } from "./grammar";
import { normalizeSite } from "../../shared/site";

export interface ProposedLensInput {
  diff: string;
  spine: string;
}

export function proposedPrompt(input: ProposedLensInput): string {
  const { diff, spine } = input;
  return `You are the PROPOSED lens, one pass over one session's own commits.

## Session spine

The session's own words — what it was trying to do. Context for the diff, not something to grade on
its own.

${spine}

## Diff

The session's own commit range, restricted to the paths its transcript names. This is the only code
you look at.

${diff}

## What to do

Look for a judgement call in the diff that a linter cannot express, made in a way that reads as a
rule rather than a one-off choice — the same bar \`/standards-pass\` uses. You are not checking the
diff against \`CODING_STANDARDS.md\`; that is a different lens's job, and repeating an entry a
linter already enforces is not yours to do either.

## Output

One block per candidate pattern, in exactly this form, repeated for each:

Finding: <a one-line description of the pattern, stable across sites — this is its identity, so
phrase it the same way you would on a second sighting of it>
Site: <file:line where this run observed it — a path and a line number, nothing else. No function
name, no parenthetical, no "~line". A reader resolves this as a path, so anything past it is lost.>

Output only these two labels, once per candidate pattern, and nothing else — no drafted rule text,
no rationale, no other labeled field. Writing the entry's wording is not this lens's call to make;
only \`Finding:\` and \`Site:\` are read from what you write. If the diff shows no pattern worth
proposing, say so plainly and stop — an empty pass is a valid pass.
`;
}

export interface ProposedFinding {
  finding: string;
  site: string;
}

export function parseProposedFindings(raw: string): ProposedFinding[] {
  return parseGrammarFindings(raw);
}

export interface GatedProposedFinding {
  finding: string;
  sites: string[];
  released: boolean;
}

export function applyTwoSiteGate(
  previous: GatedProposedFinding[],
  findings: ProposedFinding[],
): GatedProposedFinding[] {
  const byFinding = new Map<string, GatedProposedFinding>();
  for (const entry of previous) {
    const sites = [...new Set(entry.sites.map(normalizeSite))].filter((site) => site.length > 0);
    byFinding.set(entry.finding, { finding: entry.finding, sites, released: entry.released });
  }

  for (const { finding, site: raw } of findings) {
    const site = normalizeSite(raw);
    if (!site) continue;
    const existing = byFinding.get(finding);
    if (existing) {
      if (!existing.sites.includes(site)) existing.sites.push(site);
    } else {
      byFinding.set(finding, { finding, sites: [site], released: false });
    }
  }

  for (const entry of byFinding.values()) {
    entry.released = entry.sites.length >= 2;
  }

  return [...byFinding.values()];
}
