import { parseGrammarFindings } from "./grammar";
import { normalizeSite } from "../../shared/site";

/**
 * Everything the PROPOSED lens's prompt is built from. Like VIOLATION
 * (./violation.ts), the spawned call it feeds runs sandboxed with
 * `--tools ""` (auditor.ts) — no tool access — so every input has to
 * already be text here.
 */
export interface ProposedLensInput {
  /** The session's own scoped diff (`observations/diff.ts`'s `sessionRangeDiff`). */
  diff: string;
  /** The session's captured conversation spine (capture's own format, spec #36 slice 1) — context for what the diff was trying to do. */
  spine: string;
}

/**
 * Builds the PROPOSED lens's prompt: the second lens the auditor runs (spec
 * #36 slice 4; VIOLATION is the first, `./violation.ts`). Where VIOLATION
 * checks a diff against standards already ratified, PROPOSED looks for a
 * recurring judgement call worth a *new* entry — it never checks against
 * `CODING_STANDARDS.md` at all, so unlike VIOLATION it takes no `standards`
 * input.
 *
 * It never drafts the ruling's wording. The pre-fix corpus's
 * `Suggested CODING_STANDARDS.md line:` field manufactured 30 of 42
 * findings by generalising a single implementation choice into a universal
 * rule (spec #36 §Evidence) — dropped here for that reason, and the ban is
 * stated in the prompt as defense in depth. The structural guarantee is
 * `parseProposedFindings` below: its output shape has no field that text
 * could occupy, however the model responds.
 */
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

/**
 * One site of one candidate pattern, as `parseProposedFindings` reads it out
 * of the sandboxed call's raw text. Deliberately two fields only: `finding`
 * is the pattern's stable identity (what `applyTwoSiteGate` groups on) and
 * `site` is where this run saw it. There is no field a
 * `Suggested CODING_STANDARDS.md line:` — or anything else the prompt
 * didn't ask for — could land in.
 */
export interface ProposedFinding {
  finding: string;
  site: string;
}

/**
 * Reads `Finding:` / `Site:` pairs out of the PROPOSED lens's raw text,
 * per `proposedPrompt`'s Output section, against the shared grammar
 * (`./grammar.ts`) both lenses parse against.
 */
export function parseProposedFindings(raw: string): ProposedFinding[] {
  return parseGrammarFindings(raw);
}

/**
 * One candidate pattern as the two-site gate tracks it across runs: every
 * distinct site it has been named at, and whether it has cleared the gate.
 */
export interface GatedProposedFinding {
  finding: string;
  sites: string[];
  /** `false` until a second, distinct site names this finding — "a smell seen once is not one." */
  released: boolean;
}

/**
 * The two-site gate (spec #36 §Solution: "PROPOSED is gated by the two-site
 * rule ... a smell seen once is not one," `/standards-pass`'s existing bar
 * applied to findings). Merges one run's `findings` into what prior runs
 * already recorded, keyed on `finding`'s text as its identity. A finding
 * stays unreleased on a single site, including a site named more than once
 * — only a second *distinct* site flips `released`.
 *
 * Persisting the returned state across runs (git notes, spec #36 slice 4)
 * is a later ticket's job; this function only merges what it's handed and
 * hands back the result — the same "state passed in, not read from disk"
 * shape `runAuditor` already uses for `spine` and `standards`.
 *
 * Both sides are normalized to contract form (`../site.ts`) before they are
 * compared. `previous` comes off a note that may predate that contract, and
 * an un-normalized `a.ts:1 (theFunction)` against a fresh `a.ts:1` is the
 * same sighting written two ways — which would count as two distinct sites
 * and release a finding seen once (#108). Normalizing on the way through
 * also means each run rewrites the note a little cleaner than it read it.
 */
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
