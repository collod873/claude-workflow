import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhExec } from "./gh";

export const CRITERIA_HEADING = "## Acceptance criteria";

export const CRITERIA_HEADING_RE = /^##[ \t]+Acceptance criteria[ \t]*$/m;

export const CRITERIA_ITEM_RE = /^[ \t]*-[ \t]*\[[ xX]\]/m;

export const PATH_LINE_RE = /[\w./-]*[/.][\w./-]*:\d+/;

const NEXT_HEADING_RE = /^##[ \t]/m;

export const CHECK_MARKER_DELIM = "(?:—|–|(?<=\\s)-{1,2}(?=\\s))";

export const CHECK_MARKER_ATTEMPT_RE = new RegExp(`${CHECK_MARKER_DELIM}\\s*check:`, "i");

export const CHECK_MARKER_RE = new RegExp(
  `${CHECK_MARKER_DELIM}\\s*check:\\s*\`([^\`\\n]+)\`\\s*$`,
);

export function parseCheckMarker(criterion: string): string | undefined {
  const match = CHECK_MARKER_RE.exec(criterion.trim());
  return match ? match[1].trim() : undefined;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
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

export const FILES_HEADING_RE = /^##[ \t]+Files claimed[ \t]*$/m;

const FILE_ITEM_RE = /^[ \t]*-[ \t]*(.+?)[ \t]*$/;

export function extractFilesClaimed(body: string): string[] {
  const section = sectionText(normalizeNewlines(body), FILES_HEADING_RE);
  const paths: string[] = [];
  for (const line of section.split("\n")) {
    const match = FILE_ITEM_RE.exec(line);
    if (!match) continue;
    const path = match[1].trim();
    if (path.length > 0 && path !== "None — no files.") paths.push(path);
  }
  return paths;
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
  const normalized = normalizeNewlines(body);
  const section = sectionText(normalized, CRITERIA_HEADING_RE);
  return section
    .split("\n")
    .filter((line) => CRITERIA_ITEM_RE.test(line))
    .map((line) => line.replace(/^[ \t]*-[ \t]*\[[ xX]\][ \t]*/, "").trim());
}

export function isRunnableSpec(body: string): boolean {
  const criteria = extractCriteria(body);
  if (criteria.length !== 1) return false;
  return parseCheckMarker(criteria[0]) !== undefined;
}

export class TicketShapeError extends Error {}

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

const BACKTICK_RE = /`[^`\n]+`/;

const FILE_PATH_RE = /\b[\w.-]+(?:\/[\w.-]+)+\b/;

function hasEvidence(line: string): boolean {
  return PATH_LINE_RE.test(line) || BACKTICK_RE.test(line) || FILE_PATH_RE.test(line);
}

const NO_EVIDENCE_WARNING =
  "no acceptance criterion names a path:line, a backtick-quoted command, or a " +
  "file/artifact reference; criteria should be verifiable by a fresh context that has " +
  "not seen the diff";

const MALFORMED_CHECK_MARKER_PREFIX = "acceptance criterion carries a `check:` marker that doesn't parse";

function malformedCheckMarker(criterion: string): boolean {
  return CHECK_MARKER_ATTEMPT_RE.test(criterion) && parseCheckMarker(criterion) === undefined;
}

function malformedCheckMarkerWarning(criterion: string): string {
  return (
    `${MALFORMED_CHECK_MARKER_PREFIX}: ${criterion}. A well-formed marker names exactly ` +
    "one backtick-quoted command immediately after `check:`, with nothing else following " +
    "it before the criterion ends"
  );
}

const NO_FILES_SENTINEL_RE = /^None\b.*no files/i;

const GLOB_CHAR_RE = /[*?[]/;

function claimedPaths(body: string): string[] {
  const paths: string[] = [];
  for (const line of sectionText(normalizeNewlines(body), FILES_HEADING_RE).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const item = trimmed.slice(1).trim().replace(/^`+|`+$/g, "").trim();
    if (item.length > 0 && !NO_FILES_SENTINEL_RE.test(item)) paths.push(item);
  }
  return paths;
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function unresolvedClaimedPaths(body: string, repoRoot: string): string[] {
  const warnings: string[] = [];
  for (const path of claimedPaths(body)) {
    if (GLOB_CHAR_RE.test(path)) continue;
    if (existsSync(resolve(repoRoot, path))) continue;
    warnings.push(`claimed path \`${path}\` not found in the working tree`);
  }
  return warnings;
}

const MIGRATION_RE =
  /\b(?:migrat(?:e|es|ed|ing|ion|ions)|backfill(?:s|ed|ing)?|scrub(?:s|bed|bing)?|purg(?:e|es|ed|ing)|rewrit(?:e|es|ing|ten)|reindex(?:es|ed|ing)?|one-off)\b/i;

const TEST_MENTION_RE = /\btests?\b|\bvitest\b|\bpytest\b|\bjest\b/i;

const BASENAME_RE = /\b[\w-]+(?:\.[\w-]+)+\b/;

const MIGRATION_NO_POST_STATE_WARNING =
  "this reads like a migration, but every acceptance criterion is satisfied by the " +
  "artifact existing: a test passing, or a path this ticket already claims. A migration " +
  "ticket closes on the migration having run: add a criterion asserting the post-state of " +
  "what is being migrated, checkable against the real target rather than a fixture the " +
  "ticket's own test builds (ADR-0076 in collod873/claude-workflow, #134)";

function evidenceTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(new RegExp(PATH_LINE_RE, "g"))) {
    tokens.push(match[0].replace(/:\d+$/, ""));
  }
  for (const match of text.matchAll(new RegExp(FILE_PATH_RE, "g"))) {
    tokens.push(match[0]);
  }
  for (const match of text.matchAll(new RegExp(BASENAME_RE, "g"))) {
    tokens.push(match[0]);
  }
  return tokens.filter((token) => token.length > 0);
}

function isClaimed(token: string, claimed: string[]): boolean {
  for (const raw of claimed) {
    const claim = raw.replace(/^`+|`+$/g, "");
    if (token === claim || claim.endsWith(`/${token}`) || token.endsWith(`/${claim}`)) return true;
    if (GLOB_CHAR_RE.test(claim)) {
      const pattern = new RegExp(`^${claim.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
      if (pattern.test(token)) return true;
    }
    if (token.split("/").at(-1) === claim.split("/").at(-1)) return true;
  }
  return false;
}

function migrationWithoutPostState(body: string): string[] {
  if (!MIGRATION_RE.test(body)) return [];
  const blocks = criteriaBlocks(body) ?? [];
  if (blocks.length === 0) return [];
  const claimed = claimedPaths(body);
  for (const block of blocks) {
    if (TEST_MENTION_RE.test(block)) continue;
    const tokens = evidenceTokens(block);
    if (tokens.length > 0 && tokens.every((token) => isClaimed(token, claimed))) continue;
    return [];
  }
  return [MIGRATION_NO_POST_STATE_WARNING];
}

export function validateTicket(body: string, repoRoot: string = defaultRepoRoot()): string[] {
  const normalized = normalizeNewlines(body);

  if (!CRITERIA_HEADING_RE.test(normalized)) {
    throw new TicketShapeError("missing required '## Acceptance criteria' heading");
  }
  if (!CRITERIA_ITEM_RE.test(sectionText(normalized, CRITERIA_HEADING_RE))) {
    throw new TicketShapeError(
      "'## Acceptance criteria' heading has no '- [ ]' items; plain '- ' bullets don't count",
    );
  }
  if (!FILES_HEADING_RE.test(normalized)) {
    throw new TicketShapeError("missing required '## Files claimed' heading");
  }

  const warnings: string[] = [];
  const lines = extractCriteria(normalized);
  if (lines.length > 0 && !lines.some((line) => hasEvidence(line))) {
    warnings.push(NO_EVIDENCE_WARNING);
  }
  for (const block of criteriaBlocks(normalized) ?? []) {
    if (malformedCheckMarker(block)) {
      warnings.push(malformedCheckMarkerWarning(block));
    }
  }
  warnings.push(...unresolvedClaimedPaths(normalized, repoRoot));
  warnings.push(...migrationWithoutPostState(normalized));
  return warnings;
}
