import { describe, expect, it } from "vitest";
import { slice, validatePlanProbe } from "./validate-graph-probe.fixture";

/**
 * #240 — "Tighten validatePlan to exactly one unblocked root", second acceptance criterion:
 *
 * A one-root plan passes; a two-plus-root plan is refused, naming both offenders by position and title — check: `npx vitest run .Workflow/agent-workflows/shared/validate-graph.test.ts`
 *
 * The offender assertions match the shape every other refusal in `validatePlan` already uses — the
 * slice's 1-based position followed closely by its title — and require the blocked slice sitting
 * between two roots to go unnamed, since it is not an offender.
 */

const CRITERION =
  "A one-root plan passes; a two-plus-root plan is refused, naming both offenders by position and title — check: `npx vitest run .Workflow/agent-workflows/shared/validate-graph.test.ts`";

const TIMEOUT_MS = 120_000;

/** A refusal naming the slice at this 1-based position by that title, however it is punctuated. */
function names(position: number, title: string): RegExp {
  return new RegExp(`\\b${position}\\b[^\\n]{0,12}${title}`);
}

describe(CRITERION, () => {
  it(
    "passes a plan whose only slice without a dependsOn is its single unblocked root",
    () => {
      const plan = [
        slice("Tracer"),
        slice("Depends on the tracer", [1]),
        slice("Depends on the second", [2]),
      ];

      const result = validatePlanProbe(plan);

      expect(result.message).toBe("");
      expect(result.threw).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a two-root plan, naming both offenders by 1-based position and title",
    () => {
      const plan = [
        slice("Tracer"),
        slice("Blocked middle slice", [1]),
        slice("Second unblocked root"),
      ];

      const result = validatePlanProbe(plan);

      expect(result.threw).toBe(true);
      expect(result.message).toMatch(names(1, "Tracer"));
      expect(result.message).toMatch(names(3, "Second unblocked root"));
      // Slice 2 has a dependsOn, so it is not one of the roots being complained about.
      expect(result.message).not.toMatch(/Blocked middle slice/);
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a three-root plan too, naming every offender by 1-based position and title",
    () => {
      const plan = [slice("Alpha root"), slice("Bravo root"), slice("Charlie root")];

      const result = validatePlanProbe(plan);

      expect(result.threw).toBe(true);
      expect(result.message).toMatch(names(1, "Alpha root"));
      expect(result.message).toMatch(names(2, "Bravo root"));
      expect(result.message).toMatch(names(3, "Charlie root"));
    },
    TIMEOUT_MS,
  );
});
