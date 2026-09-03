const STANDARDS_HEADING = "## Standards";

const ENTRY_HEAD = /^- \*\*(.+?)\*\*\s+[—-]\s+(.+)$/;
const ENTRY_WHY = /^\s+Why:\s*(.+)$/;
const ENTRY_RED_FLAG = /^\s+Red flag:\s*(.+)$/;

export interface StandardEntry {
  name: string;
  what: string;
  why: string;
  redFlag: string;
}

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

export function appendStandardEntry(markdown: string, entry: string): string {
  if (!markdown.split("\n").some((line) => line.trim() === STANDARDS_HEADING)) {
    throw new Error(`CODING_STANDARDS.md carries no "${STANDARDS_HEADING}" heading to append an entry under`);
  }
  const body = markdown.replace(/\s*$/, "");
  return `${body}\n${entry.replace(/^\s*\n/, "").replace(/\s*$/, "")}\n`;
}

interface FlatConfigElement {
  rules?: Record<string, unknown>;
}

function isOff(severity: unknown): boolean {
  const level = Array.isArray(severity) ? severity[0] : severity;
  return level === "off" || level === 0;
}

export function enabledRuleIds(config: readonly FlatConfigElement[]): Set<string> {
  const ids = new Set<string>();
  for (const element of config) {
    for (const [id, severity] of Object.entries(element.rules ?? {})) {
      if (!isOff(severity)) ids.add(id);
    }
  }
  return ids;
}
