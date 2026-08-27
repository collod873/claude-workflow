import { describe, expect, it } from "vitest";
import {
  acceptedMarker,
  ACCEPTED_MARKER,
  isAccepted,
  isRefusal,
  readAcceptedMarker,
  readSheetMarker,
  REFUSAL_MARKER,
  sheetMarker,
  type AcceptedPayload,
} from "./marker";
import { renderSheet } from "./render-sheet";
import type { Sheet } from "./sheet-schema";

/**
 * The sheet travels twice in one comment — once as prose the owner reads,
 * once as JSON nothing re-derives. Three separate readers depend on the
 * second copy surviving a round trip through a GitHub comment body: the round
 * counter, the accept, and the refuter's probation count.
 */

const sheet: Sheet = {
  restatement: "the idea as work",
  priorArt: [{ ref: "#42", url: "https://example.test/42", bearing: "…", verdict: "related" }],
  decisions: [
    { question: "q", recommendation: "r", rejected: "x", mark: "ADR-0007", adrTitle: "A ruling" },
  ],
  survivors: [],
  route: "short",
  routeReason: "Short — one file.",
  newTerms: [],
  round: 0,
};

describe("the sheet's trailer", () => {
  it("round-trips a sheet", () => {
    expect(readSheetMarker(sheetMarker(sheet))).toEqual(sheet);
  });

  it("round-trips out of a whole rendered comment", () => {
    expect(readSheetMarker(renderSheet(sheet))).toEqual(sheet);
  });

  it("survives prose containing an HTML comment terminator", () => {
    // An HTML comment ends at the first `-->`, and a shaper's prose is free to
    // contain one. Every `>` in a JSON document is inside a string, so
    // escaping them all cannot corrupt the document — this is the assertion
    // that the escape is actually applied, not merely described.
    const hostile: Sheet = { ...sheet, restatement: "the arrow --> and back" };

    expect(readSheetMarker(sheetMarker(hostile))?.restatement).toBe("the arrow --> and back");
  });

  it("reads the last trailer when a body somehow carries two", () => {
    const body = `${sheetMarker(sheet)}\n${sheetMarker({ ...sheet, round: 2 })}`;

    expect(readSheetMarker(body)?.round).toBe(2);
  });

  describe("an unreadable trailer is not a sheet, and is never an exception", () => {
    // Read across every comment on an issue, most of which are prose. A single
    // malformed trailer must not take out the round count and strand the
    // issue; what it costs is that such a sheet stops being counted, which is
    // visible on the issue itself.
    it.each([
      ["ordinary prose", "looks good to me"],
      ["an unterminated trailer", "<!-- decision-sheet:v1 {\"round\":0}"],
      ["a trailer that is not JSON", "<!-- decision-sheet:v1 not json -->"],
      ["a trailer that is not a sheet", '<!-- decision-sheet:v1 {"round":0} -->'],
    ])("%s", (_name, body) => {
      expect(readSheetMarker(body)).toBeUndefined();
    });
  });
});

const acceptedPayload: AcceptedPayload = {
  adrPaths: ["docs/adr/0051-slug.md"],
  coinedTerms: ["Gate"],
  route: "short",
};

describe("the accept's trailer", () => {
  it("round-trips a payload the same way sheetMarker does", () => {
    expect(readAcceptedMarker(acceptedMarker(acceptedPayload))).toEqual(acceptedPayload);
  });

  it("survives a payload containing a `>` character, the same way sheetMarker does", () => {
    // Mirrors marker.ts's own escaping assertion for the sheet: every `>` in
    // the JSON document is escaped as `>`, so an ADR path or term that
    // happens to contain one cannot terminate the HTML comment early.
    const hostile: AcceptedPayload = { ...acceptedPayload, coinedTerms: ["the arrow --> and back"] };

    expect(readAcceptedMarker(acceptedMarker(hostile))?.coinedTerms).toEqual([
      "the arrow --> and back",
    ]);
  });

  it("is recognised by isAccepted whether or not it carries a payload", () => {
    expect(isAccepted(acceptedMarker(acceptedPayload))).toBe(true);
    expect(isAccepted(`## Accepted\n\n${ACCEPTED_MARKER} -->`)).toBe(true);
  });

  it("reads as absent — not as an exception — for the old bare marker", () => {
    // A comment written before this payload existed carries the bare marker
    // with nothing between the tags. That is unreadable, and reads the same
    // way as a comment that isn't an accept at all: as nothing to fall back
    // to prose for.
    expect(readAcceptedMarker(`${ACCEPTED_MARKER} -->`)).toBeUndefined();
  });
});

describe("the refusal trailer", () => {
  it("is recognised in a comment", () => {
    expect(isRefusal(`refused for cause\n\n${REFUSAL_MARKER}`)).toBe(true);
  });

  it("is not a sheet", () => {
    expect(readSheetMarker(REFUSAL_MARKER)).toBeUndefined();
  });
});
