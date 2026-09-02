import { describe, expect, it } from "vitest";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../../shape/marker";
import { sheet } from "../../shape/sheet.fixture";
import { collectSheetContext } from "./sheet";
import { fakeSheetGh as fakeGh } from "./sheet-gh.fixture";

/**
 * The sheet collector is the accepted-sheet trigger's half of ADR-0058: it
 * reads the marker payload `accept.ts` writes, never the rendered comment
 * `acceptComment` produces — parsing that prose is the exact failure the
 * payload exists to prevent.
 */

describe("collectSheetContext", () => {
  it("reads adrPaths, coinedTerms and route from the accept's marker payload", () => {
    const payload: AcceptedPayload = {
      adrPaths: ["docs/adr/0051-slug.md", "docs/adr/0052-slug.md"],
      coinedTerms: ["Gate", "Lane"],
      route: "long",
    };
    const gh = fakeGh("the owner's words", [
      `## Restatement\n\n…\n\n${sheetMarker(sheet({ routeReason: "Long — five decisions." }))}`,
      `## Accepted\n\n${acceptedMarker(payload)}`,
    ]);

    const { context } = collectSheetContext(gh, 1);

    expect(context.ownerWords).toBe("the owner's words");
    expect(context.rulings).toContain("docs/adr/0051-slug.md");
    expect(context.rulings).toContain("docs/adr/0052-slug.md");
    expect(context.rulings).toContain("Gate");
    expect(context.rulings).toContain("Lane");
    expect(context.boundaries).toContain("long");
  });

  it("returns the sheet's own decisions beside a context unchanged field for field", () => {
    // ADR-0061's arithmetic needs the marks themselves, which the context's
    // `decisions` string has already flattened into prose. Both ride out, and
    // the context side is asserted whole so a field added or reworded here
    // fails rather than passing silently.
    const decisions = [
      { question: "q1", recommendation: "r1", rejected: "x1", mark: "ADR-0028", adrTitle: "", adrReversal: "" },
      { question: "q2", recommendation: "r2", rejected: "x2", mark: "sheet.ts", adrTitle: "A ruling", adrReversal: "Undoing it costs a re-route" },
    ];
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0060-slug.md"], coinedTerms: [], route: "short" };
    const gh = fakeGh("the owner's words", [
      sheetMarker(sheet({ decisions, survivors: ["nobody checked the cap"] })),
      acceptedMarker(payload),
    ]);

    const collected = collectSheetContext(gh, 1);

    expect(collected.decisions).toEqual(decisions);
    expect(collected.context).toEqual({
      ownerWords: "the owner's words",
      decisions: "- q1\n  r1\n  (Rejected: x1)\n- q2\n  r2\n  (Rejected: x2)",
      rulings: "- docs/adr/0060-slug.md",
      boundaries: "Route: `short` — Short — one file.",
      openGuesses: "- nobody checked the cap",
    });
  });

  it("cites the rulings by path rather than restating the decision", () => {
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0060-slug.md"], coinedTerms: [], route: "short" };
    const gh = fakeGh("words", [sheetMarker(sheet()), acceptedMarker(payload)]);

    const { context } = collectSheetContext(gh, 1);

    expect(context.rulings).toBe("- docs/adr/0060-slug.md");
  });

  it("throws rather than falling back to prose-parsing when the payload is absent", () => {
    // No accept comment at all — never a case this collector guesses at.
    const gh = fakeGh("words", [sheetMarker(sheet())]);

    expect(() => collectSheetContext(gh, 1)).toThrow();
  });

  it("throws on an old bare accept marker, which carries no payload to read", () => {
    const gh = fakeGh("words", [
      sheetMarker(sheet()),
      "## Accepted\n\n<!-- shape-accepted:v1 -->",
    ]);

    expect(() => collectSheetContext(gh, 1)).toThrow();
  });

  it("throws when the issue carries no decision sheet", () => {
    const payload: AcceptedPayload = { adrPaths: [], coinedTerms: [], route: "short" };
    const gh = fakeGh("words", [acceptedMarker(payload)]);

    expect(() => collectSheetContext(gh, 1)).toThrow();
  });

  it("reads the latest sheet and the latest accept when either repeats", () => {
    const first: AcceptedPayload = { adrPaths: ["docs/adr/0001-old.md"], coinedTerms: [], route: "short" };
    const second: AcceptedPayload = { adrPaths: ["docs/adr/0002-new.md"], coinedTerms: [], route: "short" };
    const gh = fakeGh("words", [
      sheetMarker(sheet({ round: 0 })),
      sheetMarker(sheet({ round: 1 })),
      acceptedMarker(first),
      acceptedMarker(second),
    ]);

    const { context } = collectSheetContext(gh, 1);

    expect(context.rulings).toContain("docs/adr/0002-new.md");
    expect(context.rulings).not.toContain("docs/adr/0001-old.md");
  });
});
