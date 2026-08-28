import type { GhExec } from "../shared/gh";
import { IMPLEMENT_DISPATCH_EVENT_TYPE } from "../implement/implement";
import type { Plan } from "../shared/plan-schema";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { validatePlan } from "../shared/validate-graph";

/**
 * Sends one `ticket-ready` dispatch per slice this publish left with **zero** blocked-by edges —
 * the send `implement.yml` fires on, and #167's own words for when: "for every slice with zero
 * unresolved blocked-by edges".
 *
 * Nothing sent it until #145's seam audit. #167 built and tested the receiving end and recorded in
 * `implement.ts` that wiring the send "belongs to whichever ticket owns
 * `to-tickets/slice-and-publish.ts`" — and no slice in the PRD ever claimed that file, so lane 03
 * published 26 tickets that lane 05 could never be told about.
 *
 * At publish time every edge is unresolved by construction: nothing in a plan has merged yet, so
 * `dependsOn.length === 0` is the whole readiness test and no tracker read is needed to make it.
 *
 * Runs after `verifyBlockedByGraph`, so no implementer is ever dispatched against a graph that
 * failed its read-back. A dispatch that throws stops the rest: a partially dispatched wave is
 * visible (the issues exist, some runs started) where a swallowed error would leave a slice
 * looking published-and-started when nothing was ever told to build it.
 */
export function dispatchReadySlices(plan: Plan, published: PublishedIssue[], gh: GhExec): PublishedIssue[] {
  const ready = published.filter((_, index) => plan[index].dependsOn.length === 0);
  for (const issue of ready) {
    gh([
      "api",
      "repos/{owner}/{repo}/dispatches",
      "-f",
      `event_type=${IMPLEMENT_DISPATCH_EVENT_TYPE}`,
      "-f",
      `client_payload[issue]=${issue.number}`,
    ]);
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
