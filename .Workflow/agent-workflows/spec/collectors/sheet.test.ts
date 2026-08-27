import { describe, expect, it } from "vitest";
import type { GhExec } from "../../shared/gh";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../../shape/marker";
import type { Sheet } from "../../shape/sheet-schema";
import { collectSheetContext } from "./sheet";

/**
 * The sheet collector is the accepted-sheet trigger's half of ADR-0058: it
 * reads the marker payload `accept.ts` writes, never the rendered comment
 * `acceptComment` produces — parsing that prose is the exact failure the
 * payload exists to prevent.
 */

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    restatement: "the idea as work",
    priorArt: [],
    decisions: [{ question: "q", recommendation: "r", rejected: "x", mark: "", adrTitle: "" }],
    survivors: [],
    route: "short",
    routeReason: "Short — one file.",
    newTerms: [],
    round: 0,
    ...over,
  };
}

/** A fake `gh` answering only `issue view --json body` and `issue view --json comments`. */
function fakeGh(body: string, comments: string[]): GhExec {
  return (args) => {
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") return JSON.stringify({ body });
    if (fields === "comments") return JSON.stringify({ comments: comments.map((b) => ({ body: b })) });
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}

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

    const context = collectSheetContext(gh, 1);

    expect(context.ownerWords).toBe("the owner's words");
    expect(context.rulings).toContain("docs/adr/0051-slug.md");
    expect(context.rulings).toContain("docs/adr/0052-slug.md");
    expect(context.rulings).toContain("Gate");
    expect(context.rulings).toContain("Lane");
    expect(context.boundaries).toContain("long");
  });

  it("cites the rulings by path rather than restating the decision", () => {
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0060-slug.md"], coinedTerms: [], route: "short" };
    const gh = fakeGh("words", [sheetMarker(sheet()), acceptedMarker(payload)]);

    const context = collectSheetContext(gh, 1);

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

    const context = collectSheetContext(gh, 1);

    expect(context.rulings).toContain("docs/adr/0002-new.md");
    expect(context.rulings).not.toContain("docs/adr/0001-old.md");
  });
});
