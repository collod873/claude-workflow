import type { GhExec } from "./gh";
import { parseIssueNumber } from "./issue-url";

export const SPEC_GAP_LABEL = "spec/gap";

const SPEC_GAP_COLOR = "5319e7";
const SPEC_GAP_DESCRIPTION = "The spec is silent, ambiguous or self-contradictory here";

export function fileSpecGap(gh: GhExec, prdIssueNumber: number, title: string, report: string): number {
  gh(["label", "create", SPEC_GAP_LABEL, "--color", SPEC_GAP_COLOR, "--description", SPEC_GAP_DESCRIPTION, "--force"]);
  const body = [`Filed against #${prdIssueNumber} (ADR-0034).`, "", report].join("\n");
  const created = gh(["issue", "create", "--title", title, "--body", body, "--label", SPEC_GAP_LABEL]);
  return parseIssueNumber(created, title);
}
