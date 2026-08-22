import type { GhExec } from "../shared/gh";
import { extractOutput } from "../shared/output-block";
import { Plan } from "../shared/plan-schema";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { validatePlan } from "../shared/validate-graph";

/**
 * The one seam the deterministic half of this pipeline is tested through. A
 * string of raw agent output goes in; published, attached, edged, and
 * verified sub-issues come out. Extract → parse → validate → render →
 * create → attach → wire blocked-by → verify read-back, in that order —
 * validation happens before any write, so a malformed graph costs zero `gh`
 * calls to reject, and edges are only wired once every issue in the plan
 * exists to be pointed at.
 *
 * Read-back verification runs last and throws on the first missing edge it
 * finds, so a publish that looks complete but wired incompletely fails
 * loudly instead of silently.
 */
export function sliceAndPublish(
  rawAgentOutput: string,
  prdNumber: number,
  gh: GhExec,
): PublishedIssue[] {
  const plan = extractOutput(rawAgentOutput, Plan);
  validatePlan(plan);
  const published = publishSubIssues(plan, prdNumber, gh);
  wireBlockedByEdges(plan, published, gh);
  verifyBlockedByGraph(plan, published, gh);
  return published;
}
