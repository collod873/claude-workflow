import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAILURE_LINK } from "./part-links.ts";
import { parts, type Part } from "./parts.ts";

const SIGNED_PAGES: Record<string, string> = {
  "docs/agents/charter.md": "charter",
  "docs/agents/layers/one-ticket.md": "one ticket",
};
const HEADLINE_WIDTH = 72;
const COLUMNS = 2;
const HOME = "collod873/claude-workflow";

export interface SignedRule {
  page: string;
  text: string;
}

function rulesOn(page: string, markdown: string): SignedRule[] {
  const section = markdown.split(/^## /m).find((heading) => heading.startsWith("Rules")) ?? "";
  return section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((row) => ({ page, text: row.split("|")[1].trim() }));
}

export function signedRules(repo: string): SignedRule[] {
  return Object.keys(SIGNED_PAGES).flatMap((page) => rulesOn(page, readFileSync(join(repo, page), "utf8")));
}

function headline(rule: SignedRule): string {
  const first = rule.text.split(/\. |; /)[0];
  const clipped = first.length > HEADLINE_WIDTH ? `${first.slice(0, HEADLINE_WIDTH - 1)}…` : first;
  return `${SIGNED_PAGES[rule.page].padEnd(10)} ${clipped}`;
}

function stops(part: Part): string {
  const [, repo, kind, number] = FAILURE_LINK.exec(part.stops) ?? [];
  const where = repo === undefined ? part.stops : `${repo === HOME ? "" : `${repo.split("/")[1]} `}${kind === "actions/runs" ? `run ${number}` : kind === "pull" ? `PR ${number}` : `#${number}`}`;
  return `${where}${part.lines === undefined ? "" : ` (${part.lines} lines)`}`;
}

function inColumns(registry: Part[]): string[] {
  const nameWidth = Math.max(0, ...registry.map((part) => part.name.length));
  const listed = registry.map((part) => `${part.name.padEnd(nameWidth)}  ${stops(part)}`);
  const width = Math.max(0, ...listed.map((cell) => cell.length));
  const rows = Math.ceil(listed.length / COLUMNS);
  return Array.from({ length: rows }, (_, row) =>
    `  ${Array.from({ length: COLUMNS }, (_, column) => listed[row + column * rows])
      .filter((cell) => cell !== undefined)
      .map((cell) => cell.padEnd(width))
      .join("  ")
      .trimEnd()}`,
  );
}

export function machinePage(registry: Part[], rules: SignedRule[]): string {
  const enforcers = (rule: SignedRule) => registry.filter((part) => part.holds?.includes(rule.text)).map((part) => part.name);
  const enforced = rules.filter((rule) => enforcers(rule).length > 0);
  return [
    `The machine: ${registry.length} parts, ${enforced.length} of ${rules.length} signed rules enforced`,
    "",
    "Parts, and the failure each stops",
    ...inColumns(registry),
    "",
    "Enforced",
    ...enforced.map((rule) => `  ${headline(rule)}  ← ${enforcers(rule).join(", ")}`),
    "",
    "NOT ENFORCED YET",
    ...rules.filter((rule) => enforcers(rule).length === 0).map((rule) => `  ${headline(rule)}`),
  ].join("\n");
}

if (import.meta.main) {
  console.log(machinePage(parts, signedRules(join(import.meta.dirname, ".."))));
}
