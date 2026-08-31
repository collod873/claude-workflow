import type { GhExec } from "../shared/gh";

/**
 * The `github.event.action` the ratifier lane is woken by — one wire name,
 * two senders, one reader.
 *
 * The senders are the two work-volume events ADR-0017 ruled and #296 keeps
 * verbatim: the audit lane, once N released findings have accumulated
 * (`observations/run-audit.ts`), and a PRD closing as delivered
 * (`./prd-close.ts`). The reader is `.github/workflows/ratify.yml`, whose
 * `types:` filter names it (ADR-0090) and whose job-level `if` names it
 * again — spelled on both sides of a boundary no compiler sees across, the
 * same duplication `AUDIT_DISPATCH_ACTION` already accepts, and asserted by
 * `run-ratify.test.ts`.
 */
export const RATIFICATION_DUE_DISPATCH_ACTION = "ratification-due";

export interface RatificationDueDispatch {
  /** The commit the ratifier run scopes through — `GITHUB_SHA` at the sender. */
  head: string;
  /** True when a PRD closing as delivered is what fired this, which fires the trigger on its own. */
  prdClosed: boolean;
}

/**
 * Rings the ratifier lane's door.
 *
 * Sent explicitly rather than left to any event the sender's own run
 * produces: events caused by the built-in `GITHUB_TOKEN` start no workflow
 * runs (ADR-0054), so a lane that did not send this would ratify nothing and
 * look exactly like a lane with nothing to do.
 */
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
