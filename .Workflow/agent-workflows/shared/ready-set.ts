import { requestDispatch } from "./dispatch-request";
import type { GhExec } from "./gh";

export type Delivery =
  | "open"
  | "delivered"
  | "undelivered";

export interface SliceState {
  number: number;
  blockedBy: number[];
  delivery: Delivery;
  started: boolean;
}

export function implementationBranch(issueNumber: number): string {
  return `implement/issue-${issueNumber}`;
}

export const IMPLEMENTATION_BRANCH_PREFIX = "implement/";

const IMPLEMENTATION_BRANCH_RE = (() => {
  const [prefix, suffix] = implementationBranch(0).split("0");
  return new RegExp(`^${prefix}(\\d+)${suffix}$`);
})();

export function implementationBranchTicket(branch: string): number | undefined {
  const match = IMPLEMENTATION_BRANCH_RE.exec(branch);
  return match ? Number(match[1]) : undefined;
}

export const TICKET_READY_DISPATCH_ACTION = "ticket-ready";

export const GRAPH_CHANGED_DISPATCH_ACTION = "graph-changed";

export const ACCEPTANCE_WANTED_DISPATCH_ACTION = "acceptance-wanted";

export function dispatchAcceptanceWanted(gh: GhExec, issueNumber: number, ready: boolean): void {
  requestDispatch(gh, {
    event_type: ACCEPTANCE_WANTED_DISPATCH_ACTION,
    client_payload: { issue: issueNumber, ready: ready ? 1 : 0 },
  });
}

export function dispatchTicketReady(gh: GhExec, issueNumber: number): void {
  requestDispatch(gh, {
    event_type: TICKET_READY_DISPATCH_ACTION,
    client_payload: { issue: issueNumber },
  });
}

export function announceGraphChanged(gh: GhExec, pr: string): void {
  requestDispatch(gh, {
    event_type: GRAPH_CHANGED_DISPATCH_ACTION,
    client_payload: { pr },
  });
}

function index(slices: SliceState[]): Map<number, SliceState> {
  return new Map(slices.map((slice) => [slice.number, slice]));
}

function willNeverDeliver(
  number: number,
  byNumber: Map<number, SliceState>,
  memo: Map<number, boolean>,
  visiting: Set<number>,
): boolean {
  const cached = memo.get(number);
  if (cached !== undefined) return cached;

  const slice = byNumber.get(number);
  if (slice === undefined) return false;
  if (slice.delivery === "undelivered") return true;
  if (slice.delivery === "delivered") return false;
  if (visiting.has(number)) return true;

  visiting.add(number);
  const answer = slice.blockedBy.some((blocker) => willNeverDeliver(blocker, byNumber, memo, visiting));
  visiting.delete(number);
  memo.set(number, answer);
  return answer;
}

export function readySlices(slices: SliceState[]): SliceState[] {
  const byNumber = index(slices);
  return slices.filter(
    (slice) =>
      slice.delivery === "open" &&
      !slice.started &&
      slice.blockedBy.every((blocker) => byNumber.get(blocker)?.delivery === "delivered"),
  );
}

export function unreachableSlices(slices: SliceState[]): SliceState[] {
  const byNumber = index(slices);
  const memo = new Map<number, boolean>();
  return slices.filter(
    (slice) =>
      slice.delivery === "open" &&
      slice.blockedBy.some((blocker) => willNeverDeliver(blocker, byNumber, memo, new Set())),
  );
}
