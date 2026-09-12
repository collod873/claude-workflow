import type { GhExec } from "./gh";
import { reason } from "./reason";

export const RUNNING_LABEL = "running";

export function markRunning(gh: GhExec, issueNumber: number, log: (line: string) => void): void {
  try {
    gh(["issue", "edit", String(issueNumber), "--add-label", RUNNING_LABEL]);
  } catch (err) {
    log(`could not mark #${issueNumber} as ${RUNNING_LABEL}: ${reason(err)}`);
  }
}
