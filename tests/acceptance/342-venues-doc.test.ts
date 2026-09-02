import path from "node:path";
import { describe, expect, it } from "vitest";
import { presence, readIfPresent } from "./327-enrol.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * #342's sixth criterion: the venue documentation stops leaving the committed file's writer
 * unnamed — its table says the push-venue run is what writes it.
 *
 * A claim about a document is asserted on the document's text, which is also what the criterion's
 * own `grep -q 'push venue' docs/agents/venues.md` does. The literal phrase is asserted exactly,
 * because that is the string the check matches; the rest is asserted tolerantly — that the file
 * still carries a table at all, that some line names the push venue as a writer, and that the doc
 * speaks of the committed file. How the row is worded, which column it sits in and what the table's
 * headings are is the writer's to choose, and pinning any of it would be a demand the implementer
 * cannot read out of the criterion.
 *
 * A missing file is caught first, so an absent `venues.md` fails on its own absence rather than
 * throwing on the read.
 */

const RELATIVE = "docs/agents/venues.md";
const VENUES_DOC = path.join(repoRoot, "docs", "agents", "venues.md");

describe("#342 the venue doc names the committed file's writer", () => {
  // `docs/agents/venues.md`'s table names the push-venue run as the committed file's writer —
  it("so a reader of the doc can tell which run writes the committed baseline", () => {
    expect(presence(RELATIVE, VENUES_DOC)).toBe("present");

    const text = readIfPresent(VENUES_DOC);

    // The criterion's own check, matched byte for byte.
    expect(text).toContain("push venue");

    const rows = text.split("\n").filter((line) => line.trim().startsWith("|"));
    const tableReport =
      rows.length > 0 ? "" : `${RELATIVE} carries no table for the push venue to be named in`;
    expect(tableReport).toBe("");

    const naming = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /push/i.test(line) && /\bwrit\w*/i.test(line));
    const writerReport =
      naming.length > 0
        ? ""
        : `no line of ${RELATIVE} names the push venue as a writer; its rows are: ${
            rows.length === 0 ? "(none)" : rows.join(" / ")
          }`;
    expect(writerReport).toBe("");

    expect(text).toMatch(/commit/i);
  });
});
