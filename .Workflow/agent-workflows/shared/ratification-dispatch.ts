import type { GhExec } from "./gh";

export const RATIFICATION_DUE_DISPATCH_ACTION = "ratification-due";

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
