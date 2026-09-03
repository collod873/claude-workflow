import type { GhExec } from "./gh.ts";

export const NEEDS_HUMAN_LABEL = "needs-human";
const NEEDS_HUMAN_COLOR = "d93f0b";
const NEEDS_HUMAN_DESCRIPTION = "Ticket stalled; a human decision or action is required";

export function escalateToOwner(gh: GhExec, issueNumber: number, assignee: string | undefined): void {
  gh(["label", "create", NEEDS_HUMAN_LABEL, "--color", NEEDS_HUMAN_COLOR, "--description", NEEDS_HUMAN_DESCRIPTION, "--force"]);
  gh(["issue", "edit", String(issueNumber), "--add-label", NEEDS_HUMAN_LABEL]);
  if (assignee) gh(["issue", "edit", String(issueNumber), "--add-assignee", assignee]);
}
