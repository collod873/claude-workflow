/**
 * `CODING_STANDARDS.md` and `eslint.config.js`, read as data.
 *
 * Two lanes need the same two answers and neither can afford to guess at
 * them: the ratifier appends an entry and has to know the file's own shape,
 * and the revert detector (`./revert-detector.ts`) asks "is what this record
 * says landed still in the tree?" — which is the entry names present and the
 * lint rule ids turned on, and nothing else. The standing acceptance test
 * for `RATIFIER_CRITERION` (`./land.ts`) asks the same two questions of the
 * same two files; since #360 it lives beside its subject like any other test,
 * so it may import this module rather than carry its own copy of the parse.
 */

/** The heading the entries live under — nothing above it is a standard. */
const STANDARDS_HEADING = "## Standards";

/** `- **Name** — what.` — the first of the three lines `CODING_STANDARDS.md`'s header specifies. */
const ENTRY_HEAD = /^- \*\*(.+?)\*\*\s+[—-]\s+(.+)$/;
/** The two continuation lines, each indented under the head. */
const ENTRY_WHY = /^\s+Why:\s*(.+)$/;
const ENTRY_RED_FLAG = /^\s+Red flag:\s*(.+)$/;

/** One `CODING_STANDARDS.md` entry, in the three-line shape its own header specifies. */
export interface StandardEntry {
  /** The **Name** — the identity `landedAs` carries and the revert detector matches on. */
  name: string;
  what: string;
  why: string;
  redFlag: string;
}

/**
 * Every entry under `## Standards`, in file order. A head line whose two
 * continuation lines are not both present is not an entry — it is a
 * half-written one, and reporting it as a standard would let the revert
 * detector treat a malformed append as a landed standard.
 */
export function parseStandardEntries(markdown: string): StandardEntry[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === STANDARDS_HEADING);
  if (start === -1) return [];

  const entries: StandardEntry[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const head = ENTRY_HEAD.exec(lines[i]);
    if (!head) continue;
    const why = ENTRY_WHY.exec(lines[i + 1] ?? "");
    const redFlag = ENTRY_RED_FLAG.exec(lines[i + 2] ?? "");
    if (!why || !redFlag) continue;
    entries.push({ name: head[1], what: head[2], why: why[1], redFlag: redFlag[1] });
  }
  return entries;
}

/**
 * `markdown` with `entry` appended to the end of the `## Standards` section —
 * the flat list the file's own header asks for, grown at the bottom.
 *
 * Throws when the heading is absent rather than inventing one: a
 * `CODING_STANDARDS.md` with no `## Standards` is a file this lane does not
 * understand, and appending to the end of it would put a standard somewhere
 * no reader of the format looks.
 */
export function appendStandardEntry(markdown: string, entry: string): string {
  if (!markdown.split("\n").some((line) => line.trim() === STANDARDS_HEADING)) {
    throw new Error(`CODING_STANDARDS.md carries no "${STANDARDS_HEADING}" heading to append an entry under`);
  }
  const body = markdown.replace(/\s*$/, "");
  return `${body}\n${entry.replace(/^\s*\n/, "").replace(/\s*$/, "")}\n`;
}

/** One element of a flat eslint config, in the shape this module reads. */
interface FlatConfigElement {
  rules?: Record<string, unknown>;
}

/** A severity that means the rule is off — the two spellings eslint accepts. */
function isOff(severity: unknown): boolean {
  const level = Array.isArray(severity) ? severity[0] : severity;
  return level === "off" || level === 0;
}

/**
 * Every rule id the config actually turns on, across all its elements.
 *
 * "Turned on" rather than "declared", because that is the question the revert
 * detector asks: a rule the owner reverted is gone from the tree, and a rule
 * the owner switched off is a rule that no longer enforces anything — the two
 * are the same decision expressed two ways, and only one mechanical rule
 * should have to cover both.
 */
export function enabledRuleIds(config: readonly FlatConfigElement[]): Set<string> {
  const ids = new Set<string>();
  for (const element of config) {
    for (const [id, severity] of Object.entries(element.rules ?? {})) {
      if (!isOff(severity)) ids.add(id);
    }
  }
  return ids;
}
