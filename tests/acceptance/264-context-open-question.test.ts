import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * #264's fifth acceptance criterion, verbatim from the ticket:
 *
 * - [ ] CONTEXT.md's open-question entry no longer claims a count reaches the owner — check: `! grep -q 'is the one thing that reaches the owner' CONTEXT.md`
 *
 * The glossary's **Open question** entry today ends its definition with "a non-zero count is the one
 * thing that reaches the owner". After this ruling nothing reaches the owner, and a glossary that
 * describes a removed mechanism is worse than none.
 *
 * The claim is asserted against whitespace-normalised text as well as against the raw file. In the
 * entry as it stands the sentence is wrapped mid-claim — "...is the one\nthing that reaches the
 * owner" — so a line-literal match alone would report the claim as already gone while the glossary
 * still makes it, word for word, to every reader. What the criterion is about is the claim, and a
 * claim survives a line wrap.
 */

const CONTEXT_PATH = path.join(repoRoot, "CONTEXT.md");
const CLAIM = "is the one thing that reaches the owner";

/** Whitespace collapsed, so a sentence that wrapped is still the sentence it was. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The glossary entry under `**Term**:` — every line from the heading to the next bolded term or the
 * next markdown heading. `null` when the glossary defines no such term.
 */
function glossaryEntry(text: string, term: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^\\*\\*${term}\\*\\*\\s*:`).test(line));
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\*\*[^*]+\*\*\s*:/.test(lines[i]) || /^#/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

describe("#264 — the glossary's open-question entry", () => {
  it("CONTEXT.md's open-question entry no longer claims a count reaches the owner — check: `! grep -q 'is the one thing that reaches the owner' CONTEXT.md`", () => {
    const context = readFileSync(CONTEXT_PATH, "utf8");

    const entry = glossaryEntry(context, "Open question");
    expect(
      entry,
      "CONTEXT.md defines no **Open question** entry — the ticket corrects that entry, so it is " +
        "still expected to be there",
    ).not.toBeNull();

    expect(
      flat(entry ?? "").includes(CLAIM),
      `the **Open question** entry still claims a count "${CLAIM}", which nothing does after the ` +
        "loop is removed",
    ).toBe(false);

    expect(
      flat(context).includes(CLAIM),
      `CONTEXT.md still says "${CLAIM}" somewhere in its text`,
    ).toBe(false);

    // The criterion's own check is a line-literal grep; it is the weaker of the two reads and is
    // asserted as well so a correction cannot satisfy the claim above and still fail the command.
    const offending = context.split("\n").filter((line) => line.includes(CLAIM));
    expect(offending, "a line of CONTEXT.md carries the claim verbatim").toEqual([]);
  });
});
