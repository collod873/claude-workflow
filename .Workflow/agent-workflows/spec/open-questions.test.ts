import { createRecordingGh } from "../shared/gh.fake";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { QUESTIONS_OPEN_LABEL, SLICEABLE_LABEL } from "../shared/labels";
import {
  applyGate,
  gateCount,
  SPEC_DISPATCH_EVENT_TYPE,
  unfiledMarkGap,
  unfiledMarks,
  type MarkedDecision,
} from "./open-questions";

describe("unfiledMarkGap: the sheet's own unfiled-guess arithmetic", () => {
  it("is zero when every marked decision has a filed ADR and no open question names an unfiled mark", () => {
    const decisions: MarkedDecision[] = [
      { mark: "ADR-0060", adrTitle: "A ruling that files it" },
      { mark: "", adrTitle: "" }, 
    ];

    expect(unfiledMarkGap(decisions, [])).toBe(0);
  });

  it("is zero when an unfiled mark's target is named by an open question", () => {
    const decisions: MarkedDecision[] = [{ mark: "docs/adr/0060", adrTitle: "" }];
    const openQuestions = ["The sheet marked docs/adr/0060 and no ADR was filed for it, so what should it say?"];

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

describe("unfiledMarks: the set unfiledMarkGap counts", () => {
  it("returns the marked, unfiled decisions that no open question names", () => {
    const named: MarkedDecision = { mark: "docs/adr/0060", adrTitle: "" };
    const unnamed: MarkedDecision = { mark: "docs/adr/0061", adrTitle: "" };
    const filed: MarkedDecision = { mark: "docs/adr/0062", adrTitle: "A ruling that files it" };
    const decisions = [named, unnamed, filed];
    const openQuestions = ["Something about docs/adr/0060."];

    expect(unfiledMarks(decisions, openQuestions)).toEqual([unnamed]);
  });

  it("is not thrown off by a single question naming two marks, where subtracting counts would be", () => {
    const decisions: MarkedDecision[] = [
      { mark: "docs/adr/0060", adrTitle: "" },
      { mark: "docs/adr/0061", adrTitle: "" },
    ];
    const openQuestions = ["Something about both docs/adr/0060 and docs/adr/0061."];

    expect(unfiledMarks(decisions, openQuestions)).toEqual([]);
  });

  it("is not thrown off by two questions naming the same mark, where subtracting counts would be", () => {
    const decisions: MarkedDecision[] = [{ mark: "docs/adr/0060", adrTitle: "" }];
    const openQuestions = ["First question about docs/adr/0060.", "Second question about docs/adr/0060."];

    expect(unfiledMarks(decisions, openQuestions)).toEqual([]);
  });
});

describe("gateCount: how much a run left unresolved", () => {
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

  it("contributes nothing for a door with no decisions, such as a map or a session-written spec", () => {
    expect(gateCount(["one open question"], [])).toBe(1);
  });
});

const edits = (calls: string[][]) => calls.filter((call) => call[0] === "issue" && call[1] === "edit");

describe("applyGate: unconditional since #263", () => {
  it.each([
    ["called with no count at all", undefined],
    ["the count says something was left unresolved", 3],
  ])("labels sliceable and requests the dispatch when %s", (_case, count) => {
    const { gh, calls } = createRecordingGh();

    const outcome = count === undefined ? applyGate(gh, 42) : applyGate(gh, 42, count);

    expect(outcome).toBe("dispatched");
    expect(edits(calls).at(-1)).toEqual(["issue", "edit", "42", "--add-label", SLICEABLE_LABEL]);
    const dispatch = calls.at(-1) ?? [];
    expect(dispatch[0]).toBe("api");
    expect(dispatch).toContain(`event_type=${SPEC_DISPATCH_EVENT_TYPE}`);
  });

  it("writes the label before it asks for the dispatch, whatever the count", () => {
    for (const count of [undefined, 0, 5]) {
      const { gh, calls } = createRecordingGh();

      if (count === undefined) applyGate(gh, 42);
      else applyGate(gh, 42, count);

      const labelAt = calls.findIndex((call) => call[0] === "issue" && call.includes(SLICEABLE_LABEL));
      const dispatchAt = calls.findIndex(
        (call) => call[0] === "api" && call.some((arg) => arg.includes(`event_type=${SPEC_DISPATCH_EVENT_TYPE}`)),
      );
      expect(labelAt, JSON.stringify({ count, calls })).toBeGreaterThanOrEqual(0);
      expect(dispatchAt, JSON.stringify({ count, calls })).toBeGreaterThanOrEqual(0);
      expect(labelAt).toBeLessThan(dispatchAt);
    }
  });
});

describe("applyGate: the open-questions signal the owner reads (#521)", () => {
  it("stamps 2-questions-open ahead of sliceable when the count is above zero, and the two stand together", () => {
    const { gh, calls } = createRecordingGh();

    applyGate(gh, 42, 2);

    const [questions, sliceable] = edits(calls);
    expect(questions).toEqual(["issue", "edit", "42", "--add-label", QUESTIONS_OPEN_LABEL]);
    expect(sliceable).toEqual(["issue", "edit", "42", "--add-label", SLICEABLE_LABEL]);
    expect(sliceable).not.toContain(QUESTIONS_OPEN_LABEL);
  });

  it("removes a standing 2-questions-open when it applies sliceable at a count of zero", () => {
    const { gh, calls } = createRecordingGh();
    const wearing: GhExec = (args) =>
      args[0] === "issue" && args[1] === "view" ? JSON.stringify({ labels: [{ name: QUESTIONS_OPEN_LABEL }] }) : gh(args);

    applyGate(gh === wearing ? gh : wearing, 42, 0);

    expect(edits(calls)).toContainEqual(["issue", "edit", "42", "--remove-label", QUESTIONS_OPEN_LABEL]);
    expect(edits(calls).at(-1)).toEqual(["issue", "edit", "42", "--add-label", SLICEABLE_LABEL]);
  });

  it("leaves a spec that never carried the signal alone at a count of zero", () => {
    const { gh, calls } = createRecordingGh();

    applyGate(gh, 42, 0);

    expect(calls.some((call) => call.includes(QUESTIONS_OPEN_LABEL))).toBe(false);
  });
});
