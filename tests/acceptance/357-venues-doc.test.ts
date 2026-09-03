import { describe, expect, it } from "vitest";
import { readIfPresent } from "./275-checkpoint-wiring.fixture";
import {
  BUDGET_WORD,
  VENUES_DOC,
  VENUES_DOC_RELATIVE,
  linesMatching,
} from "./357-timing.fixture";

/**
 * #357, criterion 6 — the document a maintainer reads stops describing a number a venue can exceed.
 *
 * Two halves, and only two. The word is matched case-insensitively, line by line, exactly as the
 * criterion's own `grep -qi 'budget'` matches it. What the durations are *for* instead is left to
 * the implementer's prose, so the second half asks only that the document still talks about them —
 * demanding a particular sentence, or that it name the artefact by path, would be pinning something
 * the ticket does not say and the implementer cannot guess.
 */

/** What a document that explains the durations has to still be about. */
const DURATIONS = /duration|timing|wall[- ]?clock|how long/i;

describe("#357 docs/agents/venues.md", () => {
  // `docs/agents/venues.md` no longer tells a reader a venue has a budget it can exceed, and says
  it("gives no venue a budget it can exceed, and still says what the durations are for", () => {
    const doc = readIfPresent(VENUES_DOC);
    expect(doc.length, `${VENUES_DOC_RELATIVE} is not in the tree`).toBeGreaterThan(0);

    expect(
      linesMatching(doc, BUDGET_WORD),
      `${VENUES_DOC_RELATIVE} still tells a reader a venue has a budget`,
    ).toEqual([]);

    expect(
      DURATIONS.test(doc),
      `${VENUES_DOC_RELATIVE} no longer says anything about what a venue's durations are for`,
    ).toBe(true);
  });
});
