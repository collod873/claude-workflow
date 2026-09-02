import { describe, expect, it } from "vitest";
import { ENROLMENT_DOC_RELATIVE, enrolmentDoc } from "./327-enrol.fixture";

/**
 * The text around each mention of the timing baseline — 400 characters either side of every
 * occurrence, joined.
 *
 * A window rather than a sentence or a paragraph because the document's shape is the writer's to
 * choose: the claim may land as one sentence, as two, or as a bullet under a heading, and a reader
 * that demanded one of those would be pinning something the ticket left open. What the criterion is
 * about is that the two facts are said where a reader of the timing baseline finds them.
 */
function aroundTimingBaseline(doc: string): string {
  const windows: string[] = [];
  const mention = /timing baseline/gi;
  let found = mention.exec(doc);
  while (found !== null) {
    windows.push(doc.slice(Math.max(0, found.index - 400), found.index + 400));
    found = mention.exec(doc);
  }
  return windows.join("\n---\n");
}

/** A target owing nothing before its first run, however the sentence spells the absence. */
const OWES_NONE =
  /(owes?\s+no|owe\s+no|does\s+not\s+owe|doesn't\s+owe|need(s)?\s+no|carries\s+no|has\s+no|brings\s+no|arrives?\s+with\s+no|no\s+baseline|no\s+timing\s+baseline|none\s+of\s+its\s+own|nothing\s+of\s+its\s+own|not\s+required|without)/i;

/**
 * The enrolment document owes one sentence about this, because a target's first baseline arriving
 * with its first lane 05 run is otherwise the kind of thing the next enrolment relearns from a
 * green run that refused nothing.
 *
 * The document is read as text — the criterion's own check is a `grep` over it, and so is this.
 */
describe("docs/agents/enrolment.md", () => {
  // `docs/agents/enrolment.md` says a target's first timing baseline arrives with its first lane
  // 05 run, and that it owes no baseline of its own before that — check:
  // `grep -q 'timing baseline' docs/agents/enrolment.md`
  it("says the first timing baseline arrives with the first lane 05 run, and none is owed before", () => {
    const doc = enrolmentDoc();

    // The criterion's own check is `grep -q 'timing baseline'`, so the phrase is matched as it
    // spells it.
    expect(
      doc.includes("timing baseline")
        ? "the document says `timing baseline`"
        : `${ENROLMENT_DOC_RELATIVE} never says \`timing baseline\` (${doc.length} characters)`,
    ).toBe("the document says `timing baseline`");

    const passage = aroundTimingBaseline(doc);

    expect(
      /\b05\b/.test(passage)
        ? "the passage names lane 05"
        : `nothing said about the timing baseline names lane 05:\n${passage}`,
    ).toBe("the passage names lane 05");

    expect(
      OWES_NONE.test(passage)
        ? "the passage says none is owed before that"
        : `nothing said about the timing baseline says a target owes none before its first lane 05 run:\n${passage}`,
    ).toBe("the passage says none is owed before that");
  });
});
