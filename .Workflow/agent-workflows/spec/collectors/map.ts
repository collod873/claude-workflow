import { readFileSync } from "node:fs";
import { issueBody } from "../../shared/issue-body";
import { join } from "node:path";
import type { GhExec } from "../../shared/gh";
import type { DecidedContext } from "../author-contract";

interface DecisionEntry {
  title: string;
  issueNumber: number;
  gist: string;
}

const DURABLE_RECORD_RE = /docs\/adr\/[\w.-]+\.md/;
const ISSUE_NUMBER_RE = /(?:\/issues\/|#)(\d+)/;
const DECISION_LINE_RE = /^-\s*\[([^\]]+)\]\(([^)]+)\):\s*(.*)$/;

interface RawComment {
  body?: string;
}

function resolutionComment(gh: GhExec, issueNumber: number): string {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  const comments = parsed.comments ?? [];
  return comments[0]?.body ?? "";
}

function extractSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return "";

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const section = end === -1 ? rest : rest.slice(0, end);
  return section.join("\n").trim();
}

function parseDecisions(section: string): DecisionEntry[] {
  const entries: DecisionEntry[] = [];
  for (const line of section.split("\n")) {
    const match = DECISION_LINE_RE.exec(line.trim());
    if (!match) continue;
    const [, title, link, gist] = match;
    const issueMatch = ISSUE_NUMBER_RE.exec(link!);
    if (!issueMatch) continue;
    entries.push({ title: title!, issueNumber: Number(issueMatch[1]), gist: gist! });
  }
  return entries;
}

function rulingFor(gh: GhExec, repoRoot: string, entry: DecisionEntry): string {
  const durablePath = DURABLE_RECORD_RE.exec(entry.gist)?.[0];
  if (durablePath) {
    const record = readFileSync(join(repoRoot, durablePath), "utf8");
    return `${entry.title} — durable record (${durablePath}):\n${record}`;
  }

  const comment = resolutionComment(gh, entry.issueNumber);
  return `${entry.title} — resolution comment (its gist names no durable record):\n${comment}`;
}

export function collectMapContext(
  gh: GhExec,
  issueNumber: number,
  repoRoot: string = process.cwd(),
): DecidedContext {
  const body = issueBody(gh, issueNumber);

  const entries = parseDecisions(extractSection(body, "Decisions so far"));
  if (entries.length === 0) {
    throw new Error(`map collector: issue #${issueNumber} carries no Decisions so far entries`);
  }

  const decisions = entries.map((entry) => `- ${entry.title}\n  ${entry.gist}`).join("\n");
  const rulings = entries.map((entry) => rulingFor(gh, repoRoot, entry)).join("\n\n");
  const boundaries = extractSection(body, "Out of scope") || "None recorded.";
  const openGuesses = extractSection(body, "Not yet specified") || "None.";

  return { ownerWords: body, decisions, rulings, boundaries, openGuesses };
}
