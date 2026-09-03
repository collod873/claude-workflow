import type { GhExec } from "../shared/gh";

export const TRACKER_TITLE = "Out-of-brief reads by module (ADR-0042)";

const TRACKER_MARKER = "<!-- out-of-brief-tracker -->";

const MODULE_MARKER_RE = /<!-- out-of-brief:(.+?):(\d+) -->/g;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function moduleMarker(module: string, count: number): string {
  return `<!-- out-of-brief:${module}:${count} -->`;
}

export function markedCount(text: string, module: string): number | undefined {
  const match = text.match(new RegExp(`<!-- out-of-brief:${escapeForRegExp(module)}:(\\d+) -->`));
  return match ? Number(match[1]) : undefined;
}

function parseModuleCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(MODULE_MARKER_RE)) {
    counts.set(match[1], Number(match[2]));
  }
  return counts;
}

function moduleLine(module: string, count: number): string {
  return `- \`${module}\`: **${count}** out-of-brief read${count === 1 ? "" : "s"} ${moduleMarker(module, count)}`;
}

function initialBody(module: string): string {
  return [
    TRACKER_MARKER,
    "",
    "Modules an implementer read outside its brief: [ADR-0042](../../../docs/adr/0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md)'s",
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

function findTracker(gh: GhExec): TrackerIssue | undefined {
  const raw = gh(["issue", "list", "--state", "all", "--limit", "200", "--json", "number,body,state"]);
  const issues = JSON.parse(raw) as TrackerIssue[];
  return issues.find((issue) => issue.state.toUpperCase() === "OPEN" && (issue.body ?? "").includes(TRACKER_MARKER));
}

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
