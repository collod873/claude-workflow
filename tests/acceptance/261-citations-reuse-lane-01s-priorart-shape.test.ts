import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSource, SWEEP_SOURCE } from "./261-spec-sweep.fixture";

/**
 * #261, criterion 6.
 *
 * `grep -q 'sweep-schema'` is satisfied by a comment, so this asserts what the criterion means:
 * that the string is a module specifier the sweep actually reads its citation shape from, that the
 * module it names exists in this checkout, and that whatever names the sweep pulls out of it are
 * names that module exports. A second format would have nothing to import.
 */

/** Every `import`/`export … from "…sweep-schema…"` in the source, with its clause and specifier. */
function schemaImports(source: string): Array<{ clause: string; specifier: string }> {
  const pattern = /(?:import|export)\s+([^"';]*?)\s*from\s*["']([^"']*sweep-schema[^"']*)["']/g;
  const found: Array<{ clause: string; specifier: string }> = [];
  for (const match of source.matchAll(pattern)) {
    found.push({ clause: match[1] ?? "", specifier: match[2] });
  }
  return found;
}

/** The names a `{ A, type B as C }` clause binds, or `[]` when the clause names none. */
function importedNames(clause: string): string[] {
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces === null) return [];
  return braces[1]
    .split(",")
    .map((entry) => entry.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter((entry) => entry.length > 0);
}

/** The file a relative specifier resolves to from `sweep.ts`, `.ts` extension restored. */
function resolveFrom(specifier: string): string {
  const base = path.resolve(path.dirname(SWEEP_SOURCE), specifier.replace(/\.js$/, ""));
  return existsSync(base) ? base : `${base}.ts`;
}

describe("#261 — the sweep's citation shape", () => {
  // Citations reuse lane 01's PriorArt shape rather than a second format — check: `grep -q 'sweep-schema' .Workflow/agent-workflows/spec/sweep.ts`
  it("names sweep-schema in sweep.ts", () => {
    expect(readSource(SWEEP_SOURCE)).toContain("sweep-schema");
  });

  // Citations reuse lane 01's PriorArt shape rather than a second format — check: `grep -q 'sweep-schema' .Workflow/agent-workflows/spec/sweep.ts`
  it("reads its citation shape out of lane 01's own sweep-schema module", () => {
    const source = readSource(SWEEP_SOURCE);
    const imports = schemaImports(source);

    expect(
      imports.length,
      "sweep.ts names no module specifier containing sweep-schema",
    ).toBeGreaterThan(0);

    for (const { clause, specifier } of imports) {
      const file = resolveFrom(specifier);
      expect(existsSync(file), `${specifier} resolves to nothing at ${file}`).toBe(true);

      const schema = readFileSync(file, "utf8");
      const exported = schema
        .split("\n")
        .filter((line) => line.includes("export"))
        .join("\n");

      for (const name of importedNames(clause)) {
        expect(exported, `${file} exports no ${name}`).toContain(name);
      }
    }
  });
});
