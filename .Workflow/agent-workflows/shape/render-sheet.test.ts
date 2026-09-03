import { describe, expect, it } from "vitest";
import { renderSheet } from "./render-sheet";
import type { Sheet } from "../shared/sheet-schema";

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    restatement: "the idea as work",
    priorArt: [],
    decisions: [
      { question: "Where does it fire?", recommendation: "On push", rejected: "In Actions — the repair is cheaper earlier", mark: "", adrTitle: "", adrReversal: "" },
    ],
    survivors: [],
    route: "short",
    routeReason: "Short — one file, and the gauntlet still runs.",
    newTerms: [],
    round: 0,
    ...over,
  };
}

describe("the sheet as the owner reads it", () => {
  it("carries the five sections in §01's order", () => {
    const rendered = renderSheet(sheet({ survivors: ["decision 1 contradicts ADR-0010"] }));
    const headings = [...rendered.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    expect(headings).toEqual([
      "Restatement",
      "Prior art",
      "Decisions",
      "Surviving refutations",
      "Route",
    ]);
  });

  it("carries the route, which is what §01a's accept acts on", () => {
    expect(renderSheet(sheet())).toContain("Short — one file");
  });
});

describe("the two asymmetric absences", () => {
  it("says `none found` when there is no prior art", () => {
    expect(renderSheet(sheet())).toContain("`none found`");
  });

  it("omits the refutations section entirely when the refuter is silent", () => {
    const rendered = renderSheet(sheet());

    expect(rendered).not.toContain("Surviving refutations");
    expect(rendered).not.toContain("none\n");
  });
});

describe("the assumption mark", () => {
  it("renders the pointer, because the pointer is what the owner checks", () => {
    const rendered = renderSheet(
      sheet({
        decisions: [
          { question: "q", recommendation: "r", rejected: "x", mark: "ADR-0007's routing rule", adrTitle: "", adrReversal: "" },
        ],
      }),
    );

    expect(rendered).toContain("ADR-0007's routing rule");
  });

  it("shows nothing at all for an unmarked decision", () => {
    expect(renderSheet(sheet())).not.toContain("Moves if this flips");
  });
});
