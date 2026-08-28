import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import {
  applyGate,
  gateCount,
  numberedOpenQuestions,
  SLICEABLE_LABEL,
  SPEC_DISPATCH_EVENT_TYPE,
  unfiledMarkGap,
  type MarkedDecision,
} from "./open-questions";

/** A fake `GhExec` that records every call verbatim, in order, answering nothing. */
function fakeGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    return "";
  };
  return { gh, calls };
}

describe("unfiledMarkGap — ADR-0061's arithmetic", () => {
  it("is zero when every marked decision has a filed ADR and no open question names an unfiled mark", () => {
    const decisions: MarkedDecision[] = [
      { mark: "ADR-0060", adrTitle: "A ruling that files it" },
      { mark: "", adrTitle: "" }, // an unmarked decision — nothing owed
    ];

    expect(unfiledMarkGap(decisions, [])).toBe(0);
  });

  it("is zero when an unfiled mark's target is named by an open question", () => {
    const decisions: MarkedDecision[] = [{ mark: "docs/adr/0060", adrTitle: "" }];
    const openQuestions = ["The sheet marked docs/adr/0060 and no ADR was filed for it — what should it say?"];

    expect(unfiledMarkGap(decisions, openQuestions)).toBe(0);
  });

  it("is positive when a marked decision has no filed ADR and no open question names it", () => {
    const decisions: MarkedDecision[] = [{ mark: "docs/adr/0060", adrTitle: "" }];

    expect(unfiledMarkGap(decisions, [])).toBe(1);
  });

  it("counts every unnamed mark, not just the first", () => {
    const decisions: MarkedDecision[] = [
      { mark: "docs/adr/0060", adrTitle: "" },
      { mark: "docs/adr/0061", adrTitle: "" },
    ];
    const openQuestions = ["Something about docs/adr/0060."];

    expect(unfiledMarkGap(decisions, openQuestions)).toBe(1);
  });
});

describe("gateCount — ADR-0062's dispatch gate", () => {
  it("is zero with no open questions and no decisions", () => {
    expect(gateCount([])).toBe(0);
  });

  it("counts every explicit open question", () => {
    expect(gateCount(["invented intent #1", "invented intent #2"])).toBe(2);
  });

  it("adds the unfiled-mark gap on top, for the sheet trigger", () => {
    const decisions: MarkedDecision[] = [{ mark: "docs/adr/0060", adrTitle: "" }];

    expect(gateCount([], decisions)).toBe(1);
  });

  it("contributes nothing for a door with no decisions — a map, or a session-written spec", () => {
    expect(gateCount(["one open question"], [])).toBe(1);
  });
});

describe("numberedOpenQuestions — ADR-0061's numbered form", () => {
  it("renders each question numbered, in order", () => {
    expect(numberedOpenQuestions(["first", "second"])).toBe("1. first\n2. second");
  });

  it("renders nothing for an empty list", () => {
    expect(numberedOpenQuestions([])).toBe("");
  });
});

describe("applyGate", () => {
  it("applies sliceable before sending the dispatch, at a zero count", () => {
    const { gh, calls } = fakeGh();

    const outcome = applyGate(gh, 42, 0);

    expect(outcome).toBe("dispatched");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["issue", "edit", "42", "--add-label", SLICEABLE_LABEL]);
    expect(calls[1][0]).toBe("api");
    expect(calls[1]).toContain(`event_type=${SPEC_DISPATCH_EVENT_TYPE}`);
  });

  it("sends no dispatch and applies no sliceable label at a non-zero count", () => {
    const { gh, calls } = fakeGh();

    const outcome = applyGate(gh, 42, 1);

    expect(outcome).toBe("held");
    expect(calls).toHaveLength(0);
  });
});
