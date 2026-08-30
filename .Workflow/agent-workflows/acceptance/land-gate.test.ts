import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { runLandGate, type LandGateDeps } from "./land-gate";

function deps(overrides: Partial<LandGateDeps> = {}): { fake: ReturnType<typeof createFakeGit>; refusals: string[]; deps: LandGateDeps } {
  const fake = createFakeGit(() => "");
  const refusals: string[] = [];
  return {
    fake,
    refusals,
    deps: {
      runGauntletPush: () => ({ ok: true }),
      repairAcceptanceBaseline: () => ({ verdict: "clean" }),
      git: fake.git,
      reportRefusal: (message) => refusals.push(message),
      ...overrides,
    },
  };
}

describe("runLandGate", () => {
  it("is clear when the gauntlet and the clone gate are both already green — nothing changes", () => {
    const { fake, refusals, deps: d } = deps();

    const outcome = runLandGate(d);

    expect(outcome).toEqual({ verdict: "clear" });
    expect(fake.calls).toEqual([]);
    expect(refusals).toEqual([]);
  });

  it("refuses before ever calling the clone gate when bin/gauntlet push is already red", () => {
    let repairCalled = false;
    const { fake, refusals, deps: d } = deps({
      runGauntletPush: () => ({ ok: false, report: "--- typecheck ---\nsomething is wrong" }),
      repairAcceptanceBaseline: () => {
        repairCalled = true;
        return { verdict: "clean" };
      },
    });

    const outcome = runLandGate(d);

    expect(outcome.verdict).toBe("refused");
    expect(outcome.verdict === "refused" && outcome.reason).toContain("something is wrong");
    expect(repairCalled).toBe(false);
    expect(refusals).toHaveLength(1);
    expect(fake.calls).toEqual([]); // no baseline commit, and no push happens from here either way
  });

  it("commits the repaired baseline when the only clones are the acceptance lane's own overlap", () => {
    const { fake, refusals, deps: d } = deps({
      repairAcceptanceBaseline: () => ({ verdict: "repaired", added: 1 }),
    });

    const outcome = runLandGate(d);

    expect(outcome).toEqual({ verdict: "repaired", added: 1 });
    expect(fake.calls[0]?.[0]).toBe("add");
    expect(fake.calls[1]?.[0]).toBe("commit");
    expect(refusals).toEqual([]);
  });

  it("refuses, and commits nothing, when a clone the baseline does not carry touches a file outside tests/acceptance/", () => {
    const { fake, refusals, deps: d } = deps({
      repairAcceptanceBaseline: () => ({
        verdict: "refused",
        reason: "clone gate: 1 clone(s) not in the baseline touch a file outside tests/acceptance/",
      }),
    });

    const outcome = runLandGate(d);

    expect(outcome.verdict).toBe("refused");
    expect(outcome.verdict === "refused" && outcome.reason).toContain("outside tests/acceptance/");
    expect(fake.calls).toEqual([]);
    expect(refusals).toEqual(["clone gate: 1 clone(s) not in the baseline touch a file outside tests/acceptance/"]);
  });
});
