import type { GhExec } from "../shared/gh";
import type { Plan } from "../shared/plan-schema";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import {
  repairUnrootedClaims,
  validateClaimsAreMutable,
  validateCriteriaShape,
  validatePathsAreRooted,
} from "../shared/render-body";
import { validatePlan } from "../shared/validate-graph";

export function validateSlicePlan(plan: Plan): void {
  validatePlan(plan);
  validateCriteriaShape(plan);
  validateClaimsAreMutable(plan);
  validatePathsAreRooted(plan);
}

export function sliceAndPublish(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  const { plan: rooted, repairs } = repairUnrootedClaims(plan);
  for (const repair of repairs) {
    console.log(`slice ${repair.slice}: rooted ${repair.from} as ${repair.to}`);
  }
  validateSlicePlan(rooted);
  const published = publishSubIssues(rooted, prdNumber, gh);
  wireBlockedByEdges(rooted, published, gh);
  verifyBlockedByGraph(rooted, published, gh);
  return published;
}
