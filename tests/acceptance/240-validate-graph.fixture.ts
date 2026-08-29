import type { Slice } from "../../.Workflow/agent-workflows/shared/plan-schema";
import { validatePlan } from "../../.Workflow/agent-workflows/shared/validate-graph";

/**
 * The readers #240's two authored tests share.
 *
 * Not a `.test.ts`, so vitest's `tests/acceptance/**\/*.test.ts` include never collects it as a
 * suite — it is only ever imported by one. Both of #240's criteria build plans out of slices and
 * both need to ask what `validatePlan` refused, so those two readers live here once rather than
 * once per file: the same reader written twice is the divergence the clone checker reports.
 */

/**
 * The no-root refusal `validate-graph.ts` raises today, verbatim.
 *
 * #240 replaces the *at least one root* predicate with *exactly one*, and the ticket is explicit
 * that this message survives that replacement unchanged — a plan with no root and a plan with two
 * are different defects and must not collapse into one sentence.
 */
export const NO_ROOT_MESSAGE =
  "plan has no unblocked root: every slice declares at least one dependsOn, so nothing can start";

/** A well-formed slice with the given title and dependencies — every other field is filler. */
export function slice(title: string, dependsOn: number[] = []): Slice {
  return {
    title,
    whatToBuild: `Build ${title}.`,
    acceptanceCriteria: [`${title} works.`],
    filesClaimed: [],
    seamsConsumed: [],
    whyNotMerged: `${title} is its own vertical slice.`,
    dependsOn,
  };
}

/**
 * The message `validatePlan` refused this plan with, or `null` when it passed silently.
 *
 * `validatePlan` returns nothing and signals by throwing, so "what did it say" and "did it accept
 * this at all" are one question with one answer, and a `null` here is a plan that got through.
 */
export function refusalOf(plan: Slice[]): string | null {
  try {
    validatePlan(plan);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
