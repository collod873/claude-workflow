import type { GhExec } from "../shared/gh";
import type { Plan } from "../shared/plan-schema";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { validateClaimsAreMutable, validateCriteriaShape, validatePathsAreRooted } from "../shared/render-body";
import { validatePlan } from "../shared/validate-graph";

export function validateSlicePlan(plan: Plan): void {
  validatePlan(plan);
  validateCriteriaShape(plan);
  validateClaimsAreMutable(plan);
  validatePathsAreRooted(plan);
}

export function sliceAndPublish(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  validateSlicePlan(plan);
  const published = publishSubIssues(plan, prdNumber, gh);
  wireBlockedByEdges(plan, published, gh);
  verifyBlockedByGraph(plan, published, gh);
  return published;
}
