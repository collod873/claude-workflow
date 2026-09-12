import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "../shared/immutable-set";
import { FIXER_NEEDED_WIRE, isSignal, REVIEW_WANTED_WIRE, ringReader, type SignalRequest } from "./signal";

const HEAD_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6";
const BASE_SHA = "aaaabbbbccccddddeeeeffff0000111122223333";

function request(over: Partial<SignalRequest> = {}): SignalRequest {
  return {
    signal: "fixer",
    ending: { eventAction: IMPLEMENTATION_PR_DISPATCH_ACTION, immutability: "success", verify: "success" },
    runId: "8821",
    pr: "https://github.com/collod873/claude-workflow/pull/250",
    baseSha: BASE_SHA,
    ...over,
  };
}

function tracker(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    gh: (args) => {
      calls.push([...args]);
      return args[0] === "pr" ? `${HEAD_SHA}\n` : "";
    },
  };
}

const red = { eventAction: IMPLEMENTATION_PR_DISPATCH_ACTION, immutability: "success", verify: "failure" };

describe("#519: the signal jobs ring their reader from one step that always runs", () => {
  it("rings the fixer with the run it is to read", () => {
    const { gh, calls } = tracker();
    expect(ringReader(gh, request({ ending: red }))).toBe(true);
    expect(calls[0]).toEqual(expect.arrayContaining([`event_type=${FIXER_NEEDED_WIRE}`, "client_payload[run_id]=8821"]));
  });

  it("stays silent when the run the fixer would read went green", () => {
    const { gh, calls } = tracker();
    expect(ringReader(gh, request())).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rings the reviewer with the head it judged and the trunk it judged it against", () => {
    const { gh, calls } = tracker();
    expect(ringReader(gh, request({ signal: "review" }))).toBe(true);
    expect(calls[1]).toEqual(
      expect.arrayContaining([
        `event_type=${REVIEW_WANTED_WIRE}`,
        `client_payload[head_sha]=${HEAD_SHA}`,
        `client_payload[base_sha]=${BASE_SHA}`,
      ]),
    );
  });

  it("does not even ask the pull request for its head when the gate was not green", () => {
    const { gh, calls } = tracker();
    expect(ringReader(gh, request({ signal: "review", ending: red }))).toBe(false);
    expect(calls).toEqual([]);
  });

  it.each(["fixer", "review"])("%s is a reader this lane knows how to ring", (signal) => {
    expect(isSignal(signal)).toBe(true);
  });

  it.each(["", "reviewer", "acceptance"])("refuses %s, which names no reader", (signal) => {
    expect(isSignal(signal)).toBe(false);
  });
});
