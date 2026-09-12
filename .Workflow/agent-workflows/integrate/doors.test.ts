import { describe, expect, it } from "vitest";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "../shared/immutable-set";
import { signalsFixer, signalsReview, type RunEnding } from "./doors";

function ending(over: Partial<RunEnding> = {}): RunEnding {
  return { eventAction: IMPLEMENTATION_PR_DISPATCH_ACTION, immutability: "success", verify: "success", ...over };
}

describe("#519: the signal jobs read the results of the run they end, instead of a job condition", () => {
  it.each(["failure", "cancelled"])("rings the fixer when the gate ended %s", (verify) => {
    expect(signalsFixer(ending({ verify }))).toBe(true);
  });

  it.each(["failure", "cancelled"])("rings the fixer when the immutability judgement ended %s", (immutability) => {
    expect(signalsFixer(ending({ immutability, verify: "skipped" }))).toBe(true);
  });

  it("leaves the fixer alone when both judgements passed", () => {
    expect(signalsFixer(ending())).toBe(false);
  });

  it("leaves the fixer alone when immutability was skipped, which is the push door, not a red run", () => {
    expect(signalsFixer(ending({ immutability: "skipped" }))).toBe(false);
  });

  it("rings the reviewer on a green gate", () => {
    expect(signalsReview(ending({ immutability: "skipped" }))).toBe(true);
  });

  it.each(["failure", "cancelled", "skipped"])("leaves the reviewer alone when the gate ended %s", (verify) => {
    expect(signalsReview(ending({ verify }))).toBe(false);
  });

  it("rings both when immutability was cancelled but the gate still went green, as the two conditions did", () => {
    const both = ending({ immutability: "cancelled" });
    expect([signalsFixer(both), signalsReview(both)]).toEqual([true, true]);
  });

  it.each(["", "session-captured", "run-ended"])("rings nobody for a %s ending, which judges no pull request", (eventAction) => {
    const push = ending({ eventAction, immutability: "skipped" });
    expect([signalsFixer(push), signalsReview(push)]).toEqual([false, false]);
  });

  it("rings nobody for a push to main that went red, since no pull request is waiting on it", () => {
    expect(signalsFixer(ending({ eventAction: "", immutability: "skipped", verify: "failure" }))).toBe(false);
  });
});
