import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GhExec } from "../../shared/gh";
import type { DecidedContext } from "../spec";

/**
 * Lane 02's collector for the closed-map trigger (ADR-0058, ADR-0059): reads
 * one *Decided context* out of a closed Wayfinder Map, the same five-field
 * shape every trigger's collector assembles for the spec author.
 *
 * **Already ruled, one level down.** `to-spec/SKILL.md` already walks a map
 * this way for a human: *"follow it one level: fetch each linked issue…
 * prefer the durable record its gist names (e.g. an ADR) over its resolution
 * comment; fall back to the resolution comment only where the gist names no
 * durable record."* This collector reproduces exactly that walk rather than
 * inventing a second one — the map's own `## Decisions so far` section is
 * the index (`wayfinder/SKILL.md`'s own words: *"the map never restates
 * [a decision], only gists it and links"*), each line
 * `- [<closed ticket title>](link): <one-line gist of the answer>`.
 *
 * **Why the durable record wins.** ADR-0058 measured this precedence
 * elsewhere and found the binding constraint is double-reading, not size:
 * once a resolution's gist names the ADR it filed, fetching the ticket's
 * resolution comment *too* is reading the same ruling twice at roughly
 * double the token cost. So a gist that names a durable record (a path
 * under `docs/adr/`) is read from that file directly; only a gist that
 * names none falls back to the linked ticket's resolution comment.
 */

interface DecisionEntry {
  title: string;
  issueNumber: number;
  gist: string;
}

const DURABLE_RECORD_RE = /docs\/adr\/[\w.-]+\.md/;
const ISSUE_NUMBER_RE = /(?:\/issues\/|#)(\d+)/;
const DECISION_LINE_RE = /^-\s*\[([^\]]+)\]\(([^)]+)\):\s*(.*)$/;

function issueBody(gh: GhExec, issueNumber: number): string {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "body"]);
  return (JSON.parse(raw) as { body?: string }).body ?? "";
}

interface RawComment {
  body?: string;
}

/**
 * The resolution comment on one closed ticket — the first comment on it,
 * per `wayfinder/SKILL.md`'s "Work through the map": the resolution comment
 * is posted before the checker's closing record, which is "a separate
 * comment... with a different author and a different job."
 */
function resolutionComment(gh: GhExec, issueNumber: number): string {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  const comments = parsed.comments ?? [];
  return comments[0]?.body ?? "";
}

/** The body between one `## <heading>` line and the next, trimmed. Empty when the heading is absent. */
function extractSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return "";

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const section = end === -1 ? rest : rest.slice(0, end);
  return section.join("\n").trim();
}

/** Every `- [title](link): gist` line in a `## Decisions so far` section. */
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

/** The rulings text for one decision: its durable record when its gist names one, else its resolution comment. */
function rulingFor(gh: GhExec, repoRoot: string, entry: DecisionEntry): string {
  const durablePath = DURABLE_RECORD_RE.exec(entry.gist)?.[0];
  if (durablePath) {
    const record = readFileSync(join(repoRoot, durablePath), "utf8");
    return `${entry.title} — durable record (${durablePath}):\n${record}`;
  }

  const comment = resolutionComment(gh, entry.issueNumber);
  return `${entry.title} — resolution comment (its gist names no durable record):\n${comment}`;
}

/**
 * Assembles the Decided context for one closed map.
 *
 * Throws when the map carries no `## Decisions so far` entries — a map with
 * nothing decided is not this trigger's job to guess at.
 *
 * `repoRoot` defaults to the working directory: the pipeline runs inside a
 * checkout of the repo whose `docs/adr/` a durable record lives under, the
 * same assumption `generate-corpus-fixture.ts`'s ADR reader makes.
 */
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
