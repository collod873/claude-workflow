import type { Tracker } from "../shared/tracker";
import { FINDING_LABEL } from "./counter";
import type { Finding } from "./structural-refusal";

const TITLE_MAX = 80;

function titleFor(finding: Finding): string {
  const firstLine = finding.message.split("\n")[0]?.trim() ?? "";
  const truncated = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
  return `lane-07 finding: ${truncated}`;
}

export function publishFinding(tracker: Tracker, finding: Finding, assignee: string): number {
  return tracker.createIssue({
    title: titleFor(finding),
    body: finding.message,
    label: FINDING_LABEL,
    assignee,
  });
}

export function publishFindings(tracker: Tracker, findings: Finding[], assignee: string): number[] {
  return findings.map((finding) => publishFinding(tracker, finding, assignee));
}
