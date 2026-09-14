import type { GhExec } from "./gh.ts";
import { ensureLabel, laneRemovals, NEEDS_HUMAN_LABEL } from "./labels.ts";

export { NEEDS_HUMAN_LABEL };

export function escalateToOwner(
  gh: GhExec,
  issueNumber: number,
  assignee: string | undefined,
  wearing?: readonly string[],
): void {
  const clearing = laneRemovals(gh, issueNumber, wearing);
  ensureLabel(gh, NEEDS_HUMAN_LABEL);
  gh(["issue", "edit", String(issueNumber), ...clearing, "--add-label", NEEDS_HUMAN_LABEL]);
  if (assignee) gh(["issue", "edit", String(issueNumber), "--add-assignee", assignee]);
}
