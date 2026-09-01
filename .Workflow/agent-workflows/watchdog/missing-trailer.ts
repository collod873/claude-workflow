/**
 * The judgement half of the missing-trailer counter (#124, ADR-0067): a pure
 * function over the ADR and research-note corpus that flags two kinds of
 * defect in the record —
 *
 *  - an ADR that carries a supersession verb and a link to a lower-numbered
 *    ADR, but no `Amends:` trailer naming it
 *  - a research note with no issue pointer in its preamble
 *
 * kept apart from the IO half (`./missing-trailer-counter.ts`) so it can be
 * run over a captured snapshot of this repo's own corpus
 * (`adr-corpus.evidence.json`) the same way `dead-lanes.ts` runs over
 * `push-runs.evidence.json` — against the history that motivated it, not a
 * fixture written to agree with it (#107's lesson).
 *
 * ADR-0045: *"supersession is not detectable from prose... A verb grep has a
 * known false positive on the day it ships."* This module accepts that
 * trade explicitly. It is a deliberately **raw heuristic**, not a
 * hand-curated classifier — a false positive here is not a bug, it is the
 * counter's own stated shape (ADR-0067's `Action` field: *"write the
 * trailer, or state that it is not a supersession"*). Judgement belongs to
 * whoever reads the filed issue, not to this function.
 */

/** One ADR as the corpus carries it. */
export interface AdrDoc {
  /** The four-digit number in its filename — its identity and its ordering. */
  number: number;
  filename: string;
  title: string;
  body: string;
}

/** One research note as the corpus carries it. */
export interface ResearchNote {
  filename: string;
  title: string;
  body: string;
}

/**
 * The five-word vocabulary ADR-0044 measured across this repo's own record
 * — retired ×11, amends ×10, struck ×7, restated ×2, replaces ×2 — widened
 * to each verb's own inflections (amend/amends/amended/amending, and so on)
 * so the heuristic is not blind to `replaced` or `retiring` for no better
 * reason than tense.
 *
 * Deliberately **excludes** the matching `-ment`/`-ing`-as-noun forms
 * (amendment, retirement, replacement): measured against this repo's own
 * corpus, those inflections fire almost entirely on unrelated objects — a
 * hook being retired, a spec being amended, a trigger being replaced —
 * prose about *something*, not a verb asserting *this ADR supersedes that
 * one*. Cutting the noun forms is what keeps the heuristic close to the
 * vocabulary the ADRs themselves use rather than to general English.
 *
 * `extends` is not in this list. That is the entire mechanism by which
 * ADR-0028 (*"extends ADR-0005, and both stand"*) is excluded from the
 * candidate set — not a special case, but the natural consequence of the
 * word it uses for its own lower-numbered link never being in the
 * vocabulary that makes a link count.
 */
const SUPERSESSION_VERB_RE =
  /\b(retire|retires|retired|retiring|amend|amends|amended|amending|struck|strike|strikes|striking|restate|restates|restated|restating|replace|replaces|replaced|replacing)\b/i;

/** Whether `body` uses the supersession vocabulary anywhere. */
export function hasSupersessionVerb(body: string): boolean {
  return SUPERSESSION_VERB_RE.test(body);
}

/** A markdown link whose href is another ADR's file — `[text](NNNN-slug.md)`. */
const ADR_LINK_RE = /\]\((?:\.\/)?(\d{4})-[a-z0-9-]+\.md\)/gi;

/**
 * Every ADR number `body` links to that is lower than `number` — a real
 * hyperlink, not a bare "ADR-0032" mention. The corpus cites earlier
 * rulings constantly in running prose; requiring the markdown link form is
 * what keeps a paragraph that merely *mentions* an earlier ADR from reading
 * as a candidate on its own.
 */
export function lowerNumberedAdrLinks(body: string, number: number): number[] {
  const found = new Set<number>();
  for (const match of body.matchAll(ADR_LINK_RE)) {
    const linked = Number(match[1]);
    if (linked < number) found.add(linked);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * The declared amendment edge: an `amends:` key in the ADR's frontmatter. It moved there from a
 * prose `Amends:` trailer when the corpus was re-admitted — three prose trailers had shipped
 * without the colon this regex required, so their predecessors went unstamped for months while
 * reading as amended to any human. A key `new-adr` writes cannot lose its own punctuation.
 */
const AMENDS_TRAILER_RE = /^amends:\s*ADR-\d{4}/m;

export function hasAmendsTrailer(body: string): boolean {
  return AMENDS_TRAILER_RE.test(body);
}

/**
 * An ADR that asserts supersession in prose — the vocabulary, and a real
 * link to an earlier ADR — but carries no machine-readable trailer saying
 * so. The defect ADR-0045 built this counter to catch.
 */
export function isMissingAmendsTrailer(adr: AdrDoc): boolean {
  if (hasAmendsTrailer(adr.body)) return false;
  if (!hasSupersessionVerb(adr.body)) return false;
  return lowerNumberedAdrLinks(adr.body, adr.number).length > 0;
}

/**
 * A research note's preamble — everything before its first `##` section.
 * The pointer this repo's convention writes there (`Resolves:`, and the two
 * other hand-written spellings ADR-0045 found already in use —
 * `Researches:`, `Research for`) is metadata about the *document*, not a
 * citation inside its argument. Scoping the search to the preamble is what
 * keeps a note that merely *discusses* the convention — quoting "a real
 * `Resolves:` field" three sections deep, the way `session-prompts-2026-08.md`
 * does — from reading as if it carried the field itself.
 */
function preamble(body: string): string {
  const firstSection = body.search(/\n##\s/);
  return firstSection === -1 ? body : body.slice(0, firstSection);
}

/**
 * The pointer conventions ADR-0045 found already in use, hand-written and
 * drifting: `Resolves:`, `Researches:`, `Research for` — plus `Unprompted:`,
 * the fourth spelling ADR-0072 adds for a note written with no issue behind
 * it at all. All four count as "has a pointer" here, because the counter's
 * job is to catch a note that says **nothing** about where it came from, and
 * *no issue preceded this* is an answer rather than a gap. It does not police
 * which of the drifting spellings a note used, and it does not check that a
 * cited issue is the right one — nothing ever could.
 *
 * `Unprompted:` is a separate field rather than a `Resolves: none`, which the
 * pointer test would already accept: a declared absence and a real pointer
 * have to stay separable to anything reading the corpus (ADR-0072).
 */
const RESEARCH_POINTER_RE = /\b(Resolves|Researches|Unprompted):|Research for\b/;

export function hasResolvesPointer(body: string): boolean {
  return RESEARCH_POINTER_RE.test(preamble(body));
}

/** A research note whose preamble says nothing about where it came from — ADR-0045's second finding. */
export function isMissingResolvesField(note: ResearchNote): boolean {
  return !hasResolvesPointer(note.body);
}

/** One finding the counter files — an ADR or a research note, named for the issue body. */
export interface TrailerFinding {
  kind: "adr" | "research-note";
  filename: string;
  title: string;
}

/** Every finding in the corpus: ADRs first (numeric order), then research notes (filename order). */
export function findMissingTrailers(adrs: AdrDoc[], notes: ResearchNote[]): TrailerFinding[] {
  const adrFindings: TrailerFinding[] = adrs
    .filter(isMissingAmendsTrailer)
    .sort((a, b) => a.number - b.number)
    .map((adr) => ({ kind: "adr" as const, filename: adr.filename, title: adr.title }));

  const noteFindings: TrailerFinding[] = notes
    .filter(isMissingResolvesField)
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map((note) => ({ kind: "research-note" as const, filename: note.filename, title: note.title }));

  return [...adrFindings, ...noteFindings];
}

/** A hidden marker naming the standing signal, so a later run finds it instead of filing a second one. */
export const FINDING_MARKER = "<!-- missing-trailer:corpus -->";

/** The signal's title. Stable in shape (not in count) so a reader recognises a repeat. */
export function signalTitle(findings: TrailerFinding[]): string {
  const adrCount = findings.filter((f) => f.kind === "adr").length;
  const noteCount = findings.filter((f) => f.kind === "research-note").length;
  const parts: string[] = [];
  if (adrCount > 0) parts.push(`${adrCount} ADR${adrCount === 1 ? "" : "s"}`);
  if (noteCount > 0) parts.push(`${noteCount} research note${noteCount === 1 ? "" : "s"}`);
  return `Missing supersession trailer: ${parts.join(", ")}`;
}

export function signalBody(findings: TrailerFinding[]): string {
  const adrLines = findings
    .filter((f) => f.kind === "adr")
    .map((f) => `- [ ] \`${f.filename}\` carries a supersession verb and a lower-numbered ADR link, but no \`Amends:\` trailer`);
  const noteLines = findings
    .filter((f) => f.kind === "research-note")
    .map((f) => `- [ ] \`${f.filename}\` carries no \`Resolves:\` field`);

  return [
    "This repo's record can't say its own mind changed until the trailer exists to read",
    "(`docs/adr/0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md`).",
    "",
    ...(adrLines.length > 0 ? ["**ADRs missing an `Amends:` trailer:**", "", ...adrLines, ""] : []),
    ...(noteLines.length > 0 ? ["**Research notes missing a `Resolves:` field:**", "", ...noteLines, ""] : []),
    "**To clear a line:** write the trailer (or the field), or reply here saying it is not a",
    "supersession — this is a known-noisy heuristic (ADR-0045) and a false positive is an expected",
    "outcome here, not a bug.",
    "",
    FINDING_MARKER,
  ].join("\n");
}
