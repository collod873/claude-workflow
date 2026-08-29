import { describe, expect, it } from "vitest";
import {
  alreadyNamed,
  commentBody,
  entryLine,
  FINDING_MARKER,
  retirementBody,
  signalBody,
  signalTitle,
  type UnreachableFinding,
} from "./unreachable";

const finding = (number: number, title: string, blockedBy: number[]): UnreachableFinding => ({
  number,
  title,
  blockedBy,
});

describe("entryLine", () => {
  it("names the slice, its title and the blocker that closed without delivering", () => {
    expect(entryLine(finding(90, "Move 6: Spec on a runner", [77]))).toBe(
      "- [ ] #90 — Move 6: Spec on a runner: behind #77, closed without delivering",
    );
  });

  it("names every blocker when more than one is at fault", () => {
    expect(entryLine(finding(94, "The brief", [84, 89]))).toContain("behind #84, #89");
  });

  it("is a checkbox, so the owner's bounded touch is one list they tick", () => {
    expect(entryLine(finding(90, "A slice", [77]))).toMatch(/^- \[ \] /);
  });
});

describe("the standing signal", () => {
  it("carries the marker that makes the next run comment rather than open a second issue", () => {
    expect(signalBody([finding(90, "A slice", [77])])).toContain(FINDING_MARKER);
  });

  it("names an event, a count and an action — ADR-0064's three", () => {
    const body = signalBody([finding(90, "A slice", [77]), finding(91, "Another", [77])]);

    expect(body).toContain("unreachable");
    expect(body).toContain("#90 —");
    expect(body).toContain("#91 —");
    expect(body).toMatch(/re-slice|re-open|cut the edge/);
  });

  it("says why the count exists rather than leaving the reader to infer it", () => {
    expect(signalBody([finding(90, "A slice", [77])])).toContain("having delivered");
  });

  it("has a title stable enough for a reader to recognise across runs", () => {
    expect(signalTitle()).toBe(signalTitle());
    expect(signalTitle()).toContain("Unreachable");
  });

  it("adds later findings as a comment carrying the same lines", () => {
    const comment = commentBody([finding(91, "Another", [77])]);

    expect(comment).toContain("#91 —");
    expect(comment).not.toContain(FINDING_MARKER);
  });
});

describe("retirementBody", () => {
  it("opens with the heading the close gate parses, on its own first line", () => {
    expect(retirementBody().split("\n")[0]).toBe("## Closing record");
  });

  it("declares `No diff.`, because a report's lines are cleared by other tickets' diffs", () => {
    expect(retirementBody()).toContain("No diff.");
  });

  it("is a declaration the gate accepts, because the body it closes carries no acceptance criteria", () => {
    // `No diff.` excuses the range only where the issue body declares no criteria (`close-gate.py`).
    // The two agree by construction rather than by luck, so this asserts the construction.
    expect(signalBody([finding(90, "A slice", [77])])).not.toContain("## Acceptance criteria");
  });

  it("says the mechanism survives the close, so a reader does not read this as a retirement", () => {
    expect(retirementBody()).toContain("never the mechanism");
  });

  it("carries no marker, so closing the report cannot make the closed issue the standing one", () => {
    expect(retirementBody()).not.toContain(FINDING_MARKER);
  });
});

describe("alreadyNamed", () => {
  it("recognises a slice named in the standing issue's own text", () => {
    expect(alreadyNamed(signalBody([finding(90, "A slice", [77])]), 90)).toBe(true);
  });

  it("does not mistake a longer number for the one it is looking for", () => {
    expect(alreadyNamed(entryLine(finding(900, "A slice", [77])), 90)).toBe(false);
  });

  it("is false about a slice nothing has said yet", () => {
    expect(alreadyNamed(signalBody([finding(90, "A slice", [77])]), 91)).toBe(false);
  });
});
