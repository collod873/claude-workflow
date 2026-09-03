import { describe, expect, it } from "vitest";
import { runLandGate, type LandGateDeps } from "./land-gate";

function deps(overrides: Partial<LandGateDeps> = {}): { refusals: string[]; deps: LandGateDeps } {
  const refusals: string[] = [];
  return {
    refusals,
    deps: {
      runGauntletPush: () => ({ ok: true }),
      reportRefusal: (message) => refusals.push(message),
      ...overrides,
    },
  };
}

describe("runLandGate", () => {
  it("is clear when the gauntlet is green, and reports nothing", () => {
    const { deps: d, refusals } = deps();

    expect(runLandGate(d)).toEqual({ verdict: "clear" });
    expect(refusals).toEqual([]);
  });

  it("refuses, naming the gauntlet's report, when the push venue is red", () => {
    const { deps: d, refusals } = deps({
      runGauntletPush: () => ({ ok: false, report: "--- typecheck ---\nTS2322" }),
    });

    const outcome = runLandGate(d);

    expect(outcome.verdict).toBe("refused");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("TS2322");
  });
});
