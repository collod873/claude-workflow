import { z } from "zod";
import type { GhExec } from "../shared/gh";
import { parseIssueNumber } from "../shared/issue-url";
import type { SpecAuthorOutput } from "./author-contract";
import { validateSpecBody, type SpecBodyValidator } from "./validate-spec";

/**
 * Lane 02's publication step — ADR-0062's step 1, "the author publishes; the spec carries `prd`".
 *
 * Everything else in this lane existed and was tested: the author, the critic, the arithmetic gate,
 * the dispatch, the rounds counter. Nothing created the issue all of them act on, and
 * `spec.yml`'s job was a `run: echo` proof-of-life — so a `PRD:` issue payload was assembled in
 * memory on a runner and thrown away. #145 shipped every part of lane 02 except the one that makes
 * it visible.
 *
 * `prd` and not `sliceable`: ADR-0062 split the two so that `prd` means *this is a spec* and
 * `sliceable` means *it has no unanswered questions*. `applyGate` (`open-questions.ts`) is the only
 * thing that ever writes the second, and it writes it before the dispatch so a lost dispatch leaves
 * a durable trace. Publishing must therefore never anticipate it, however confident the count.
 */

/** The label every published spec carries, whatever its open-question count (ADR-0062). */
export const PRD_LABEL = "prd";

// The accept-side dispatch (`SPEC_AUTHOR_DISPATCH_EVENT_TYPE`, `dispatchSpecAuthor`) lives in

/**
 * Where a published spec came from, recorded on the spec itself.
 *
 * `spec.ts`'s `planSpecRun` reads this back to refuse a second `to-spec` on a source that already
 * has a `sliceable` spec drafted from it (#263) — searching every published spec's own trailer for
 * one naming the same source issue, since there is no tracker query that reaches into a body.
 *
 * The same trailer idiom `decision-sheet:v1` and `shape-accepted:v1` already use, for the same
 * reason and with the same escaping. Only the two collector-backed doors appear here: a spec
 * written in a live session has no source issue to re-collect from, and needs none — it *is* its
 * own source, so it re-enters the lane at the critic and never reads a marker at all (ADR-0085).
 */
export const SpecSource = z.object({
  kind: z.enum(["sheet", "map"]),
  /** The issue the collector reads: the accepted idea, or the closed map. */
  issue: z.number(),
});

export type SpecSource = z.infer<typeof SpecSource>;

const SOURCE_MARKER = "<!-- spec-source:v1";
const SOURCE_OPEN = `${SOURCE_MARKER} `;
const SOURCE_CLOSE = " -->";

/**
 * The source trailer for the end of a spec body — mirroring `shape/marker.ts`'s `>` escaping, and
 * for the identical reason: a `-->` inside the JSON would close the comment early, and every `>` in
 * a JSON document is inside a string, so escaping them all after `JSON.stringify` cannot corrupt it.
 */
export function sourceMarker(source: SpecSource): string {
  return `${SOURCE_OPEN}${JSON.stringify(source).replaceAll(">", "\\u003e")}${SOURCE_CLOSE}`;
}

/**
 * The source a spec body records, or `undefined` when it records none — a spec published before
 * this marker existed, one published from a live session, or a trailer someone hand-edited into
 * unreadability. Unreadable reads as absent rather than throwing, the same way `readSheetMarker`
 * treats a malformed sheet: a spec whose trailer rotted should be re-runnable by hand, not
 * permanently un-openable.
 */
export function readSourceMarker(body: string): SpecSource | undefined {
  const at = locateSourceMarker(body);
  if (at === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(at.open + SOURCE_OPEN.length, at.close));
  } catch {
    return undefined;
  }

  const result = SpecSource.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** Where the trailer's payload starts and ends in `body`, or `undefined` when there is no trailer. */
function locateSourceMarker(body: string): { open: number; close: number } | undefined {
  const open = body.lastIndexOf(SOURCE_OPEN);
  if (open === -1) return undefined;

  const close = body.indexOf(SOURCE_CLOSE, open + SOURCE_OPEN.length);
  return close === -1 ? undefined : { open, close };
}

/**
 * The body without its source trailer — what a stage asked to rewrite the body is handed
 * (ADR-0100's reconciler).
 *
 * `specBody` puts the trailer back on every write, so a model shown one would produce a body
 * carrying either two of them or none, depending on how it read a machine comment nobody told it
 * about. Stripping it here and re-appending it there means the round trip is exact and the model
 * never has to be trusted with it at all.
 *
 * A trailer `readSourceMarker` cannot parse is left in place rather than cut out: it is the only
 * record of that spec's provenance, and nothing here can re-append what it could not read.
 */
export function withoutSourceMarker(body: string): string {
  if (readSourceMarker(body) === undefined) return body;

  const at = locateSourceMarker(body);
  if (at === undefined) return body;

  // `trim`, not `trimEnd`: the marker leads the body now, so cutting it out leaves the blank line
  // that separated it at the front rather than at the back.
  return `${body.slice(0, at.open)}${body.slice(at.close + SOURCE_CLOSE.length)}`.trim();
}

/**
 * `PRD: ` prefixed exactly once. The author is told to write a `PRD:` title and mostly does, so
 * prefixing unconditionally would produce `PRD: PRD: …` on the runs where it obeyed. The tracker's
 * own convention is the prefix (`ratify-on-prd-close.yml`, `/drain`), so a run where the model
 * forgot must not publish a spec that reads as an ordinary issue.
 */
export function specTitle(title: string): string {
  const trimmed = title.trim();
  return /^PRD:/i.test(trimmed) ? trimmed : `PRD: ${trimmed}`;
}

/**
 * The spec body as it lands: the author's own body, with the source marker on the line above it.
 *
 * **Above, not below, and that is load-bearing.** `## Acceptance criteria` is the last section a
 * spec body carries, by contract, and `ticket_shape.py`'s `criteria_blocks` folds every non-blank
 * line after a `- [ ]` item into that criterion as a wrapped continuation of it — a blank line does
 * not stop the fold. A marker appended below therefore became part of the one criterion, which made
 * its `check:` marker unparseable: `validate("spec", …)` refuses the body, and `bin/close-ticket
 * --spec` recovers no command to close the spec on. Every spec lane 02 published carried that, and
 * `publishSpec`'s validator call is what surfaced it.
 *
 * `readSourceMarker` and `withoutSourceMarker` both locate the marker by search rather than by
 * position, so a spec published under the old layout still reads and still round-trips.
 */
export function specBody(body: string, source: SpecSource | undefined): string {
  return source === undefined ? body : `${sourceMarker(source)}\n\n${body}`;
}

/**
 * Files the drafted spec as a new `prd`-labelled issue and answers its number.
 *
 * One `gh issue create`, and the label rides on that same call rather than a follow-up `issue edit`
 * — a spec that exists for a moment without `prd` is a spec `/drain` and `ratify-on-prd-close.yml`
 * would both read as an ordinary issue, and this lane has no way to notice it lost the race.
 *
 * **The body is validated before the create, never after.** `~/bin/file-issue spec` — the session
 * door — has always called `ticket_shape.validate("spec", …)` before invoking `gh`; this lane
 * called nothing, so the same contract bound one door and not the other. A refusal throws and
 * fails the run, which is the only useful moment: a malformed spec already on the tracker is one
 * `bin/close-ticket --spec` can never close. Warnings are printed and the publish proceeds, the
 * way `file-issue` treats them.
 *
 * `validate` is a parameter so a test can hand it a stub — the real one spawns an interpreter and
 * runs the criterion's own check command. `validate-spec.proc.test.ts` drives the default.
 */
export function publishSpec(
  gh: GhExec,
  draft: SpecAuthorOutput,
  source: SpecSource | undefined,
  validate: SpecBodyValidator = validateSpecBody,
): number {
  const title = specTitle(draft.title);
  const body = specBody(draft.body, source);
  warnAbout(validate(body));
  const created = gh(["issue", "create", "--title", title, "--body", body, "--label", PRD_LABEL]);
  return parseIssueNumber(created, title);
}

/**
 * Prints the validator's warnings to the run log and returns.
 *
 * A warning is a shape the validator will not refuse over — `file-issue` prints them to stderr and
 * files anyway, and a lane that swallowed them instead would make the same body noisier by hand and
 * quieter by robot.
 */
function warnAbout(warnings: string[]): void {
  for (const warning of warnings) console.error(`spec body warning: ${warning}`);
}

/**
 * Rewrites an already-published spec in place — `spec.ts`'s critic-only door, once the critic has
 * resolved something and the reconciler has folded it into the body (ADR-0100).
 *
 * It edits rather than filing a second issue on purpose: the spec's number is what `sliceable`,
 * the dispatch and every one of the owner's own comments already hang off, and a second issue
 * would strand all of them. The source trailer is re-appended from what the caller read off the
 * existing body, so the rewrite never loses the spec's provenance.
 *
 * Takes a title and a body rather than the author's whole output, because the writer on this path
 * has no author behind it: ADR-0100's reconciler returns a body alone and carries the spec's own
 * title through unchanged, and `openQuestions` are not something this write records.
 */
export function updateSpec(gh: GhExec, issueNumber: number, draft: PublishedSpec, source: SpecSource | undefined): void {
  gh([
    "issue",
    "edit",
    String(issueNumber),
    "--title",
    specTitle(draft.title),
    "--body",
    specBody(draft.body, source),
  ]);
}

/**
 * A spec's title and body — the two fields read back off the tracker for the critic, and the two
 * `updateSpec` puts back.
 */
export interface PublishedSpec {
  title: string;
  body: string;
}

/**
 * Reads an already-published spec back off the tracker.
 *
 * The critic-only door (ADR-0085) is handed nothing but an issue number: the spec was written in a
 * live session and filed by `bin/file-issue`, so no collector ever assembled it and no author ever
 * held it in memory. The issue itself is the draft, and this is how the run gets it.
 *
 * `--json title,body` rather than two `--jq` reads: one round trip, and the shapes stay together.
 */
export function readPublishedSpec(gh: GhExec, issueNumber: number): PublishedSpec {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "title,body"]);
  const parsed = JSON.parse(raw) as { title?: string; body?: string };
  return { title: parsed.title ?? "", body: parsed.body ?? "" };
}
