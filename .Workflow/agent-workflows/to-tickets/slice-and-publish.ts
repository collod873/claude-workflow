import type { GhExec } from "../shared/gh";
import { extractOutput } from "../shared/output-block";
import { Plan } from "../shared/plan-schema";
import { publishSubIssues, type PublishedIssue } from "../shared/publish-sub-issues";
import { validatePlan } from "../shared/validate-graph";

/**
 * The one seam the deterministic half of this pipeline is tested through. A
 * string of raw agent output goes in; published, attached sub-issues come
 * out. Extract → parse → validate → render → create → attach, in that
 * order — validation happens before any write, so a malformed graph costs
 * zero `gh` calls to reject.
 *
 * Wiring the blocked-by edges this plan declares, and verifying the
 * published graph on read-back, is the next ticket's own extension through
 * this same entry point.
 */
export function sliceAndPublish(
  rawAgentOutput: string,
  prdNumber: number,
  gh: GhExec,
): PublishedIssue[] {
  const plan = extractOutput(rawAgentOutput, Plan);
  validatePlan(plan);
  return publishSubIssues(plan, prdNumber, gh);
}
