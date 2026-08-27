import type { GhExec } from "../shared/gh";
import type { Plan } from "../shared/plan-schema";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { validatePlan } from "../shared/validate-graph";

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
 * loudly instead of silently.
 */
export function sliceAndPublish(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  validatePlan(plan);
  const published = publishSubIssues(plan, prdNumber, gh);
  wireBlockedByEdges(plan, published, gh);
  verifyBlockedByGraph(plan, published, gh);
  return published;
}
