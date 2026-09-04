import { describe, expect, it } from "vitest";
import { refusalComment, refusalFor } from "./refusal";
import type { PriorArt, Sweep } from "../shared/sweep-schema";

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

  it("lets a related hit through: it funds a prior-art line, it does not refuse", () => {
    expect(refusalFor(sweep(art({ verdict: "related", ref: "ADR-0014" })), SUBJECT)).toBeUndefined();
  });

  it("passes an empty sweep, which is the ordinary case", () => {
    expect(refusalFor(sweep(), SUBJECT)).toBeUndefined();
  });

  describe("the citation has to be of the kind the verdict claims", () => {
    it("does not refuse a `ruled` that cites an issue", () => {
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
      expect(
        refusalFor(sweep(art({ verdict: "duplicate", ref: `#${SUBJECT}` })), SUBJECT),
      ).toBeUndefined();
    });

    it("still refuses on a real duplicate found alongside the self-citation", () => {
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
      expect(
        refusalFor(sweep(art({ verdict: "related", ref: `#${SUBJECT}` })), SUBJECT),
      ).toBeUndefined();
    });
  });

  it("names what clears it, because a refusal that nothing clears parks work", () => {
    const comment = refusalComment({
      cause: "already-exists",
      evidence: art({ verdict: "duplicate", ref: "#42" }),
    });

    expect(comment).toContain("#42");
    expect(comment).toContain("comment");
  });
});
