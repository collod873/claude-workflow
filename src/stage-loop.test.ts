import { expect, it } from "vitest";
import { refusedAgain } from "./researcher.ts";
import { idleTwice } from "./reviewer.ts";
import { type Looped, type Spent, stageLoop } from "./stage.ts";

const refusedIn = (looped: Looped<unknown>) => ("refused" in looped ? looped.refused : "");

const spender = (handed: [string, string | undefined][]) => (input: string, resume?: string): Promise<Spent> => {
  handed.push([input, resume]);
  return Promise.resolve({ stdout: "", session: `session-${handed.length}` });
};

it("stops a stage whose rounds change nothing twice as unchanged, and one refused twice the same way as again, each worded as today", async () => {
  const idleHanded: [string, string | undefined][] = [];
  let idleRounds = 0;
  const idle = await stageLoop({
    spend: spender(idleHanded),
    input: "review it",
    stops: ["unchanged"],
    judged: () => ({ refused: `bin/land refused\nround ${++idleRounds} is red`, handBack: `fix round ${idleRounds}`, changed: false }),
  });
  expect(idle).toEqual({ stop: "unchanged", refused: "bin/land refused\nround 2 is red" });
  expect(idleHanded).toEqual([["review it", undefined], ["fix round 1", "session-1"]]);
  expect(idleTwice(refusedIn(idle))).toBe('two rounds in a row changed nothing: round 2 is red');

  const againHanded: [string, string | undefined][] = [];
  const again = await stageLoop({
    spend: spender(againHanded),
    input: "research it",
    stops: ["again"],
    judged: () => ({ refused: "step 1 names no owner", handBack: "step 1 names no owner" }),
  });
  expect(again).toEqual({ stop: "again", refused: "step 1 names no owner" });
  expect(againHanded).toHaveLength(2);
  expect(refusedAgain("research: #12", refusedIn(again))).toBe("research: #12 is answered but its researcher gave the same refused owner steps again, so nothing is posted or filed and it stays open: step 1 names no owner");
});

it("stops a stage still refused after its cap of rounds back as capped, on the refusal it fired on", async () => {
  const handed: [string, string | undefined][] = [];
  let rounds = 0;
  const looped = await stageLoop({
    spend: spender(handed),
    input: "slice it",
    stops: [],
    roundsBack: 2,
    judged: () => ({ refused: `round ${++rounds} refused`, handBack: `fix round ${rounds}` }),
  });
  expect(looped).toEqual({ stop: "capped", refused: "round 3 refused" });
  expect(handed).toEqual([["slice it", undefined], ["fix round 1", "session-1"], ["fix round 2", "session-2"]]);
});

it("judges ahead of every spend when a stage judges first, stopping on the refusal it handed before judging a third time", async () => {
  const handed: [string, string | undefined][] = [];
  let judgedAhead = 0;
  const idle = await stageLoop({
    spend: spender(handed),
    session: "session-0",
    stops: ["unchanged"],
    ahead: () => ({ refused: `still red\nround ${++judgedAhead}`, handBack: `fix round ${judgedAhead}` }),
    judged: () => ({ changed: false }),
  });
  expect(idle).toEqual({ stop: "unchanged", refused: "still red\nround 2" });
  expect(judgedAhead).toBe(2);
  expect(handed).toEqual([["fix round 1", "session-0"], ["fix round 2", "session-1"]]);

  const refusedHanded: [string, string | undefined][] = [];
  const again = await stageLoop({
    spend: spender(refusedHanded),
    stops: ["again"],
    ahead: () => ({ refused: "step 1 names no owner", handBack: "step 1 names no owner" }),
    judged: () => ({}),
  });
  expect(again).toEqual({ stop: "again", refused: "step 1 names no owner" });
  expect(refusedHanded).toHaveLength(1);

  const greened = await stageLoop({ spend: spender([]), stops: ["unchanged"], ahead: () => ({ done: "green" }), judged: () => ({ changed: true }) });
  expect(greened).toEqual({ done: "green" });
});
