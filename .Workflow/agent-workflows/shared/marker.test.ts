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
import { renderSheet } from "../shape/render-sheet";
import type { Sheet } from "./sheet-schema";

const sheet: Sheet = {
  restatement: "the idea as work",
  priorArt: [{ ref: "#42", url: "https://example.test/42", bearing: "…", verdict: "related" }],
  decisions: [
    { question: "q", recommendation: "r", rejected: "x", mark: "ADR-0007", adrTitle: "A ruling", adrReversal: "Undoing it costs a re-route" },
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
    const hostile: Sheet = { ...sheet, restatement: "the arrow --> and back" };

    expect(readSheetMarker(sheetMarker(hostile))?.restatement).toBe("the arrow --> and back");
  });

  it("reads the last trailer when a body somehow carries two", () => {
    const body = `${sheetMarker(sheet)}\n${sheetMarker({ ...sheet, round: 2 })}`;

    expect(readSheetMarker(body)?.round).toBe(2);
  });

  describe("an unreadable trailer is not a sheet, and is never an exception", () => {
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
