import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../../shape/marker";
import type { GhExec } from "../../shared/gh";
import { collectMapContext } from "./map";
import { fakeSheetGh, sheet } from "./sheet.fixture";
import { collectSheetContext } from "./sheet";

/**
 * ADR-0058: one prompt, a collector per trigger, and every collector normalizes into the *same*
 * Decided-context shape — the difference between triggers belongs in the collector, never
 * downstream of it.
 *
 * Two collectors, not three. ADR-0085 removed the in-session one: a collector exists to hand a
 * package to a model that is not in the room, and the session door now writes the spec in the
 * room and enters lane 02 at the critic instead. This assertion is what the deleted file's own
 * parity test was for, kept here because the rule is about the collectors that remain.
 */

const DECIDED_CONTEXT_KEYS = ["ownerWords", "decisions", "rulings", "boundaries", "openGuesses"].sort();

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

describe("both collectors normalize into the same Decided-context shape", () => {
  let repoRoot: string | undefined;

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  });

  it("produces the identical five-field shape from a sheet and from a map", () => {
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0060-slug.md"], coinedTerms: ["Gate"], route: "short" };
    const sheetGh = fakeSheetGh("the owner's words", [sheetMarker(sheet()), acceptedMarker(payload)]);
    // The sheet collector returns its decisions beside the context; the parity
    // rule is about the context, which is the half every collector shares.
    const { context: sheetContext } = collectSheetContext(sheetGh, 1);

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

    for (const context of [sheetContext, mapContext]) {
      expect(Object.keys(context).sort()).toEqual(DECIDED_CONTEXT_KEYS);
      expect(typeof context.ownerWords).toBe("string");
      expect(typeof context.decisions).toBe("string");
      expect(typeof context.rulings).toBe("string");
      expect(typeof context.boundaries).toBe("string");
      expect(typeof context.openGuesses).toBe("string");
    }
  });
});
