import { describe, expect, it } from "vitest";
import { test } from "vitest";
import type { GhExec } from "../shared/gh";
import { sheetMarker, REFUSAL_MARKER } from "../shared/marker";
import { roundFor } from "./rounds";
import type { Sheet } from "../shared/sheet-schema";
import type { Tracker } from "../shared/tracker";
import { trackerMemory } from "../shared/tracker-memory";

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

function trackerWith(...bodies: string[]): Tracker {
  return trackerMemory({ issues: { 1: { comments: bodies } } });
}

describe("where a run sits", () => {
  it("is round 0 on an idea nothing has spoken on", () => {
    const round = roundFor(trackerWith(), 1);

    expect(round).toMatchObject({ round: 0, refusalApplies: true, capped: false });
    expect(round.latestSheet).toBeUndefined();
  });

  it("ignores the owner's own comments, counting only this lane's", () => {
    const round = roundFor(trackerWith("this is great", "do it"), 1);

    expect(round.round).toBe(0);
  });

  it("counts a posted sheet", () => {
    const round = roundFor(trackerWith(sheetComment(0)), 1);

    expect(round).toMatchObject({ round: 1, refusalApplies: false });
  });

  it("counts a refusal, so a cleared refusal is a round rather than a fresh start", () => {
    const round = roundFor(trackerWith(`refused\n\n${REFUSAL_MARKER}`), 1);

    expect(round).toMatchObject({ round: 1, refusalApplies: false });
  });

  it("hands back the latest sheet, which is the live one", () => {
    const round = roundFor(trackerWith(sheetComment(0), "change this", sheetComment(1)), 1);

    expect(round.latestSheet?.round).toBe(1);
  });
});

describe("the change-request cap", () => {
  it("allows the two re-runs §01 funds", () => {
    expect(roundFor(trackerWith(sheetComment(0)), 1).capped).toBe(false);
    expect(roundFor(trackerWith(sheetComment(0), sheetComment(1)), 1).capped).toBe(false);
  });

  it("stops after them, because uncapped is the fixer mistake in a new place", () => {
    const round = roundFor(
      trackerWith(sheetComment(0), sheetComment(1), sheetComment(2)),
      1,
    );

    expect(round.capped).toBe(true);
  });
});

describe("the stage-1 refusal only fires on the first run", () => {
  it("stands down once the owner has commented past it", () => {
    expect(roundFor(trackerWith(`refused\n\n${REFUSAL_MARKER}`), 1).refusalApplies).toBe(false);
  });
});

test("#618.5: roundFor reads through a Tracker built by trackerMemory, not a raw GhExec", () => {
  const round = roundFor(trackerMemory() as unknown as GhExec, 1);

  expect(round).toMatchObject({ round: 0, refusalApplies: true, capped: false });
});
