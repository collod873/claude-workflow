import { describe, expect, it } from "vitest";
import { applyGrammar, capDecisions, DECISION_CAP, marksForceLong, PRIOR_ART_CAP, SURVIVOR_CAP } from "./sheet";
import type { Decision, Refutations, ShaperSheet } from "./sheet-schema";
import type { PriorArt } from "./sweep-schema";

/**
 * The three mechanical outcomes lane 01 hangs off the sheet's
 * own shape: the mark strip (ADR-0028), the route override (ADR-0029), and
 * the refusal to shape (ADR-0029 again). None of them may consult a model,
 * and this is where that is pinned.
 */

function decision(over: Partial<Decision> = {}): Decision {
  return { question: "q", recommendation: "r", rejected: "x", mark: "", adrTitle: "", ...over };
}

function shaped(over: Partial<ShaperSheet> = {}): ShaperSheet {
  return {
    kind: "sheet",
    restatement: "the idea as work",
    priorArt: [],
    decisions: [decision()],
    route: "short",
    routeReason: "Short — one file.",
    newTerms: [],
    ...over,
  };
}

const silent: Refutations = { survivors: [] };

describe("the mark strip", () => {
  it("keeps a mark that names what it moves", () => {
    const sheet = applyGrammar(shaped({ decisions: [decision({ mark: "ADR-0007" })] }), silent, 0);

    expect(sheet.decisions[0].mark).toBe("ADR-0007");
  });

  it("strips a whitespace-only mark, which names nothing", () => {
    // ADR-0028: a mark with an empty target is malformed and is stripped
    // mechanically, so the test needs no judgement at check time. Whitespace
    // is the interesting case — it is non-empty to a schema and empty to a
    // reader, and only one of those is what the ADR means.
    const sheet = applyGrammar(shaped({ decisions: [decision({ mark: "   " })] }), silent, 0);

    expect(sheet.decisions[0].mark).toBe("");
  });

  it("does not let a stripped mark vote on the route", () => {
    const sheet = applyGrammar(
      shaped({ decisions: [decision({ mark: "  " }), decision()], route: "short" }),
      silent,
      0,
    );

    expect(sheet.route).toBe("short");
  });
});

describe("the route override", () => {
  it("sends an item long when more than half the decisions are marked", () => {
    const sheet = applyGrammar(
      shaped({
        decisions: [decision({ mark: "a file" }), decision({ mark: "an ADR" }), decision()],
        route: "short",
      }),
      silent,
      0,
    );

    expect(sheet.route).toBe("long");
    expect(sheet.routeReason).toContain("2 of 3");
  });

  it("catches the short sheet a flat count of three would wave through", () => {
    // ADR-0029's whole argument for a fraction: two decisions with both
    // marked is plainly an idea nobody understands, and a flat 3 passes it.
    expect(marksForceLong([decision({ mark: "a" }), decision({ mark: "b" })])).toBe(true);
  });

  it("leaves exactly half marked alone — more than half is the rule", () => {
    expect(marksForceLong([decision({ mark: "a" }), decision()])).toBe(false);
  });

  it("never demotes a long recommendation to short", () => {
    // ADR-0007: the two misroutes are not symmetric. A wrong short route is
    // visible because lanes 06–07 still run; a wrong long route leaves no
    // trace anywhere. The mechanism holding that line only pushes one way.
    const sheet = applyGrammar(shaped({ decisions: [decision()], route: "long" }), silent, 0);

    expect(sheet.route).toBe("long");
  });
});

describe("the five-decision cap", () => {
  it("passes a sheet at the cap", () => {
    expect(capDecisions(shaped({ decisions: Array(DECISION_CAP).fill(decision()) }))).toBeUndefined();
  });

  it("refuses rather than truncates above it", () => {
    // The one cap that does not cut. Truncating seven decisions to five would
    // post a sheet that looks like every other sheet and hide the only
    // evidence that the idea does not close — which is the signal the cap
    // exists to raise (ADR-0029).
    const overflow = capDecisions(shaped({ decisions: Array(7).fill(decision()) }));

    expect(overflow?.count).toBe(7);
  });
});

describe("the sections that are cut rather than refused", () => {
  it("cuts prior art to its funded three lines", () => {
    const priorArt: PriorArt[] = Array.from({ length: 5 }, (_, index) => ({
      ref: `#${index}`,
      url: "https://example.test",
      bearing: "…",
      verdict: "related",
    }));

    expect(applyGrammar(shaped({ priorArt }), silent, 0).priorArt).toHaveLength(PRIOR_ART_CAP);
  });

  it("cuts surviving refutations to three", () => {
    const survivors = { survivors: ["a", "b", "c", "d"] };

    expect(applyGrammar(shaped(), survivors, 0).survivors).toHaveLength(SURVIVOR_CAP);
  });
});
