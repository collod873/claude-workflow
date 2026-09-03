import { requestDispatch } from "../shared/dispatch-request";
import type { GhExec } from "../shared/gh";
import type { Plan } from "../shared/plan-schema";
import { dispatchAcceptanceWanted, readySlices, type SliceState } from "../shared/ready-set";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { validateClaimsAreMutable, validateCriteriaShape, validatePathsAreRooted } from "../shared/render-body";
import { validatePlan } from "../shared/validate-graph";

export function dispatchReadySlices(plan: Plan, published: PublishedIssue[], gh: GhExec): PublishedIssue[] {
  const states: SliceState[] = published.map((issue, index) => ({
    number: issue.number,
    blockedBy: plan[index].dependsOn.map((dep) => published[dep - 1].number),
    delivery: "open",
    started: false,
  }));

  const readyNumbers = new Set(readySlices(states).map((state) => state.number));
  for (const issue of published) {
    dispatchAcceptanceWanted(gh, issue.number, readyNumbers.has(issue.number));
  }
  return published.filter((issue) => readyNumbers.has(issue.number));
}

export function sliceAndPublish(plan: Plan, prdNumber: number, gh: GhExec): PublishedIssue[] {
  validatePlan(plan);
  validateCriteriaShape(plan);
  validateClaimsAreMutable(plan);
  validatePathsAreRooted(plan);
  const published = publishSubIssues(plan, prdNumber, gh);
  wireBlockedByEdges(plan, published, gh);
  verifyBlockedByGraph(plan, published, gh);
  dispatchReadySlices(plan, published, gh);
  return published;
}
