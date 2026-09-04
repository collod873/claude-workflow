import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./repo-sources";

const STANDARDS_HEADING = "## Standards";
export const STANDARDS_FILE = "CODING_STANDARDS.md";

const ENTRY_HEAD = /^- \*\*(.+?)\*\*(?::|\s+[—-])\s+(.+)$/;
const ENTRY_WHY = /^\s+Why:\s*(.+)$/;
const ENTRY_RED_FLAG = /^\s+Red flag:\s*(.+)$/;

export interface StandardEntry {
  name: string;
  what: string;
  why: string;
  redFlag: string;
}

export function readStandards(repoDir: string = REPO_ROOT): string {
  return readFileSync(join(repoDir, STANDARDS_FILE), "utf8");
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

export function renderStandardsSection(markdown: string): string {
  const entries = parseStandardEntries(markdown);
  if (entries.length === 0) return "(none)";
  return entries
    .map((entry) => `- **${entry.name}**: ${entry.what}\n  Why: ${entry.why}\n  Red flag: ${entry.redFlag}`)
    .join("\n\n");
}
