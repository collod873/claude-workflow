import { parseStandardEntries, readStandards, STANDARDS_FILE } from "../shared/standards";

export { parseStandardEntries, readStandards, STANDARDS_FILE };

const STANDARDS_HEADING = "## Standards";

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
