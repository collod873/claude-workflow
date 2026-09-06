import { requestDispatch } from "./dispatch-request";
import type { GhExec } from "./gh";

export const RATIFICATION_DUE_DISPATCH_ACTION = "ratification-due";

export const RATIFIER_MERGED_DISPATCH_ACTION = "ratifier-merged";

export const RATIFIER_PR_TITLE = "Ratified: standards from this batch";

export interface RatificationDueDispatch {
  head: string;
  prdClosed: boolean;
}

export function dispatchRatificationDue(gh: GhExec, dispatch: RatificationDueDispatch): void {
  gh([
    "api",
    "repos/{owner}/{repo}/dispatches",
    "-f",
    `event_type=${RATIFICATION_DUE_DISPATCH_ACTION}`,
    "-f",
    `client_payload[head]=${dispatch.head}`,
    "-f",
    `client_payload[prd_closed]=${dispatch.prdClosed}`,
  ]);
}

export function dispatchRatifierMerged(gh: GhExec, pr: string): void {
  requestDispatch(gh, {
    event_type: RATIFIER_MERGED_DISPATCH_ACTION,
    client_payload: { pr },
  });
}
