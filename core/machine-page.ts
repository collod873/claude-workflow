import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Part } from "./parts.ts";

const SIGNED_PAGES: Record<string, string> = {
  "docs/agents/charter.md": "charter",
  "docs/agents/layers/one-ticket.md": "one ticket",
};
const HEADLINE_WIDTH = 72;

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

export function machinePage(registry: Part[], rules: SignedRule[]): string {
  const enforcers = (rule: SignedRule) => registry.filter((part) => part.holds?.includes(rule.text)).map((part) => part.name);
  const enforced = rules.filter((rule) => enforcers(rule).length > 0);
  const nameWidth = Math.max(0, ...registry.map((part) => part.name.length));
  return [
    `The New core: ${registry.length} parts, ${enforced.length} of ${rules.length} signed rules enforced`,
    "",
    "Parts, and the failure each stops",
    ...registry.map((part) => `  ${part.name.padEnd(nameWidth)}  ${part.stops.replace("https://github.com/collod873/", "")}${part.lines ? `  (${part.lines} lines)` : ""}`),
    "",
    "Enforced",
    ...enforced.map((rule) => `  ${headline(rule)}  ← ${enforcers(rule).join(", ")}`),
    "",
    "NOT ENFORCED YET",
    ...rules.filter((rule) => enforcers(rule).length === 0).map((rule) => `  ${headline(rule)}`),
  ].join("\n");
}
