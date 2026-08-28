import { requestDispatch } from "./dispatch-request";
import type { GhExec } from "./gh";

/**
 * **The ready set is recomputed, never pushed** (#179).
 *
 * `dispatchReadySlices` used to answer readiness with `dependsOn.length === 0`, and its own header
 * explained why that was enough: *"At publish time every edge is unresolved by construction."* That
 * is true, and it is a constant folded into a predicate. The real predicate is **every blocker
 * delivered**; it merely *equals* "zero declared edges" at t=0. Unfolding it is what lets the same
 * question be asked again later — which is the whole repair, because nothing was sending the second
 * wave: a 26-slice plan started however many roots it had and stopped.
 *
 * So this module holds the predicate, and both callers run it: `to-tickets/slice-and-publish.ts` at
 * publish time, and `dispatch/reconcile.ts` on every `graph-changed` and every `session-captured`.
 * One implementation, two callers — not two implementations that agree today.
 *
 * **Pure, and with no memory of arrival order.** A recomputed set cannot decrement a counter, cannot
 * miss an event and cannot double-count one. #178 listed partial unblocking as a thing that needed
 * deciding — a slice blocked by two siblings that merge in sequence firing once, and a slice with
 * one merged and one open blocker not firing at all. Neither is a case here: a slice with one open
 * blocker is simply not in the set, and a slice whose second blocker just merged simply is. The
 * failure #178 feared is only reachable by a design that handles events, and this one does not.
 *
 * **Scope is the caller's, not this module's.** Everything here is a question about a graph. Which
 * issues belong in that graph, and which members of the answer are allowed to start an implementer,
 * are decisions `dispatch/reconcile.ts` makes and states.
 */

/**
 * What one issue's own state says about the edges pointing at it.
 *
 * The rule, and the reason it is stated as delivery rather than as closure (#179): **an edge is
 * satisfied when its blocker closed having delivered.** The prior art in the sandcastle repo counts
 * *open* blockers and refuses to promote past a `not planned` close, which produces a timing
 * asymmetry with no defensible reading — a blocker closed `not planned` *before* fan-out does not
 * block at all, because it is not open, while the identical close landing *after* fan-out refuses to
 * unblock. Same fact, opposite behaviour, decided by when it happened. One predicate evaluated the
 * same way at publish time and at reconcile time removes that.
 */
export type Delivery =
  /** Still open. The edge is unsatisfied, and may yet be satisfied. */
  | "open"
  /** Closed as completed with a merged pull request. The only thing that satisfies an edge. */
  | "delivered"
  /**
   * Closed without delivering — `not planned`, or closed as completed with nothing merged. The edge
   * is unsatisfied and **nothing that happens later can satisfy it**, which is what makes the
   * dependents unreachable rather than late (see `unreachableSlices`).
   */
  | "undelivered";

/** One node of the graph this module reasons over, as its caller has already resolved it. */
export interface SliceState {
  number: number;
  /** The issue numbers blocking this one — GitHub's `dependencies/blocked_by`, lane 03's output. */
  blockedBy: number[];
  delivery: Delivery;
  /**
   * Whether an implementer has already claimed this slice, which is exactly *"does
   * `implementationBranch(number)` exist as a ref?"*. **The branch is the started-ness trace** — no
   * new label and no new state, so this term costs nothing to add and nothing to keep in sync.
   */
  started: boolean;
}

/**
 * The branch a ticket's implementation lands on, and the **claim** that makes a duplicate dispatch
 * free (#179).
 *
 * It lives here rather than in `implement/implement.ts` (which re-exports it) because it is a term
 * of the predicate above, and `shared/` may not import a lane. Two readers need one spelling: the
 * implementer that creates the ref as its first act, and the reconciler that reads the ref to know
 * the slice is already started.
 *
 * Deterministic per issue, and git ref creation is atomic, which is what lets dispatch be
 * **at-least-once** with no lock, no label-as-token and no time-of-check/time-of-use recheck. The
 * sandcastle prior art buys exactly-once delivery with a global non-cancelling concurrency group
 * over its whole promotion workflow plus a pre-mutation recheck plus a consumed label; none of that
 * is needed once a duplicate costs nothing, and a second global serialisation point would quietly
 * become the real throughput ceiling in place of the merge
 * ([ADR-0039](../../../docs/adr/0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)).
 */
export function implementationBranch(issueNumber: number): string {
  return `implement/issue-${issueNumber}`;
}

/** The `git/matching-refs` prefix that finds every implementer's claim in one call. */
export const IMPLEMENTATION_BRANCH_PREFIX = "implement/";

/**
 * The `repository_dispatch` action `implement.yml` gates on — **one wire name, one receiver, two
 * senders** now: `to-tickets/slice-and-publish.ts` at publish time and `dispatch/reconcile.ts` on
 * every recompute. It lives here rather than in the lane that receives it for the reason
 * `shared/immutable-set.ts` gives for `IMPLEMENTATION_PR_DISPATCH_ACTION`: more than one module must
 * read the same string, and `shared/` is the only place all of them can reach without a lane
 * importing a lane. `implement/implement.ts` re-exports it as `IMPLEMENT_DISPATCH_EVENT_TYPE`.
 */
export const TICKET_READY_DISPATCH_ACTION = "ticket-ready";

/**
 * The doorbell (#179). Lane 08 sends this after a successful merge: no payload beyond the pull
 * request, no tracker read, no graph read, no reasoning. **It says "something changed, go look" and
 * nothing else**, which is what keeps
 * [ADR-0069](../../../docs/adr/0069-the-dependency-graph-is-lane-03-s-output-and-read-only-downs.md)
 * *applied* rather than amended — a merge is entitled to announce itself without interpreting
 * itself, and the only reader of the graph is a reconciler that writes nothing to it.
 *
 * It is a **hint, not a mechanism**. `dispatch/reconcile.ts` also rides `session-captured`, and lose
 * this dispatch entirely and that reconcile still finds the same ready set — the cost is latency,
 * not correctness. That is why a second dispatch is permitted here where
 * [ADR-0049](../../../docs/adr/0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md)
 * refused one: its dispatch would have been load-bearing, and losing it meant the sweep never
 * happened at all.
 */
export const GRAPH_CHANGED_DISPATCH_ACTION = "graph-changed";

/**
 * Sends exactly one `ticket-ready` naming `issueNumber` — the send `implement.yml` fires on.
 *
 * Through `shared/dispatch-request.ts` because this has two callers on opposite sides of #181's
 * split: `dispatch/reconcile.ts` runs in a job that already holds `contents: write` and sends now,
 * and `to-tickets/slice-and-publish.ts` runs in one that spends a model and holds `contents: read`,
 * where the call 403s and the whole published wave is never told to start. Neither caller decides
 * which happens; the workflow it runs in does.
 */
export function dispatchTicketReady(gh: GhExec, issueNumber: number): void {
  requestDispatch(gh, {
    event_type: TICKET_READY_DISPATCH_ACTION,
    client_payload: { issue: issueNumber },
  });
}

/** Rings the doorbell, naming the pull request that just merged and nothing else. */
export function announceGraphChanged(gh: GhExec, pr: string): void {
  requestDispatch(gh, {
    event_type: GRAPH_CHANGED_DISPATCH_ACTION,
    client_payload: { pr },
  });
}

function index(slices: SliceState[]): Map<number, SliceState> {
  return new Map(slices.map((slice) => [slice.number, slice]));
}

/**
 * Whether `number` can still deliver, walked transitively.
 *
 * An issue the caller did not hand us is **not** proof of anything: it returns `false` here, so an
 * unseen blocker leaves its dependent blocked rather than reported unreachable. That is the quiet
 * direction, and the one to fail in — a finding filed about a graph this could not see is a finding
 * the reader cannot act on.
 *
 * A cycle can never deliver, so a node reached while it is still being visited answers `true`.
 * `validatePlan` refuses a cyclic plan before it is ever published, so this is a guard against a
 * live tracker that has one anyway, not a case the pipeline creates.
 */
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

/**
 * Every slice that could be started right now: **open, unstarted, and every blocker delivered.**
 *
 * At publish time nothing has merged and nothing is started, so this returns exactly the slices with
 * no declared edges — the same answer the folded constant gave, from the unfolded predicate.
 */
export function readySlices(slices: SliceState[]): SliceState[] {
  const byNumber = index(slices);
  return slices.filter(
    (slice) =>
      slice.delivery === "open" &&
      !slice.started &&
      slice.blockedBy.every((blocker) => byNumber.get(blocker)?.delivery === "delivered"),
  );
}

/**
 * Every open slice standing behind a blocker that closed without delivering, directly or
 * transitively — the second output of the same walk, from the other end.
 *
 * These slices are not *late*; they are **unreachable**, and that is knowable at the moment it
 * happens rather than inferable never. The sandcastle prior art leaves its dependents sitting in
 * `agent:queued` forever with no sweeper, which is precisely the shape
 * [ADR-0011](../../../docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md) forbids:
 * *"parked work is a queue that drains onto the owner."* `dispatch/reconcile.ts` reports what this
 * returns as one standing counter finding in
 * [ADR-0064](../../../docs/adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)'s
 * shape — one bounded touch, not *n* silently parked tickets.
 */
export function unreachableSlices(slices: SliceState[]): SliceState[] {
  const byNumber = index(slices);
  const memo = new Map<number, boolean>();
  return slices.filter(
    (slice) =>
      slice.delivery === "open" &&
      slice.blockedBy.some((blocker) => willNeverDeliver(blocker, byNumber, memo, new Set())),
  );
}
