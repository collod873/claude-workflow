import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../../shared/marker";
import { scratchDir } from "../../shared/scratch.fixture";
import { sheet } from "../../shared/sheet.fixture";
import { collectMapContext } from "./map";
import { collectSheetContext } from "./sheet";
import { test } from "vitest";
import { trackerGh } from "../../shared/tracker-gh";
import { trackerMemory } from "../../shared/tracker-memory";
import { createIssueGh } from "../gh.fake";

const DECIDED_CONTEXT_KEYS = ["ownerWords", "decisions", "rulings", "boundaries", "openGuesses"].sort();

describe("both collectors normalize into the same Decided-context shape", () => {
  it("produces the identical five-field shape from a sheet and from a map", () => {
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0060-slug.md"], coinedTerms: ["Gate"], route: "short" };
    const sheetTracker = trackerMemory({
      issues: { 1: { body: "the owner's words", comments: [sheetMarker(sheet()), acceptedMarker(payload)] } },
    });
    const { context: sheetContext } = collectSheetContext(sheetTracker, 1);

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
    const mapTracker = trackerMemory({ issues: { 1: { body: mapBody }, 9: { comments: ["a resolution comment"] } } });
    const mapContext = collectMapContext(mapTracker, 1, repoRoot);

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

test("#615.5: collectMapContext still produces the five-field Decided-context shape when read through a Tracker", () => {
  const repoRoot = scratchDir("shape-parity-tracker");
  mkdirSync(join(repoRoot, "docs/adr"), { recursive: true });
  writeFileSync(join(repoRoot, "docs/adr/0100-slug.md"), "# A ruling\n\nThe durable text.");
  const body = [
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
  const { gh } = createIssueGh((fields) =>
    fields === "body"
      ? JSON.stringify({ body })
      : fields === "comments"
        ? JSON.stringify({ comments: [{ body: "a resolution comment" }] })
        : undefined,
  );
  const tracker = trackerGh(gh) as unknown as Parameters<typeof collectMapContext>[0];

  const context = collectMapContext(tracker, 1, repoRoot);

  expect(Object.keys(context).sort()).toEqual(DECIDED_CONTEXT_KEYS);
});

test(
  "#616.3: collectSheetContext, migrated onto Tracker, still produces the five-field Decided-context shape when read through trackerMemory",
  () => {
    const payload: AcceptedPayload = { adrPaths: ["docs/adr/0061-slug.md"], coinedTerms: ["Gate"], route: "short" };
    const tracker = trackerMemory({
      issues: {
        1: { body: "the owner's words", comments: [sheetMarker(sheet()), acceptedMarker(payload)] },
      },
    });

    const { context } = collectSheetContext(tracker as unknown as Parameters<typeof collectSheetContext>[0], 1);

    expect(Object.keys(context).sort()).toEqual(DECIDED_CONTEXT_KEYS);
    expect(context.ownerWords).toBe("the owner's words");
  },
);
