import type { GhExec } from "../shared/gh";
import { parseIssueNumber } from "../shared/issue-url";
import { FINDING_LABEL } from "./counter";
import type { Finding } from "./structural-refusal";

const TITLE_MAX = 80;

function titleFor(finding: Finding): string {
  const firstLine = finding.message.split("\n")[0]?.trim() ?? "";
  const truncated = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
  return `lane-07 finding: ${truncated}`;
}

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

export function publishFindings(gh: GhExec, findings: Finding[], assignee: string): number[] {
  return findings.map((finding) => publishFinding(gh, finding, assignee));
}
