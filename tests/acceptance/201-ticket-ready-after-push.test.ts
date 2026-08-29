import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const acceptanceYml = path.join(repoRoot, ".github", "workflows", "acceptance.yml");

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

describe("#201 lane 04 first authoring — ordering into lane 05", () => {
  // - [ ] `ticket-ready` for a slice is sent after that slice's acceptance tests are on `main`, not before — check: `grep -q "ticket-ready" .github/workflows/acceptance.yml`
  it("`ticket-ready` for a slice is sent after that slice's acceptance tests are on `main`, not before", () => {
    expect(existsSync(acceptanceYml)).toBe(true);
    const yml = readFileSync(acceptanceYml, "utf8");

    // Lane 05 is told by lane 04, so the send lives in acceptance.yml at all.
    expect(yml, "acceptance.yml sends ticket-ready").toMatch(/ticket-ready/);

    const byJob = jobs(yml);
    const announcing = Object.entries(byJob).filter(([, text]) => text.includes("ticket-ready"));
    expect(announcing.length, "a job in acceptance.yml sends ticket-ready").toBeGreaterThan(0);

    for (const [name, text] of announcing) {
      // The tests are on main first: the push comes before the announcement, in
      // the same job, so lane 05 can never claim the slice ahead of its tests.
      const pushIdx = text.search(/\bpush\b/);
      const readyIdx = text.indexOf("ticket-ready");
      expect(pushIdx, `job ${name} pushes the acceptance tests`).toBeGreaterThan(-1);
      expect(pushIdx, `job ${name} pushes before it sends ticket-ready`).toBeLessThan(readyIdx);
    }
  });
});
