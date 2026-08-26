import { RECORD_HEADING } from "./record-grammar";

/**
 * Builds a closing-record comment through one place, so a test names only
 * the part it is about. `CODING_STANDARDS.md`'s builder rule, applied to the
 * one shape this lane's tests would otherwise hand-roll in every case: a
 * grammar change then breaks one file instead of twenty, and a test that
 * spells out a heading, a range and three bullets to exercise a verdict
 * hides which of the four it is about.
 */
export interface RecordParts {
  /** The `base..head` line. Omit for the default; pass `null` to leave it out. */
  range?: string | null;
  /** One line per bullet, written without the leading `- `. */
  bullets?: string[];
  /**
   * Put `No diff.` where the range would go, keeping the bullets. The shape a
   * close carrying no commit takes — and the one that used to pass on its first
   * two words alone (#60), so the tests need to build it *with* bullets rather
   * than only as a whole-body replacement.
   */
  noDiff?: boolean;
  /** Replaces the whole body under the heading — for `No diff.` and friends. */
  instead?: string;
}

/** A record body with the heading stripped, as `mostRecentRecord` returns one. */
export function recordText(parts: RecordParts = {}): string {
  if (parts.instead !== undefined) {
    return `\n${parts.instead}\n`;
  }
  const range = parts.noDiff
    ? "No diff.\n\n"
    : parts.range === null
      ? ""
      : `\`${parts.range ?? "main..a1b2c3d"}\`\n\n`;
  const bullets = (parts.bullets ?? ["A criterion — MET: `src/thing.ts:12`"])
    .map((bullet) => `- ${bullet}`)
    .join("\n");
  return `\n${range}${bullets}\n`;
}

/** The same record as a whole comment, heading included. */
export function recordComment(parts: RecordParts = {}): string {
  return `${RECORD_HEADING}\n${recordText(parts)}`;
}

/** An issue body carrying `count` acceptance criteria. */
export function bodyWithCriteria(count: number): string {
  const items = Array.from({ length: count }, (_, i) => `- [ ] Criterion ${i + 1}`).join("\n");
  return `## What to build\nSomething.\n\n## Acceptance criteria\n${items}\n\n## Files claimed\n- src/thing.ts\n`;
}

/** The `<output>` block a salvage stage returns, wrapping `comment`. */
export function salvageResponse(comment: string): string {
  return `Reading the issue.\n\n<output>${JSON.stringify({ record: comment })}</output>`;
}
