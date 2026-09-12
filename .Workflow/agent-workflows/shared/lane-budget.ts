export const LANE_BUDGETS = {
  acceptance: 24,
  fixer: 32,
  implement: 80,
  mechanic: 80,
  ratify: 100,
  review: 11,
  shape: 24,
  spec: 24,
  "to-tickets": 80,
} as const;

export type BudgetedLane = keyof typeof LANE_BUDGETS;

export const BUDGETED_LANES = Object.keys(LANE_BUDGETS) as BudgetedLane[];

export function laneBudget(lane: BudgetedLane): number {
  return LANE_BUDGETS[lane];
}
