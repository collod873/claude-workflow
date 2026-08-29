import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const acceptanceYml = path.join(repoRoot, ".github", "workflows", "acceptance.yml");

/** The block under a top-level `key:` — every following line indented past column 0. */
function topLevelBlock(yml: string, key: string): string | null {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

/** The block under a nested `key:` — every following line indented past that key. */
function nestedBlock(text: string, key: string): string | null {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*:`).test(l));
  if (idx === -1) return null;
  const indent = (lines[idx].match(/^\s*/) as RegExpMatchArray)[0].length;
  const body: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if ((line.match(/^\s*/) as RegExpMatchArray)[0].length <= indent) break;
    body.push(line);
  }
  return body.join("\n");
}

describe("#201 lane 04 first authoring — trigger", () => {
  // - [ ] `acceptance.yml` fires on a `repository_dispatch` type sent once per published slice, alongside its existing `issues: edited` re-fire, and names that type at `on:` (ADR-0090) — check: `grep -A3 "repository_dispatch:" .github/workflows/acceptance.yml | grep -q "types:"`
  it("`acceptance.yml` fires on a `repository_dispatch` type sent once per published slice, alongside its existing `issues: edited` re-fire, and names that type at `on:` (ADR-0090)", () => {
    expect(existsSync(acceptanceYml)).toBe(true);
    const yml = readFileSync(acceptanceYml, "utf8");

    const on = topLevelBlock(yml, "on");
    expect(on, "acceptance.yml has an `on:` block").not.toBeNull();

    // The new first-authoring trigger, with its type named at `on:` rather than
    // matched inside a job condition.
    const dispatch = nestedBlock(on as string, "repository_dispatch");
    expect(dispatch, "`on:` declares repository_dispatch").not.toBeNull();

    const types = nestedBlock(dispatch as string, "types");
    expect(types, "repository_dispatch declares `types:`").not.toBeNull();
    const named = (types as string)
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").replace(/["']/g, "").trim())
      .filter((l) => l.length > 0);
    expect(named.length, "at least one dispatch type is named at `on:`").toBeGreaterThan(0);

    // One request per published slice: repository_dispatch carries the slice in
    // client_payload, so the workflow has to read it.
    expect(yml).toMatch(/client_payload/);

    // The existing issues: edited re-fire survives alongside it.
    const issues = nestedBlock(on as string, "issues");
    expect(issues, "`on:` still declares issues").not.toBeNull();
    expect(issues as string).toMatch(/edited/);
  });
});
