import { requestDispatch } from "./dispatch-request";
import type { GhExec } from "./gh";

export const RATIFICATION_DUE_DISPATCH_ACTION = "ratification-due";

export const RATIFIER_MERGED_DISPATCH_ACTION = "ratifier-merged";

export const RATIFIER_PR_TITLE = "Ratified: standards from this batch";

export interface RatificationDueDispatch {
  head: string;
  prdClosed: boolean;
  prd?: number;
}

export function prdClosedField(dispatch: RatificationDueDispatch): string {
  if (dispatch.prd !== undefined) return String(dispatch.prd);
  return String(dispatch.prdClosed);
}

export function readPrdClosedField(field: string | undefined): { prdClosed: boolean; prd?: number } {
  const value = (field ?? "").trim();
  if (/^\d+$/.test(value)) return { prdClosed: true, prd: Number(value) };
  return { prdClosed: value === "true" };
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
    `client_payload[prd_closed]=${prdClosedField(dispatch)}`,
  ]);
}

export function dispatchRatifierMerged(gh: GhExec, pr: string): void {
  requestDispatch(gh, {
    event_type: RATIFIER_MERGED_DISPATCH_ACTION,
    client_payload: { pr },
  });
}
