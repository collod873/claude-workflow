import { describe, expect, it } from "vitest";
import { sheetMarker, REFUSAL_MARKER } from "../shared/marker";
import { roundFor } from "./rounds";
import type { Sheet } from "../shared/sheet-schema";
import { createFakeTracker } from "./tracker.fake";

/**
 * §1's substrate rule at work: *no agent may remember anything.* How many
 * times this lane has spoken on an idea is a fact about a work item, so it is
 * recomputed from the issue's comment list on every run — which is also why
 * it cannot go stale, the property §6 credits for making a count free.
 */

function sheetComment(round: number, survivors: string[] = []): string {
  const sheet: Sheet = {
    restatement: "r",
    priorArt: [],
    decisions: [],
    survivors,
    route: "short",
    routeReason: "…",
    newTerms: [],
    round,
  };
  return `## Restatement\n\nr\n\n${sheetMarker(sheet)}`;
}

function trackerWith(...bodies: string[]) {
  return createFakeTracker({ comments: new Map([[1, bodies]]) });
}

describe("where a run sits", () => {
  it("is round 0 on an idea nothing has spoken on", () => {
    const round = roundFor(trackerWith().gh, 1);

    expect(round).toMatchObject({ round: 0, refusalApplies: true, capped: false });
    expect(round.latestSheet).toBeUndefined();
  });

  it("ignores the owner's own comments — only this lane's count", () => {
    const round = roundFor(trackerWith("this is great", "do it").gh, 1);

    expect(round.round).toBe(0);
  });

  it("counts a posted sheet", () => {
    const round = roundFor(trackerWith(sheetComment(0)).gh, 1);

    expect(round).toMatchObject({ round: 1, refusalApplies: false });
  });

  it("counts a refusal, so a cleared refusal is a round rather than a fresh start", () => {
    // The comment that clears a refusal is a change request like any other,
    // and it spends from the same budget. Counting the refusal is what makes
    // that true.
    const round = roundFor(trackerWith(`refused\n\n${REFUSAL_MARKER}`).gh, 1);

    expect(round).toMatchObject({ round: 1, refusalApplies: false });
  });

  it("hands back the latest sheet, which is the live one", () => {
    // §01 forbids editing a sheet in place, so the issue carries every round.
    // Which one is live is a question about order, not about content.
    const round = roundFor(trackerWith(sheetComment(0), "change this", sheetComment(1)).gh, 1);

    expect(round.latestSheet?.round).toBe(1);
  });
});

describe("the change-request cap", () => {
  it("allows the two re-runs §01 funds", () => {
    expect(roundFor(trackerWith(sheetComment(0)).gh, 1).capped).toBe(false);
    expect(roundFor(trackerWith(sheetComment(0), sheetComment(1)).gh, 1).capped).toBe(false);
  });

  it("stops after them, because uncapped is the fixer mistake in a new place", () => {
    const round = roundFor(
      trackerWith(sheetComment(0), sheetComment(1), sheetComment(2)).gh,
      1,
    );

    expect(round.capped).toBe(true);
  });
});

describe("the stage-1 refusal only fires on the first run", () => {
  it("stands down once the owner has commented past it", () => {
    // ADR-0011: a refusal ships only once something can clear it. Re-refusing
    // on the same prior art after the owner has read the evidence and
    // disagreed would park the idea forever, which is the outcome the whole
    // design is built to avoid.
    expect(roundFor(trackerWith(`refused\n\n${REFUSAL_MARKER}`).gh, 1).refusalApplies).toBe(false);
  });
});
