import type { GhExec } from "../shared/gh";
import type { Plan } from "../shared/plan-schema";
import { dispatchTicketReady, readySlices, type SliceState } from "../shared/ready-set";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { validatePlan } from "../shared/validate-graph";

/**
 * Sends one `ticket-ready` dispatch per slice this publish leaves ready — the send `implement.yml`
 * fires on, and #167's own words for when: "for every slice with zero unresolved blocked-by edges".
 *
 * Nothing sent it until #145's seam audit. #167 built and tested the receiving end and recorded in
 * `implement.ts` that wiring the send "belongs to whichever ticket owns
 * `to-tickets/slice-and-publish.ts`" — and no slice in the PRD ever claimed that file, so lane 03
 * published 26 tickets that lane 05 could never be told about.
 *
 * **This asks `readySlices`; it does not answer readiness itself** (#179). It used to filter on
 * `dependsOn.length === 0` and explain that at publish time every edge is unresolved by
 * construction, so no tracker read was needed to make the test. That was true, and it was a
 * constant folded into a predicate — the real question is *every blocker delivered*, which merely
 * equals "zero declared edges" at t=0. Folded, it could only be answered once, and nothing sent the
 * second wave. Unfolded, this is one caller of the predicate rather than a second implementation of
 * it, and `dispatch/reconcile.ts` is the other.
 *
 * The state it hands over is the state a publish is in by construction: every issue open, nothing
 * merged, nothing started. So the answer here is unchanged — the slices with no declared edges —
 * and it is now the same answer, from the same function, that the reconciler will give tomorrow.
 *
 * Runs after `verifyBlockedByGraph`, so no implementer is ever dispatched against a graph that
 * failed its read-back. A dispatch that throws stops the rest: a partially dispatched wave is
 * visible (the issues exist, some runs started) where a swallowed error would leave a slice
 * looking published-and-started when nothing was ever told to build it.
 */
export function dispatchReadySlices(plan: Plan, published: PublishedIssue[], gh: GhExec): PublishedIssue[] {
  const states: SliceState[] = published.map((issue, index) => ({
    number: issue.number,
    blockedBy: plan[index].dependsOn.map((dep) => published[dep - 1].number),
    delivery: "open",
    started: false,
  }));

  const readyNumbers = new Set(readySlices(states).map((state) => state.number));
  const ready = published.filter((issue) => readyNumbers.has(issue.number));
  for (const issue of ready) {
    dispatchTicketReady(gh, issue.number);
  }
  return ready;
}

/**
 * The one seam the deterministic half of this pipeline is tested through. A
 * plan goes in; published, attached, edged, and verified sub-issues come out.
 * Validate → render → create → attach → wire blocked-by → verify read-back,
 * in that order — validation happens before any write, so a malformed graph
 * costs zero `gh` calls to reject, and edges are only wired once every issue
 * in the plan exists to be pointed at.
 *
 * **It takes a plan, not a transcript.** It used to be handed the auditor's
 * whole raw response and re-run the `<output>` extraction over it — the
 * second parse of the same text, in a second place that could reject it.
 * The stage now hands over a `Plan` that the API and zod have both already
 * accepted, so what is left here is graph shape, which is this module's own
 * question rather than a re-check of somebody else's.
 *
 * Read-back verification runs last and throws on the first missing edge it
 * finds, so a publish that looks complete but wired incompletely fails
 * loudly instead of silently — and only then does `dispatchReadySlices`
 * start lane 05 on the slices that have nothing to wait for.
 */
export function sliceAndPublish(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  validatePlan(plan);
  const published = publishSubIssues(plan, prdNumber, gh);
  wireBlockedByEdges(plan, published, gh);
  verifyBlockedByGraph(plan, published, gh);
  dispatchReadySlices(plan, published, gh);
  return published;
}
