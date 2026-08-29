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
