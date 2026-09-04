export interface AdrDoc {
  number: number;
  filename: string;
  title: string;
  body: string;
}

export interface ResearchNote {
  filename: string;
  title: string;
  body: string;
}

const SUPERSESSION_VERB_RE =
  /\b(retire|retires|retired|retiring|amend|amends|amended|amending|struck|strike|strikes|striking|restate|restates|restated|restating|replace|replaces|replaced|replacing)\b/i;

export function hasSupersessionVerb(body: string): boolean {
  return SUPERSESSION_VERB_RE.test(body);
}

const ADR_LINK_RE = /\]\((?:\.\/)?(\d{4})-[a-z0-9-]+\.md\)/gi;

export function lowerNumberedAdrLinks(body: string, number: number): number[] {
  const found = new Set<number>();
  for (const match of body.matchAll(ADR_LINK_RE)) {
    const linked = Number(match[1]);
    if (linked < number) found.add(linked);
  }
  return [...found].sort((a, b) => a - b);
}

const AMENDS_TRAILER_RE = /^amends:\s*ADR-\d{4}/m;

export function hasAmendsTrailer(body: string): boolean {
  return AMENDS_TRAILER_RE.test(body);
}

export function isMissingAmendsTrailer(adr: AdrDoc): boolean {
  if (hasAmendsTrailer(adr.body)) return false;
  if (!hasSupersessionVerb(adr.body)) return false;
  return lowerNumberedAdrLinks(adr.body, adr.number).length > 0;
}

function preamble(body: string): string {
  const firstSection = body.search(/\n##\s/);
  return firstSection === -1 ? body : body.slice(0, firstSection);
}

const RESEARCH_POINTER_RE = /\b(Resolves|Researches|Unprompted):|Research for\b/;

export function hasResolvesPointer(body: string): boolean {
  return RESEARCH_POINTER_RE.test(preamble(body));
}

export function isMissingResolvesField(note: ResearchNote): boolean {
  return !hasResolvesPointer(note.body);
}

export interface TrailerFinding {
  kind: "adr" | "research-note";
  filename: string;
  title: string;
}

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

export const FINDING_MARKER = "<!-- missing-trailer:corpus -->";

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
    "supersession; this is a known-noisy heuristic (ADR-0045) and a false positive is an expected",
    "outcome here, not a bug.",
    "",
    FINDING_MARKER,
  ].join("\n");
}
