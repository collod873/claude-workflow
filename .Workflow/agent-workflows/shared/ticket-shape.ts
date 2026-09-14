import type { GhExec } from "./gh";
import rules from "./ticket-shape.rules.json";

const { fragments, grammar, refusals } = rules;

function compile(rule: { source: string; flags: string }): RegExp {
  let source = rule.source;
  for (const [name, spelling] of Object.entries(fragments)) {
    source = source.replaceAll(`{${name}}`, spelling);
  }
  return new RegExp(source, rule.flags);
}

export const CRITERIA_HEADING = "## Acceptance criteria";

export const CRITERIA_HEADING_RE = compile(grammar.criteriaHeading);

export const CRITERIA_ITEM_RE = compile(grammar.criteriaItem);

const CRITERIA_ITEM_STRIP_RE = compile(grammar.criteriaItemStrip);

export const PATH_LINE_RE = /[\w./-]*[/.][\w./-]*:\d+/;

const NEXT_HEADING_RE = compile(grammar.nextHeading);

export const CHECK_MARKER_ATTEMPT_RE = compile(grammar.checkMarkerAttempt);

export const CHECK_MARKER_RE = compile(grammar.checkMarker);

export function parseCheckMarker(criterion: string): string | undefined {
  const match = CHECK_MARKER_RE.exec(criterion.trim());
  return match ? match[1].trim() : undefined;
}

const LINE_TERMINATOR_RE = compile(grammar.lineTerminator);

export function normalizeNewlines(text: string): string {
  return text.replace(LINE_TERMINATOR_RE, "\n");
}

export function sectionText(body: string, headingRe: RegExp): string {
  const heading = headingRe.exec(body);
  if (!heading) {
    return "";
  }
  const rest = body.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING_RE.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

export function countCriteria(body: string): number | null {
  const normalized = normalizeNewlines(body);
  if (!CRITERIA_HEADING_RE.test(normalized)) {
    return null;
  }
  const section = sectionText(normalized, CRITERIA_HEADING_RE);
  return section.split("\n").filter((line) => CRITERIA_ITEM_RE.test(line)).length;
}

const PARENT_PRD_RE = /^##[ \t]+Parent PRD[ \t]*\n#(\d+)/m;

export function parentPrdNumber(body: string): number | undefined {
  const match = PARENT_PRD_RE.exec(normalizeNewlines(body));
  return match ? Number(match[1]) : undefined;
}

export const FILES_HEADING_RE = compile(grammar.filesClaimedHeading);

const NO_FILES_SENTINEL_RE = compile(grammar.noFilesSentinel);

export function extractFilesClaimed(body: string): string[] {
  const paths: string[] = [];
  for (const line of sectionText(normalizeNewlines(body), FILES_HEADING_RE).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const item = trimmed.slice(1).trim().replace(/^`+|`+$/g, "").trim();
    if (item.length > 0 && !NO_FILES_SENTINEL_RE.test(item)) paths.push(item);
  }
  return paths;
}

function fnmatchRegExp(pattern: string): RegExp {
  let result = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i];
    i += 1;
    if (c === "*") {
      result += ".*";
    } else if (c === "?") {
      result += ".";
    } else if (c === "[") {
      let j = i;
      if (j < n && pattern[j] === "!") j += 1;
      if (j < n && pattern[j] === "]") j += 1;
      while (j < n && pattern[j] !== "]") j += 1;
      if (j >= n) {
        result += "\\[";
      } else {
        let stuff = pattern.slice(i, j).replaceAll("\\", "\\\\");
        i = j + 1;
        if (stuff.startsWith("!")) {
          stuff = `^${stuff.slice(1)}`;
        } else if (stuff.startsWith("^")) {
          stuff = `\\${stuff}`;
        }
        result += `[${stuff}]`;
      }
    } else {
      result += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^(?:${result})$`);
}

function fnmatch(name: string, pattern: string): boolean {
  return fnmatchRegExp(pattern).test(name);
}

function asDir(path: string): string {
  return `${path.replace(/\/+$/, "")}/`;
}

export function claimsCollide(claim: readonly string[], other: readonly string[]): boolean {
  for (const a of claim) {
    const aDir = asDir(a);
    for (const b of other) {
      const bDir = asDir(b);
      if (a === b || fnmatch(b, a) || fnmatch(a, b)) return true;
      if (b.startsWith(aDir) || a.startsWith(bDir)) return true;
    }
  }
  return false;
}

export interface TicketRead {
  title: string;
  body: string;
}

export function readTicket(gh: GhExec, issueNumber: number): TicketRead {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "title,body"]);
  return JSON.parse(raw) as TicketRead;
}

export function extractCriteria(body: string): string[] {
  return (criteriaBlocks(body) ?? []).map((block) =>
    block.replace(CRITERIA_ITEM_STRIP_RE, "").trim(),
  );
}

export function isRunnableSpec(body: string): boolean {
  const criteria = extractCriteria(body);
  if (criteria.length !== 1) return false;
  return parseCheckMarker(criteria[0]) !== undefined;
}

export class TicketShapeError extends Error {}

export const CLAIM_LIMIT = rules.claimLimit;

export function claimTooWide(count: number): string {
  return refusals.claimTooWide
    .replaceAll("{count}", String(count))
    .replaceAll("{limit}", String(CLAIM_LIMIT));
}

export function overWideClaim(body: string): number | undefined {
  const count = extractFilesClaimed(normalizeNewlines(body)).length;
  return count > CLAIM_LIMIT ? count : undefined;
}

export function criteriaBlocks(body: string): string[] | null {
  const normalized = normalizeNewlines(body);
  if (!CRITERIA_HEADING_RE.test(normalized)) {
    return null;
  }
  const blocks: string[] = [];
  for (const line of sectionText(normalized, CRITERIA_HEADING_RE).split("\n")) {
    if (CRITERIA_ITEM_RE.test(line)) {
      blocks.push(line.trim());
    } else if (blocks.length > 0 && line.trim().length > 0) {
      blocks[blocks.length - 1] += ` ${line.trim()}`;
    }
  }
  return blocks;
}

export function assertTicketShape(body: string): void {
  const normalized = normalizeNewlines(body);

  if (!CRITERIA_HEADING_RE.test(normalized)) {
    throw new TicketShapeError(refusals.missingCriteriaHeading);
  }
  if (!CRITERIA_ITEM_RE.test(sectionText(normalized, CRITERIA_HEADING_RE))) {
    throw new TicketShapeError(refusals.criteriaHeadingWithoutItems);
  }
  if (!FILES_HEADING_RE.test(normalized)) {
    throw new TicketShapeError(refusals.missingFilesClaimedHeading);
  }
  const overWide = overWideClaim(normalized);
  if (overWide !== undefined) {
    throw new TicketShapeError(claimTooWide(overWide));
  }
}
