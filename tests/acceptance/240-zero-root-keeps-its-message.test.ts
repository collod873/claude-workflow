import { describe, expect, it } from "vitest";
import { slice, validatePlanProbe } from "./validate-graph-probe.fixture";

/**
 * #240 — "Tighten validatePlan to exactly one unblocked root", first acceptance criterion:
 *
 * A plan with zero roots keeps its existing no-root error message — check: `npx vitest run .Workflow/agent-workflows/shared/validate-graph.test.ts`
 *
 * A plan with no root and a plan with two roots are different defects, so the no-root wording has
 * to survive the tightening *and* stay reserved for the plan that actually has no root. Both halves
 * are asserted here: the exact message for zero roots, and its absence from the refusal a two-root
 * plan now earns.
 */

const CRITERION =
  "A plan with zero roots keeps its existing no-root error message — check: `npx vitest run .Workflow/agent-workflows/shared/validate-graph.test.ts`";

const NO_ROOT_MESSAGE =
  "plan has no unblocked root: every slice declares at least one dependsOn, so nothing can start";

const TIMEOUT_MS = 120_000;

describe(CRITERION, () => {
  it(
    "throws the existing no-root message verbatim when every slice declares a dependsOn",
    () => {
      // Neither edge is out of range or self-referential; the only defect is that nothing can start.
      const plan = [slice("First", [2]), slice("Second", [1])];

      const result = validatePlanProbe(plan);

      expect(result.threw).toBe(true);
      expect(result.message).toBe(NO_ROOT_MESSAGE);
    },
    TIMEOUT_MS,
  );

  it(
    "keeps that message for the zero-root defect alone: a two-root plan is refused with a different one",
    () => {
      const plan = [slice("Tracer"), slice("Also unblocked")];

      const result = validatePlanProbe(plan);

      expect(result.threw).toBe(true);
      expect(result.message).not.toBe(NO_ROOT_MESSAGE);
      // A plan with two roots has roots; saying it has none would be a lie, not a reused message.
      expect(result.message).not.toMatch(/no unblocked root/);
    },
    TIMEOUT_MS,
  );
});
