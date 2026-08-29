import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The workflow-reading helpers lane 04's authored tests share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one. `.fixture.ts` because that is the name
 * `knip.config.ts` already gives a file whose job is to be unreachable from a lane: wiring this to
 * one would mean a lane depending on the shape of its own acceptance tests, the coupling ADR-0032's
 * immutability rule exists to prevent.
 *
 * It exists because lane 04 writes **one test file per criterion**, and several criteria on the
 * same ticket ask about the same workflow. Authoring #201 the author wrote the same YAML block
 * reader three times, in three files, with three slightly different bugs — which `bin/clone-gate`
 * then reported as three clones. A shared reader is the fix for the duplication and, more to the
 * point, for the divergence: one parser has one behaviour to get right.
 *
 * These are deliberately small string readers rather than a YAML library. What the criteria assert
 * is the *text* a maintainer reads — a key that is quoted, a type named at `on:` rather than
 * matched in a job condition — and a parsed document has already thrown that away.
 */

/** The checkout root, from this file's own location. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A workflow file's absolute path, by its basename (`"acceptance.yml"`). */
export function workflowPath(name: string): string {
  return path.join(repoRoot, ".github", "workflows", name);
}

/**
 * The block under a top-level `key:` — every following line indented past column 0, `null` when
 * the key is absent.
 *
 * The key may be quoted. `acceptance.yml` writes `"on":` because YAML 1.1 reads a bare `on` as the
 * boolean `true`, and a matcher accepting only `on:` finds no trigger block in a file whose
 * triggers are all present — the first of #201's two wrong authored tests.
 */
export function topLevelBlock(yml: string, key: string): string | null {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^["']?${key}["']?\\s*:`).test(l));
  if (start === -1) return null;
  return indentedAfter(lines, start).join("\n");
}

/** Every line after `start` that is indented at all — a top-level key's whole block. */
function indentedAfter(lines: string[], start: number): string[] {
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body;
}

/** The block under a nested `key:` — every following line indented past that key. */
export function nestedBlock(text: string, key: string): string | null {
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

/**
 * The entries a `types:` line names, in either YAML form — the inline flow sequence
 * (`types: [acceptance-wanted]`, which every workflow here writes) or the block form of `- ` items
 * beneath it. Empty when `text` declares no `types:` at all.
 *
 * Both forms, because reading only the block form is #201's other wrong authored test: it found an
 * empty list where the dispatch type is plainly named.
 */
export function namedTypes(text: string): string[] {
  const line = text.split("\n").find((l) => /^\s*types\s*:/.test(l));
  if (line === undefined) return [];
  const inline = line.match(/\[(.*)\]/);
  const entries = inline
    ? inline[1].split(",")
    : (nestedBlock(text, "types") ?? "").split("\n").map((l) => l.replace(/^\s*-\s*/, ""));
  return entries.map((entry) => entry.replace(/["']/g, "").trim()).filter((entry) => entry.length > 0);
}

/**
 * Second-level keys of `jobs:`, each mapped to its own block text — comments dropped.
 *
 * Dropping them is load-bearing rather than tidy: this repo's workflows explain in prose, inside a
 * job, why some *other* job holds `contents: write`, and a matcher that reads comments cannot tell
 * the explanation from the declaration.
 */
export function jobs(yml: string): Record<string, string> {
  const lines = yml.split("\n").filter((l) => !/^\s*#/.test(l));
  const start = lines.findIndex((l) => /^jobs\s*:/.test(l));
  if (start === -1) return {};
  const body = indentedAfter(lines, start);
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
