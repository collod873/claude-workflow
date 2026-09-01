import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhExec } from "./gh";

/**
 * The ticket body grammar: the headings a published ticket carries, and the
 * shapes a reader is allowed to recognise them by.
 *
 * One module because this grammar has two sides that must not drift.
 * `render-body.ts` *writes* `## Acceptance criteria` into every ticket the
 * slicer publishes; `.claude/hooks/close-gate.py` *reads* it back months
 * later to decide whether a close is honest. Those two spelled the heading
 * independently until this file existed, and a heading renamed on the write
 * side would have made every close refuse for a reason nobody could see —
 * the reader would report "no acceptance criteria" about a ticket that
 * plainly has some.
 *
 * Ported from era 6's `hooks/ticket_shape.py`, with one deliberate
 * tightening: every intra-line gap is `[ \t]` where the Python used `\s`.
 * Python's `\s` matches a newline, so `^##\s+Acceptance criteria` could
 * match a heading split across two lines. Nothing ever wrote one, so the
 * tightening changes no real input — it only stops the reader accepting a
 * shape the writer cannot produce.
 */

/** The literal heading `render-body.ts` writes and the close gate reads. */
export const CRITERIA_HEADING = "## Acceptance criteria";

/** The heading line itself, anchored to its own line. */
export const CRITERIA_HEADING_RE = /^##[ \t]+Acceptance criteria[ \t]*$/m;

/**
 * One acceptance criterion: a markdown checkbox item. A plain `- ` bullet is
 * deliberately not one — the distinction is what lets a ticket carry prose
 * bullets under the heading without inflating the criterion count the
 * closing record has to match.
 */
export const CRITERIA_ITEM_RE = /^[ \t]*-[ \t]*\[[ xX]\]/m;

/**
 * A `path:line` reference — the shape a closing record's evidence has to
 * take when it isn't a command with an exit status.
 *
 * The `[/.]` in the middle is load-bearing: it demands a slash or a dot
 * somewhere in the path, so a bare word before a colon (`foo:12`) does not
 * count. That was era 6's #107 unification — a producer that warned about
 * `foo:12` and a close gate that refused it now share one definition of
 * what a path looks like, so a ticket accepted as evidenced can never be
 * refused at close over the same text.
 */
export const PATH_LINE_RE = /[\w./-]*[/.][\w./-]*:\d+/;

/** Where a `##` section ends: at the next one, or at the end of the body. */
const NEXT_HEADING_RE = /^##[ \t]/m;

/**
 * The delimiter a trailing marker sits behind — em dash, en dash, or a
 * space-delimited single/double hyphen. Ported verbatim from
 * `bin/ticket_shape.py`'s `CHECK_MARKER_DELIM`, which took it from the close
 * gate's own `VERDICT_RE`, so a ticket author never learns two dash rules for
 * two trailing markers.
 */
export const CHECK_MARKER_DELIM = "(?:—|–|(?<=\\s)-{1,2}(?=\\s))";

/**
 * An *attempt* at a `check:` marker: the delimiter and the label, whatever
 * follows. Case-insensitive, deliberately — `— Check: \`x\`` is a criterion
 * that tried and got the shape wrong, which is a different fact from prose
 * that never mentioned a check at all.
 */
export const CHECK_MARKER_ATTEMPT_RE = new RegExp(`${CHECK_MARKER_DELIM}\\s*check:`, "i");

/**
 * A well-formed marker: the attempt, then exactly one backtick-quoted command
 * and nothing else before the criterion ends. Anchored at both ends so a
 * second backtick span, or trailing prose, fails to parse rather than
 * silently grabbing the wrong span.
 *
 * **This is a port, and the port is the point.** `bin/close-ticket` runs a
 * criterion's check by parsing it with `bin/ticket_shape.py`'s
 * `CHECK_MARKER_RE`; lane 03 writes that criterion through
 * `render-body.ts`. Until #215 the two had never met — the slicer emitted a
 * bare `check: <command>` with no delimiter and no backticks, which the
 * Python side reads as prose, so every ticket the chain sliced closed on
 * `0 of N criteria verified`. `render-body.test.ts` drives a rendered body
 * through the real Python reader rather than trusting this copy of the
 * pattern, which is what keeps the port honest.
 */
export const CHECK_MARKER_RE = new RegExp(
  `${CHECK_MARKER_DELIM}\\s*check:\\s*\`([^\`\\n]+)\`\\s*$`,
);

/**
 * The command a criterion's trailing `check:` marker names, or `undefined`
 * when it carries no well-formed one — matching `parse_check_marker`'s
 * deliberate blindness to *why*: prose and a malformed marker both answer
 * `undefined` here, and telling those apart is the caller's job
 * (`CHECK_MARKER_ATTEMPT_RE`).
 */
export function parseCheckMarker(criterion: string): string | undefined {
  const match = CHECK_MARKER_RE.exec(criterion.trim());
  return match ? match[1].trim() : undefined;
}

/**
 * Normalises the line endings of anything read off the tracker before a
 * line-anchored pattern is run over it.
 *
 * This is new at this venue and not optional here. Era 6's gate read issue
 * bodies through `gh` on a Unix workstation; this one reads bodies typed
 * into the GitHub web UI, which sends CRLF. A `[ \t]*$` anchor does not
 * match before a `\r`, so without this every heading and every standalone
 * range line written in a browser would silently fail to parse and every
 * such close would be refused for a reason that isn't true.
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The raw text under `headingRe`'s heading, up to the next `##` heading or
 * the end of `body` — `""` when the heading is absent.
 *
 * The only markdown section slicer in this repo, deliberately: every reader
 * that needs to know how far a section extends calls this rather than
 * restating the slice, so "where does the section end" has one answer.
 */
export function sectionText(body: string, headingRe: RegExp): string {
  const heading = headingRe.exec(body);
  if (!heading) {
    return "";
  }
  const rest = body.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING_RE.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * How many acceptance criteria `body` declares.
 *
 * `null` means the heading itself is missing, which is a different fact
 * from zero items under a heading that does exist — the first says this is
 * not a ticket, the second says it is a ticket nobody wrote criteria for,
 * and the close gate says different things about them.
 */
export function countCriteria(body: string): number | null {
  const normalized = normalizeNewlines(body);
  if (!CRITERIA_HEADING_RE.test(normalized)) {
    return null;
  }
  const section = sectionText(normalized, CRITERIA_HEADING_RE);
  return section.split("\n").filter((line) => CRITERIA_ITEM_RE.test(line)).length;
}

/**
 * One `## Parent PRD\n#<n>` heading, as `shared/render-body.ts` writes it on
 * every ticket this repo publishes.
 */
const PARENT_PRD_RE = /^##[ \t]+Parent PRD[ \t]*\n#(\d+)/m;

/** The parent PRD's issue number, or `undefined` when the body carries none. */
export function parentPrdNumber(body: string): number | undefined {
  const match = PARENT_PRD_RE.exec(normalizeNewlines(body));
  return match ? Number(match[1]) : undefined;
}

/** `render-body.ts`'s `## Files claimed` heading — always present on a published ticket. */
export const FILES_HEADING_RE = /^##[ \t]+Files claimed[ \t]*$/m;

const FILE_ITEM_RE = /^[ \t]*-[ \t]*(.+?)[ \t]*$/;

/**
 * The repo-relative paths a ticket's `## Files claimed` section names, one
 * per `- ` bullet, in the body's own order. `render-body.ts` writes
 * `- None — no files.` for an empty claim, which this filters out rather
 * than returning as a path — nothing on disk is named "None".
 *
 * Lives here rather than in `implement/implement.ts`, where it was written,
 * because lane 04 reads the same section for a different purpose
 * ([ADR-0098](../../../docs/adr/0098-the-acceptance-author-is-shown-the-files-its-ticket-claims-r.md)):
 * a slice's claimed files are a fact about ticket shape, and two lanes
 * asking the same question of the same heading must not be two parsers.
 */
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

/** A ticket's title and body, as `readTicket` reads them off the tracker. */
export interface TicketRead {
  title: string;
  body: string;
}

/** Reads a ticket's title and body through `gh` — a plain `gh issue view`, nothing else. */
export function readTicket(gh: GhExec, issueNumber: number): TicketRead {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "title,body"]);
  return JSON.parse(raw) as TicketRead;
}

/**
 * The criterion strings a ticket body declares under `## Acceptance
 * criteria`, in the body's own order — each with its leading `- [ ]` and
 * surrounding whitespace stripped, everything after that verbatim.
 */
export function extractCriteria(body: string): string[] {
  const normalized = normalizeNewlines(body);
  const section = sectionText(normalized, CRITERIA_HEADING_RE);
  return section
    .split("\n")
    .filter((line) => CRITERIA_ITEM_RE.test(line))
    .map((line) => line.replace(/^[ \t]*-[ \t]*\[[ xX]\][ \t]*/, "").trim());
}

/**
 * Whether `body` is a spec a mechanical closer could run unattended: exactly
 * one acceptance criterion, carrying a well-formed `check:` marker.
 *
 * Mirrors `bin/ticket_shape.py`'s `ticket` branch's own instinct — a
 * criterion is only as good as the command that verifies it — but tightens
 * it for a spec rather than a ticket: a ticket may declare several criteria
 * because several tickets close it piece by piece, but a spec's own check is
 * the one thing lane 09's spec-evaluate pass (`dispatch/reconcile.ts`) can
 * run by itself, so zero, two, or an unparseable marker are all refused
 * alike rather than three different shapes of "close enough".
 */
export function isRunnableSpec(body: string): boolean {
  const criteria = extractCriteria(body);
  if (criteria.length !== 1) return false;
  return parseCheckMarker(criteria[0]) !== undefined;
}

/**
 * Raised by `validateTicket` when `body` doesn't fit a ticket's required
 * shape — the same distinction `bin/ticket_shape.py`'s `ValidationError`
 * makes: a refusal, never a warning.
 */
export class TicketShapeError extends Error {}

/** Every `- [ ]` item under `## Acceptance criteria`, folded with its continuation lines into one
 * string per criterion, in document order — the port of `bin/ticket_shape.py`'s `criteria_blocks`.
 * A criterion wrapped across several lines is one claim; judging only its first line reads half a
 * sentence. `null` when `body` carries no `## Acceptance criteria` heading at all. */
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

/** A backtick-quoted span — the port of `bin/ticket_shape.py`'s `BACKTICK_RE`. */
const BACKTICK_RE = /`[^`\n]+`/;

/** A slashed repo-relative-looking path — the port of `bin/ticket_shape.py`'s `FILE_PATH_RE`. */
const FILE_PATH_RE = /\b[\w.-]+(?:\/[\w.-]+)+\b/;

/** Whether `line` carries evidence a fresh reader could check against — a `path:line`, a
 * backtick-quoted span, or a slashed path. Port of `bin/ticket_shape.py`'s `_has_evidence`. */
function hasEvidence(line: string): boolean {
  return PATH_LINE_RE.test(line) || BACKTICK_RE.test(line) || FILE_PATH_RE.test(line);
}

const NO_EVIDENCE_WARNING =
  "no acceptance criterion names a path:line, a backtick-quoted command, or a " +
  "file/artifact reference — criteria should be verifiable by a fresh context that has " +
  "not seen the diff";

const MALFORMED_CHECK_MARKER_PREFIX = "acceptance criterion carries a `check:` marker that doesn't parse";

function malformedCheckMarker(criterion: string): boolean {
  return CHECK_MARKER_ATTEMPT_RE.test(criterion) && parseCheckMarker(criterion) === undefined;
}

function malformedCheckMarkerWarning(criterion: string): string {
  return (
    `${MALFORMED_CHECK_MARKER_PREFIX}: ${criterion} — a well-formed marker names exactly ` +
    "one backtick-quoted command immediately after `check:`, with nothing else following " +
    "it before the criterion ends"
  );
}

/** The literal `## Files claimed` no-files sentinel `render-body.ts` writes — the port of
 * `bin/ticket_shape.py`'s `NO_FILES_SENTINEL_RE`. */
const NO_FILES_SENTINEL_RE = /^None\b.*no files/i;

/** Glob metacharacters — a claim carrying one of these is a fan-out, never a literal path
 * (ADR-0007), so `unresolvedClaimedPaths` skips it rather than resolving it. */
const GLOB_CHAR_RE = /[*?[]/;

/** Parses `## Files claimed` bullets into normalized path/glob strings — the port of
 * `bin/ticket_shape.py`'s `claimed_paths`: strips the leading `-`, surrounding backticks and
 * whitespace, and drops the no-files sentinel. */
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

/** The repository root a ticket's claimed paths resolve against — three levels up from `shared/`
 * in every checkout, the same anchor `render-body.ts`'s `repoTopLevel` uses. */
function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** Warns about every `## Files claimed` bullet naming neither an existing path nor a glob — the
 * port of `bin/ticket_shape.py`'s `unresolved_claimed_paths`. Never refuses: a ticket may
 * legitimately claim a path it is about to create. */
function unresolvedClaimedPaths(body: string, repoRoot: string): string[] {
  const warnings: string[] = [];
  for (const path of claimedPaths(body)) {
    if (GLOB_CHAR_RE.test(path)) continue;
    if (existsSync(resolve(repoRoot, path))) continue;
    warnings.push(`claimed path \`${path}\` not found in the working tree`);
  }
  return warnings;
}

/** The vocabulary marking work done *to* existing state — the port of `bin/ticket_shape.py`'s
 * `MIGRATION_RE`. */
const MIGRATION_RE =
  /\b(?:migrat(?:e|es|ed|ing|ion|ions)|backfill(?:s|ed|ing)?|scrub(?:s|bed|bing)?|purg(?:e|es|ed|ing)|rewrit(?:e|es|ing|ten)|reindex(?:es|ed|ing)?|one-off)\b/i;

/** A criterion naming a test — the port of `bin/ticket_shape.py`'s `TEST_MENTION_RE`. */
const TEST_MENTION_RE = /\btests?\b|\bvitest\b|\bpytest\b|\bjest\b/i;

/** A bare filename carrying an extension — the port of `bin/ticket_shape.py`'s `BASENAME_RE`. */
const BASENAME_RE = /\b[\w-]+(?:\.[\w-]+)+\b/;

const MIGRATION_NO_POST_STATE_WARNING =
  "this reads like a migration, but every acceptance criterion is satisfied by the " +
  "artifact existing — a test passing, or a path this ticket already claims. A migration " +
  "ticket closes on the migration having run: add a criterion asserting the post-state of " +
  "what is being migrated, checkable against the real target rather than a fixture the " +
  "ticket's own test builds (ADR-0076 in collod873/claude-workflow, #134)";

/** Every file-ish token `text` names — the port of `bin/ticket_shape.py`'s `_evidence_tokens`. */
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

/** True when `token` names one of the ticket's own claims — the port of `bin/ticket_shape.py`'s
 * `_is_claimed`. */
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

/** Warns when a ticket reads like a migration but every acceptance criterion is satisfied by its
 * artifact existing — the port of `bin/ticket_shape.py`'s `migration_without_post_state`
 * (#144, ADR-0076). Never refuses, matching `NO_EVIDENCE_WARNING`'s severity. */
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

/**
 * Validates `body` against a ticket's required shape — the same verdict as `bin/ticket_shape.py`'s
 * `validate("ticket", body)`, ported rather than re-derived: `ticket-shape.test.ts` drives both
 * readers over the same corpus of bodies so the two can never silently disagree about what a
 * ticket has to look like.
 *
 * Throws `TicketShapeError`, naming what's missing, on refusal — a body missing either required
 * heading, or an `## Acceptance criteria` heading with no `- [ ]` items. Returns a (possibly
 * empty) array of warnings on success: no criterion carries verifiable evidence, a `## Files
 * claimed` bullet that doesn't resolve against the working tree, a malformed `check:` marker, or
 * a migration-shaped body whose every criterion is satisfied by its own artifact existing.
 *
 * `repoRoot` is the tree `## Files claimed` bullets resolve against; defaults to this repo's own
 * root. Pass it explicitly to validate a body against a different checkout.
 */
export function validateTicket(body: string, repoRoot: string = defaultRepoRoot()): string[] {
  const normalized = normalizeNewlines(body);

  if (!CRITERIA_HEADING_RE.test(normalized)) {
    throw new TicketShapeError("missing required '## Acceptance criteria' heading");
  }
  if (!CRITERIA_ITEM_RE.test(sectionText(normalized, CRITERIA_HEADING_RE))) {
    throw new TicketShapeError(
      "'## Acceptance criteria' heading has no '- [ ]' items — plain '- ' bullets don't count",
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
