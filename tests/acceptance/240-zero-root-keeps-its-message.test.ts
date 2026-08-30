import { describe, expect, it } from "vitest";
import { slice, validatePlanProbe } from "./validate-graph-probe.fixture";

/**
 * #240 — "Tighten validatePlan to exactly one unblocked root", first acceptance criterion:
 *
 * A plan with zero roots keeps its existing no-root error message — check: `npx vitest run .Workflow/agent-workflows/shared/validate-graph.test.ts`
 *
 * A plan with no root and a plan with two roots are different defects, so the no-root wording has
 * to survive *and* stay reserved for the plan that actually has no root.
 *
 * **ADR-0113 reversed the tightening this criterion was written alongside.** A two-root plan is now
 * accepted rather than refused with a different message — `slice/prompt.md` draws wave 0 as every
 * slice with no `dependsOn`, so a plural wave 0 was never the defect #240 took it for. The half of
 * this criterion that survives is the one it was actually about: the zero-root message, exact, and
 * reserved.
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
    "keeps that message for the zero-root defect alone: a two-root plan is not refused at all",
    () => {
      // ADR-0113 retired #240's other half. A plan with two roots has roots, so the no-root message
      // was never true of it — and demanding exactly one contradicted `slice/prompt.md`, which
      // draws wave 0 as every slice with no `dependsOn`. What survives from this criterion is the
      // half that still holds: the message stays reserved for the plan that genuinely has none.
      const plan = [slice("Tracer"), slice("Also unblocked")];

      const result = validatePlanProbe(plan);

      expect(result.threw).toBe(false);
    },
    TIMEOUT_MS,
  );
});
