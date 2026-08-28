import type { GhExec } from "../shared/gh";

/**
 * [ADR-0042](../../../docs/adr/0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md):
 * an implementer that needs to read outside its brief reads what it needs
 * and carries on — it never blocks and never files a `seam/question`. It
 * records that it went outside its brief and which module it read, and
 * *that record is a count, and the count is the finding.*
 *
 * This module is the recording half. There is no threshold and no action —
 * unlike `watchdog/bypass-counter.ts` and `review/counter.ts`, this counts
 * without ever proposing anything, because ADR-0065 left it out of
 * `DESIGN.md` §6's counter table on purpose: *"the finding is about lane 03,
 * not lane 05"* — a rising count says the seam manifest is systematically
 * wrong, and the reader who acts on that is the owner via the brief, not a
 * mechanism this repo runs. So the count only has to be durable and
 * per-module; it does not have to know when it is "enough".
 *
 * **One standing tracker issue, never edited.** The marked-count-issue shape
 * `bypass-counter.ts` and `review/counter.ts` both use — a hidden
 * HTML-comment marker recording a count, parsed back out on the next sweep —
 * is reused here, but `intake.test.ts`'s repo-wide rule holds for this
 * issue exactly as it does for every other: nothing here rewrites a body
 * that already exists. The tracker's body is written once, at
 * `gh issue create`, and every increment after that lands as a *comment* —
 * a new object beside the last one, the same "comment, never edit" shape
 * `run-watchdog.ts` already uses for its own standing signals. A module's
 * current count is therefore the highest marker for it across the issue's
 * body and every comment, not a single place this module rewrites.
 */

/** The standing tracker issue's title. Stable so a reader recognises it as the same issue every time. */
export const TRACKER_TITLE = "Out-of-brief reads by module (ADR-0042)";

/** Identifies the tracker issue itself, first line of its body — distinct from any per-module marker. */
const TRACKER_MARKER = "<!-- out-of-brief-tracker -->";

const MODULE_MARKER_RE = /<!-- out-of-brief:(.+?):(\d+) -->/g;

/** Escapes a module string for embedding inside a `RegExp`. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The hidden marker recording one module's count, embedded on that module's own line. */
function moduleMarker(module: string, count: number): string {
  return `<!-- out-of-brief:${module}:${count} -->`;
}

/** The count a single module's marker records inside `text` (an issue body or one comment's body), or `undefined` if it carries none. */
export function markedCount(text: string, module: string): number | undefined {
  const match = text.match(new RegExp(`<!-- out-of-brief:${escapeForRegExp(module)}:(\\d+) -->`));
  return match ? Number(match[1]) : undefined;
}

/** Every module marker `text` carries, as a `module -> count` map. */
function parseModuleCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(MODULE_MARKER_RE)) {
    counts.set(match[1], Number(match[2]));
  }
  return counts;
}

/** One human-readable line for `module`, carrying its own marker so a later read can parse it back. */
function moduleLine(module: string, count: number): string {
  return `- \`${module}\`: **${count}** out-of-brief read${count === 1 ? "" : "s"} ${moduleMarker(module, count)}`;
}

/** The tracker issue's body at creation — a fixed preamble plus the very first module read. */
function initialBody(module: string): string {
  return [
    TRACKER_MARKER,
    "",
    "Modules an implementer read outside its brief — [ADR-0042](../../../docs/adr/0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md)'s",
    "non-blocking count, never a block. A rising count on one module is evidence the seam manifest is",
    "systematically wrong for it, not that any one implementer coupled badly. Each further read lands",
    "as a comment on this issue rather than an edit to this body.",
    "",
    moduleLine(module, 1),
  ].join("\n");
}

interface TrackerIssue {
  number: number;
  body: string | null;
  state: string;
}

/** The standing tracker issue, if one has ever been created — the open one, found by its marker. */
function findTracker(gh: GhExec): TrackerIssue | undefined {
  const raw = gh(["issue", "list", "--state", "all", "--limit", "200", "--json", "number,body,state"]);
  const issues = JSON.parse(raw) as TrackerIssue[];
  return issues.find((issue) => issue.state.toUpperCase() === "OPEN" && (issue.body ?? "").includes(TRACKER_MARKER));
}

/**
 * Every module's current count on `tracker`: the highest marker for each
 * module across its body and every comment, since a count only ever grows
 * and each write only ever names the one module it just incremented.
 */
function readTrackerCounts(gh: GhExec, tracker: TrackerIssue): Map<string, number> {
  const counts = parseModuleCounts(tracker.body ?? "");
  const raw = gh(["issue", "view", String(tracker.number), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments: Array<{ body: string }> };
  for (const comment of parsed.comments) {
    for (const [module, count] of parseModuleCounts(comment.body)) {
      if (count > (counts.get(module) ?? 0)) counts.set(module, count);
    }
  }
  return counts;
}

/**
 * Records one out-of-brief read of `module` — ADR-0042's non-blocking count.
 * Increments that module's durable count on the standing tracker issue
 * (creating the tracker on its first-ever call, and only ever commenting on
 * it after that — see this file's own header for why an edit is never an
 * option) and returns the count after this read. Never touches a
 * `dependencies/blocked_by` edge or any other part of the dependency graph —
 * [ADR-0069](../../../docs/adr/0069-the-dependency-graph-is-lane-03-s-output-and-read-only-downs.md)
 * reserves that to lane 03 alone, and this function's only writes are the
 * tracker issue's own create/comment.
 */
export function recordOutOfBrief(gh: GhExec, module: string): number {
  const tracker = findTracker(gh);
  if (!tracker) {
    gh(["issue", "create", "--title", TRACKER_TITLE, "--body", initialBody(module)]);
    return 1;
  }

  const counts = readTrackerCounts(gh, tracker);
  const next = (counts.get(module) ?? 0) + 1;
  gh(["issue", "comment", String(tracker.number), "--body", moduleLine(module, next)]);
  return next;
}
