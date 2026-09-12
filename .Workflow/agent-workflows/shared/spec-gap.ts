import type { GhExec } from "./gh";
import { parseIssueNumber } from "./issue-url";
import { ensureLabel, SPEC_GAP_LABEL } from "./labels";

export { SPEC_GAP_LABEL };

export function fileSpecGap(gh: GhExec, prdIssueNumber: number, title: string, report: string): number {
  ensureLabel(gh, SPEC_GAP_LABEL);
  const body = [`Filed against #${prdIssueNumber} (ADR-0034).`, "", report].join("\n");
  const created = gh(["issue", "create", "--title", title, "--body", body, "--label", SPEC_GAP_LABEL]);
  return parseIssueNumber(created, title);
}
