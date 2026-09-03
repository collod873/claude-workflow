import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../../shared/marker";
import { scratchDir } from "../../shared/scratch.fixture";
import { sheet } from "../../shared/sheet.fixture";
import { collectMapContext } from "./map";
import { mapTrackerGh } from "./map-gh.fixture";
import { fakeSheetGh } from "./sheet-gh.fixture";
import { collectSheetContext } from "./sheet";

const DECIDED_CONTEXT_KEYS = ["ownerWords", "decisions", "rulings", "boundaries", "openGuesses"].sort();

describe("both collectors normalize into the same Decided-context shape", () => {
  it("produces the identical five-field shape from a sheet and from a map", () => {
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0060-slug.md"], coinedTerms: ["Gate"], route: "short" };
    const sheetGh = fakeSheetGh("the owner's words", [sheetMarker(sheet()), acceptedMarker(payload)]);
    const { context: sheetContext } = collectSheetContext(sheetGh, 1);

    const repoRoot = scratchDir("shape-parity");
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
    const mapGh = mapTrackerGh(1, mapBody, { 9: ["a resolution comment"] });
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
