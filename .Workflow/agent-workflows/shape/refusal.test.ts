import { describe, expect, it } from "vitest";
import { refusalComment, refusalFor } from "./refusal";
import type { PriorArt, Sweep } from "./sweep-schema";

/**
 * ADR-0014's seam, in the one place lane 01 has it: *a model may translate
 * evidence into a gate's grammar but never render the gate's verdict.*
 *
 * The sweep is the model. It reads the tracker and `docs/adr/` — evidence the
 * idea's author did not write — and expresses what it found in
 * `sweep-schema.ts`'s grammar. Everything below asserts that the *verdict* is
 * this file's, and specifically that a sweep cannot kill an idea by asserting
 * a category without citing something of that category. That is the same
 * property the close gate's `bad-evidence-shape` has, and it is what makes
 * "the model cannot be talked past" a claim about code.
 */

/** The idea every sweep below was run for, so a self-citation has a number to be. */
const SUBJECT = 9;

function sweep(...priorArt: PriorArt[]): Sweep {
  return { priorArt, readingList: [] };
}

function art(over: Partial<PriorArt>): PriorArt {
  return { ref: "#1", url: "https://example.test/1", bearing: "…", verdict: "related", ...over };
}

describe("the stage-1 refusal", () => {
  it("refuses an idea a cited issue already carries", () => {
    const refusal = refusalFor(sweep(art({ verdict: "duplicate", ref: "#42" })), SUBJECT);

    expect(refusal?.cause).toBe("already-exists");
    expect(refusal?.evidence.ref).toBe("#42");
  });

  it("refuses an idea a cited ADR already ruled on", () => {
    const refusal = refusalFor(sweep(art({ verdict: "ruled", ref: "ADR-0014" })), SUBJECT);

    expect(refusal?.cause).toBe("already-ruled");
  });

  it("lets a related hit through — it funds a prior-art line, it does not refuse", () => {
    expect(refusalFor(sweep(art({ verdict: "related", ref: "ADR-0014" })), SUBJECT)).toBeUndefined();
  });

  it("passes an empty sweep, which is the ordinary case", () => {
    expect(refusalFor(sweep(), SUBJECT)).toBeUndefined();
  });

  describe("the citation has to be of the kind the verdict claims", () => {
    it("does not refuse a `ruled` that cites an issue", () => {
      // A sweep saying "an ADR ruled this" while pointing at an issue has not
      // found a ruling, whatever it believes. Killing an idea on it would be
      // the model rendering the verdict.
      expect(refusalFor(sweep(art({ verdict: "ruled", ref: "#42" })), SUBJECT)).toBeUndefined();
    });

    it("does not refuse a `duplicate` that cites an ADR", () => {
      expect(
        refusalFor(sweep(art({ verdict: "duplicate", ref: "ADR-0014" })), SUBJECT),
      ).toBeUndefined();
    });

    it("still refuses on a later hit when an earlier one was miscited", () => {
      const refusal = refusalFor(
        sweep(art({ verdict: "ruled", ref: "#42" }), art({ verdict: "duplicate", ref: "#7" })),
        SUBJECT,
      );

      expect(refusal?.evidence.ref).toBe("#7");
    });
  });

  describe("an idea is not a duplicate of itself", () => {
    it("does not refuse on a `duplicate` citing the idea being swept", () => {
      // The self-citation `citesItself` skips (ADR-0014).
      expect(
        refusalFor(sweep(art({ verdict: "duplicate", ref: `#${SUBJECT}` })), SUBJECT),
      ).toBeUndefined();
    });

    it("still refuses on a real duplicate found alongside the self-citation", () => {
      // Skipping the subject is not skipping the sweep — the entries after it
      // are judged exactly as they would have been.
      const refusal = refusalFor(
        sweep(
          art({ verdict: "duplicate", ref: `#${SUBJECT}` }),
          art({ verdict: "duplicate", ref: "#42" }),
        ),
        SUBJECT,
      );

      expect(refusal?.evidence.ref).toBe("#42");
    });

    it("keeps a `related` self-citation off the gate without dropping it from the sheet", () => {
      // `related` refuses nothing either way; what matters is that the skip is
      // about the refusal, and `renderPriorArt` still carries every entry.
      expect(
        refusalFor(sweep(art({ verdict: "related", ref: `#${SUBJECT}` })), SUBJECT),
      ).toBeUndefined();
    });
  });

  it("names what clears it, because a refusal that nothing clears parks work", () => {
    // ADR-0011. The clearing act is a comment — §01's fourth owner verb doing
    // the job it already has — and the comment has to say so, since nothing
    // else the owner sees will.
    const comment = refusalComment({
      cause: "already-exists",
      evidence: art({ verdict: "duplicate", ref: "#42" }),
    });

    expect(comment).toContain("#42");
    expect(comment).toContain("comment");
  });
});
