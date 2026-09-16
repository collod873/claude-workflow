import type { GhExec } from "../shared/gh";
import type { Plan } from "../shared/plan-schema";
import {
  publishSubIssues,
  verifyBlockedByGraph,
  wireBlockedByEdges,
  type PublishedIssue,
} from "../shared/publish-sub-issues";
import { reason } from "../shared/reason";
import { trackerGh } from "../shared/tracker-gh";
import type { Tracker } from "../shared/tracker";
import {
  repairUnrootedClaims,
  validateClaimsAreMutable,
  validateCriteriaShape,
  validatePathsAreRooted,
} from "../shared/render-body";
import { validatePlan } from "../shared/validate-graph";

const PLAN_CHECKS: ReadonlyArray<(plan: Plan) => void> = [
  validatePlan,
  validateCriteriaShape,
  validateClaimsAreMutable,
  validatePathsAreRooted,
];

function refusalsOf(work: () => void): string[] {
  try {
    work();
    return [];
  } catch (err) {
    return [reason(err)];
  }
}

function throwingEvery(refusals: string[]): void {
  if (refusals.length > 0) {
    throw new Error(refusals.join("\n"));
  }
}

export function validateSlicePlan(plan: Plan): void {
  throwingEvery(PLAN_CHECKS.flatMap((check) => refusalsOf(() => check(plan))));
}

type RootedPlan = ReturnType<typeof repairUnrootedClaims>;

export function checkSlicePlan(plan: Plan): RootedPlan {
  let rooted: RootedPlan = { plan, repairs: [] };
  const refusals = refusalsOf(() => {
    rooted = repairUnrootedClaims(plan);
  });
  throwingEvery([...refusals, ...PLAN_CHECKS.flatMap((check) => refusalsOf(() => check(rooted.plan)))]);
  return rooted;
}

function trackerFrom(gh: GhExec | Tracker): Tracker {
  return typeof gh === "function" ? trackerGh(gh) : gh;
}

export function sliceAndPublish(plan: Plan, prdNumber: number, gh: GhExec | Tracker): PublishedIssue[] {
  const { plan: rooted, repairs } = checkSlicePlan(plan);
  for (const repair of repairs) {
    console.log(`slice ${repair.slice}: rooted ${repair.from} as ${repair.to}`);
  }
  const tracker = trackerFrom(gh);
  const published = publishSubIssues(rooted, prdNumber, tracker);
  wireBlockedByEdges(rooted, published, tracker);
  verifyBlockedByGraph(rooted, published, tracker);
  return published;
}
