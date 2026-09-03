import { requestDispatch } from "./dispatch-request";
import type { GhExec } from "./gh";

export const SPEC_AUTHOR_DISPATCH_EVENT_TYPE = "sheet-accepted";

export function dispatchSpecAuthor(gh: GhExec, issueNumber: number): void {
  requestDispatch(gh, {
    event_type: SPEC_AUTHOR_DISPATCH_EVENT_TYPE,
    client_payload: { issue: issueNumber },
  });
}
