import type { GhExec } from "../shared/gh";
import { parseIssueNumber } from "../shared/issue-url";
import { FINDING_LABEL } from "./counter";
import type { Finding } from "./structural-refusal";

/**
 * Lane 07's only path from a surviving finding to the owner (PRD #145: "its survivors reach the
 * owner as issues, never a notification"). One `gh issue create` per finding, carrying
 * `FINDING_LABEL` so `counter.ts`'s own `readFindingIssues` sees it, and assigned so it notifies
 * rather than sits in a list — the same two flags `run-watchdog.ts` and `bypass-counter.ts` already
 * use for exactly this reason. Nothing here comments on a pull request, posts to a channel, or
 * writes anywhere else: the whole of this module's contact with GitHub is the one call below.
 */

const TITLE_MAX = 80;

/** `finding.message`'s first line, trimmed to `TITLE_MAX` — a title, not the finding's full text. */
function titleFor(finding: Finding): string {
  const firstLine = finding.message.split("\n")[0]?.trim() ?? "";
  const truncated = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
  return `lane-07 finding: ${truncated}`;
}

/**
 * Files one issue for `finding` — title, full message as the body, `FINDING_LABEL`, and
 * `assignee` — and returns its issue number.
 */
export function publishFinding(gh: GhExec, finding: Finding, assignee: string): number {
  const created = gh([
    "issue",
    "create",
    "--title",
    titleFor(finding),
    "--body",
    finding.message,
    "--label",
    FINDING_LABEL,
    "--assignee",
    assignee,
  ]);
  return parseIssueNumber(created, titleFor(finding));
}

/**
 * Files one issue per survivor, in order, and returns their issue numbers in the same order. The
 * only function this module exports that a caller holding a list of survivors needs — everything
 * else here is `publishFinding`'s own machinery.
 */
export function publishFindings(gh: GhExec, findings: Finding[], assignee: string): number[] {
  return findings.map((finding) => publishFinding(gh, finding, assignee));
}
