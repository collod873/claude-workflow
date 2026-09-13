import { requestDispatch } from "./dispatch-request";
import type { GhExec } from "./gh";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";

export const VERIFY_DISPATCH_EVENT_TYPE = IMPLEMENTATION_PR_DISPATCH_ACTION;

export function dispatchVerify(
  gh: GhExec,
  dispatch: { prUrl: string; changedFiles: string[]; criteria: string[] },
): void {
  requestDispatch(gh, {
    event_type: VERIFY_DISPATCH_EVENT_TYPE,
    client_payload: {
      pr: dispatch.prUrl,
      changed_files: dispatch.changedFiles.join(","),
      criteria: dispatch.criteria,
    },
  });
}
