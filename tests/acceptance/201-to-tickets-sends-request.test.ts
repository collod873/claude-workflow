import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const toTicketsDir = path.join(repoRoot, ".Workflow", "agent-workflows", "to-tickets");
const toTicketsYml = path.join(repoRoot, ".github", "workflows", "to-tickets.yml");
const dispatchRequest = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "dispatch-request.ts",
);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Second-level keys of `jobs:`, each mapped to its own block text. */
function jobs(yml: string): Record<string, string> {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => /^jobs\s*:/.test(l));
  if (start === -1) return {};
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const indents = body
    .filter((l) => l.trim() !== "")
    .map((l) => (l.match(/^\s*/) as RegExpMatchArray)[0].length);
  if (indents.length === 0) return {};
  const base = Math.min(...indents);
  const out: Record<string, string> = {};
  let current: string | null = null;
  for (const line of body) {
    const m = line.match(/^(\s*)([A-Za-z0-9_-]+)\s*:\s*$/);
    if (m && m[1].length === base) {
      current = m[2];
      out[current] = "";
      continue;
    }
    if (current) out[current] += line + "\n";
  }
  return out;
}

describe("#201 lane 04 first authoring — lane 03 asks for it", () => {
  // - [ ] Lane 03's `contents: write` dispatch job sends that request, one per slice, through `shared/dispatch-request.ts`; the model job writes it, never sends it (ADR-0091) — check: `grep -rq "acceptance-wanted" .Workflow/agent-workflows/to-tickets/`
  it("Lane 03's `contents: write` dispatch job sends that request, one per slice, through `shared/dispatch-request.ts`; the model job writes it, never sends it (ADR-0091)", () => {
    // The model job writes the request: lane 03's prompt/instruction files name it.
    const authored = walk(toTicketsDir).filter((f) =>
      readFileSync(f, "utf8").includes("acceptance-wanted"),
    );
    expect(
      authored.length,
      "a file under .Workflow/agent-workflows/to-tickets/ names the acceptance-wanted request",
    ).toBeGreaterThan(0);

    // One request per slice, not one per run.
    const perSlice = authored.some((f) => /per[- ]slice|one per slice|each slice|for each slice/i.test(readFileSync(f, "utf8")));
    expect(perSlice, "lane 03 is told to write one acceptance-wanted request per slice").toBe(true);

    // Sending goes through the shared helper, from the dispatch job only.
    expect(existsSync(dispatchRequest)).toBe(true);
    expect(existsSync(toTicketsYml)).toBe(true);
    const yml = readFileSync(toTicketsYml, "utf8");
    const byJob = jobs(yml);

    const senders = Object.entries(byJob).filter(([, text]) => text.includes("dispatch-request"));
    expect(senders.length, "a to-tickets.yml job sends through shared/dispatch-request.ts").toBeGreaterThan(0);
    for (const [name, text] of senders) {
      expect(text, `job ${name} sends dispatches, so it holds contents: write`).toMatch(
        /contents:\s*write/,
      );
    }
    expect(
      senders.some(([, text]) => /acceptance/.test(text)),
      "the dispatch job is what sends the acceptance request",
    ).toBe(true);
  });
});
