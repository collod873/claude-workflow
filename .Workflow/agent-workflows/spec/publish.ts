import { z } from "zod";
import type { GhExec } from "../shared/gh";
import { parseIssueNumber } from "../shared/issue-url";
import type { SpecAuthorOutput } from "./spec";

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

/**
 * The `repository_dispatch` action that starts lane 02 from an accepted sheet — sent by
 * `shape/accept.ts` after it posts the accept comment, and gated on by `.github/workflows/spec.yml`.
 *
 * A dispatch and not the `approved` label, which is what ADR-0058's trigger table originally said:
 * the sheet collector reads the accept payload out of that comment and throws without it, so a
 * lane 02 firing on the same label would race the write it depends on ([ADR-0083](../../../docs/adr/0083-the-accept-dispatches-lane-02-rather-than-lane-02-firing-on.md)).
 *
 * Declared in lane 02 rather than in the lane that sends it because lane 02 is the one with a
 * receiver to keep it honest — `spec-workflow.test.ts` checks `spec.yml`'s `if:` against this
 * constant, the same one-declaration rule `IMPLEMENTATION_PR_DISPATCH_ACTION` holds to after two
 * copies of one wire name left the verification lane unreachable.
 */
export const SPEC_AUTHOR_DISPATCH_EVENT_TYPE = "sheet-accepted";

/**
 * Sends it, naming the accepted idea the sheet collector will read.
 *
 * `client_payload[issue]` matches what `applyGate` and `dispatchReadySlices` send, so every
 * issue-scoped dispatch in this pipeline carries its subject under one key.
 */
export function dispatchSpecAuthor(gh: GhExec, issueNumber: number): void {
  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${SPEC_AUTHOR_DISPATCH_EVENT_TYPE}`,
    "-f",
    `client_payload[issue]=${issueNumber}`,
  ]);
}

/**
 * Where a published spec came from, recorded on the spec itself.
 *
 * ADR-0062's re-run loop is "his answer re-runs the chain, which recomputes the count" — and the
 * chain starts at a collector, which needs the *source* the spec was drafted from, not the spec.
 * A comment-fired re-run arrives knowing only the spec's own issue number, so without this the
 * lane could re-run nothing: it would have to re-derive the decided context from the rendered spec,
 * which is precisely what `shape/marker.ts` exists to stop this estate doing.
 *
 * So the same trailer idiom `decision-sheet:v1` and `shape-accepted:v1` already use, for the same
 * reason and with the same escaping. `in-session` is absent by construction: the local caller's
 * decided context is a live conversation (ADR-0058), there is no issue to re-collect it from, and a
 * spec published from one is re-run by the owner in the session that made it.
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
  const open = body.lastIndexOf(SOURCE_OPEN);
  if (open === -1) return undefined;

  const close = body.indexOf(SOURCE_CLOSE, open + SOURCE_OPEN.length);
  if (close === -1) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(open + SOURCE_OPEN.length, close));
  } catch {
    return undefined;
  }

  const result = SpecSource.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/**
 * `PRD: ` prefixed exactly once. The author is told to write a `PRD:` title and mostly does, so
 * prefixing unconditionally would produce `PRD: PRD: …` on the runs where it obeyed. The tracker's
 * own convention is the prefix (`release-on-prd-close.yml`, `/triage`), so a run where the model
 * forgot must not publish a spec that reads as an ordinary issue.
 */
export function specTitle(title: string): string {
  const trimmed = title.trim();
  return /^PRD:/i.test(trimmed) ? trimmed : `PRD: ${trimmed}`;
}

/** The spec body as it lands: the author's own body, with the source trailer appended. */
export function specBody(body: string, source: SpecSource | undefined): string {
  return source === undefined ? body : `${body}\n\n${sourceMarker(source)}`;
}

/**
 * Files the drafted spec as a new `prd`-labelled issue and answers its number.
 *
 * One `gh issue create`, and the label rides on that same call rather than a follow-up `issue edit`
 * — a spec that exists for a moment without `prd` is a spec `/triage` and `release-on-prd-close.yml`
 * would both read as an ordinary issue, and this lane has no way to notice it lost the race.
 */
export function publishSpec(gh: GhExec, draft: SpecAuthorOutput, source: SpecSource | undefined): number {
  const title = specTitle(draft.title);
  const created = gh([
    "issue",
    "create",
    "--title",
    title,
    "--body",
    specBody(draft.body, source),
    "--label",
    PRD_LABEL,
  ]);
  return parseIssueNumber(created, title);
}

/**
 * Rewrites an already-published spec in place — the re-run half of ADR-0062's loop, where the
 * owner's answers have been folded in and the body must reflect them.
 *
 * It edits rather than filing a second issue on purpose: the spec's number is what `sliceable`,
 * the dispatch, the rounds count and every one of the owner's own comments already hang off, and a
 * second issue would strand all of them. The source trailer is re-appended from what the caller
 * read off the existing body, so a re-run never loses the spec's provenance.
 */
export function updateSpec(gh: GhExec, issueNumber: number, draft: SpecAuthorOutput, source: SpecSource | undefined): void {
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

/** The spec issue's current body — what a re-run reads its source trailer back out of. */
export function readSpecBody(gh: GhExec, issueNumber: number): string {
  return gh(["issue", "view", String(issueNumber), "--json", "body", "--jq", ".body"]);
}
