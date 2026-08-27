import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../../shape/marker";
import type { Sheet } from "../../shape/sheet-schema";
import type { GhExec } from "../../shared/gh";
import { collectMapContext } from "./map";
import { collectSheetContext } from "./sheet";
import { collectInSessionContext } from "./in-session";

/**
 * ADR-0058: one prompt, a collector per trigger, and all three collectors
 * normalize into the *same* Decided-context shape — the difference between
 * triggers belongs in the collector, never downstream of it.
 */

const DECIDED_CONTEXT_KEYS = ["ownerWords", "decisions", "rulings", "boundaries", "openGuesses"].sort();

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

function fakeSheetGh(body: string, comments: string[]): GhExec {
  return (args) => {
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") return JSON.stringify({ body });
    if (fields === "comments") return JSON.stringify({ comments: comments.map((b) => ({ body: b })) });
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}

function fakeMapGh(mapBody: string, ticketComments: Record<number, string[]>): GhExec {
  return (args) => {
    const issueNumber = Number(args[2]);
    const fields = args[args.indexOf("--json") + 1] ?? "";
    if (fields === "body") return JSON.stringify({ body: mapBody });
    if (fields === "comments") {
      return JSON.stringify({ comments: (ticketComments[issueNumber] ?? []).map((b) => ({ body: b })) });
    }
    throw new Error(`fake gh: unhandled fields: ${fields}`);
  };
}

describe("collectInSessionContext", () => {
  it("wraps the live conversation as ownerWords, verbatim", () => {
    const context = collectInSessionContext("owner: let's do X\nassistant: agreed, because Y");

    expect(context.ownerWords).toBe("owner: let's do X\nassistant: agreed, because Y");
  });

  it("makes no fetch — it takes the conversation as a plain string, nothing to inject a GhExec into", () => {
    expect(collectInSessionContext.length).toBe(1);
  });

  it("throws on an empty conversation rather than fabricating a Decided context from nothing", () => {
    expect(() => collectInSessionContext("")).toThrow();
    expect(() => collectInSessionContext("   \n  ")).toThrow();
  });
});

describe("all three collectors normalize into the same Decided-context shape", () => {
  let repoRoot: string | undefined;

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  });

  it("produces the identical five-field shape from a sheet, a map, and a live session", () => {
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0060-slug.md"], coinedTerms: ["Gate"], route: "short" };
    const sheetGh = fakeSheetGh("the owner's words", [sheetMarker(sheet()), acceptedMarker(payload)]);
    const sheetContext = collectSheetContext(sheetGh, 1);

    repoRoot = mkdtempSync(join(tmpdir(), "shape-parity-"));
    mkdirSync(join(repoRoot, "docs/adr"), { recursive: true });
    writeFileSync(join(repoRoot, "docs/adr/0100-slug.md"), "# A ruling\n\nThe durable text.");
    const mapBody = [
      "## Destination",
      "",
      "Ship it.",
      "",
      "Budget: 5 tickets.",
      "",
      "## Decisions so far",
      "",
      "- [A ticket](https://github.com/o/r/issues/9): filed as [ADR-0100](docs/adr/0100-slug.md)",
      "",
      "## Not yet specified",
      "",
      "## Out of scope",
      "",
    ].join("\n");
    const mapGh = fakeMapGh(mapBody, { 9: ["a resolution comment"] });
    const mapContext = collectMapContext(mapGh, 1, repoRoot);

    const inSessionContext = collectInSessionContext("owner and assistant, deciding things together");

    for (const context of [sheetContext, mapContext, inSessionContext]) {
      expect(Object.keys(context).sort()).toEqual(DECIDED_CONTEXT_KEYS);
      expect(typeof context.ownerWords).toBe("string");
      expect(typeof context.decisions).toBe("string");
      expect(typeof context.rulings).toBe("string");
      expect(typeof context.boundaries).toBe("string");
      expect(typeof context.openGuesses).toBe("string");
    }
  });
});
