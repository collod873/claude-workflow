import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * The wiring acceptance test #56 opened with:
 *
 *   grep -rn "runObservations\|computeReleaseScope\|composeRelease" --exclude-dir=node_modules .
 *
 * — every hit outside a `.test.ts` file was the definition itself. Spec #63 built the connector;
 * this generalises that grep to every export under this directory rather than three names picked
 * by hand, so a future export that lands unwired fails the same way those three did.
 *
 * A "caller" is any reference to the export other than its own declaration, anywhere except its
 * own colocated test file — that file always calls what it tests, so a reference there proves
 * nothing about wiring. A reference in the *defining* file counts (a CLI entrypoint's own
 * `process.argv` guard calling the function it exports for testability is real wiring), and so
 * does a reference in a sibling module's test (`run-audit.test.ts` driving `runObservations`
 * through a fake is also real wiring, just exercised from a test).
 */

const OBSERVATIONS_DIR = dirname(fileURLToPath(import.meta.url));

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Basename with `.test.ts`/`.ts` stripped — pairing is by stem, not directory, because #69 moved
 * the lens parsers into `lenses/` while their tests stayed at the top level
 * (`lenses/violation.ts` pairs with `violation.test.ts`, not a nonexistent `lenses/violation.test.ts`). */
function stem(path: string): string {
  const base = path.split("/").pop()!;
  return base.endsWith(".test.ts") ? base.slice(0, -".test.ts".length) : base.slice(0, -".ts".length);
}

const allFiles = listTsFiles(OBSERVATIONS_DIR);
const testFiles = allFiles.filter((f) => f.endsWith(".test.ts"));
const sourceFiles = allFiles.filter((f) => !f.endsWith(".test.ts"));
const ownTestFileByStem = new Map(testFiles.map((f) => [stem(f), f]));

interface ParsedFile {
  path: string;
  source: ts.SourceFile;
}

function parse(path: string): ParsedFile {
  return {
    path,
    source: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true),
  };
}

const parsedFiles = allFiles.map(parse);

interface ExportedSymbol {
  name: string;
  file: string;
  declaration: ts.Node;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function collectExports(parsed: ParsedFile): ExportedSymbol[] {
  const found: ExportedSymbol[] = [];
  for (const stmt of parsed.source.statements) {
    if (!isExported(stmt)) continue;
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
      found.push({ name: stmt.name.text, file: parsed.path, declaration: stmt.name });
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      found.push({ name: stmt.name.text, file: parsed.path, declaration: stmt.name });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          found.push({ name: decl.name.text, file: parsed.path, declaration: decl.name });
        }
      }
    }
  }
  return found;
}

/** Counts identifier occurrences of `name` in `source`, skipping `excludeNode` (the export's own
 * declaration-name node) so the declaration site never counts as its own caller. */
function countReferences(source: ts.SourceFile, name: string, excludeNode: ts.Node | undefined): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && node !== excludeNode) {
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

function hasCallerOutsideOwnTest(symbol: ExportedSymbol): boolean {
  const ownTest = ownTestFileByStem.get(stem(symbol.file));
  return parsedFiles.some((parsed) => {
    if (parsed.path === ownTest) return false;
    const excludeNode = parsed.path === symbol.file ? symbol.declaration : undefined;
    return countReferences(parsed.source, symbol.name, excludeNode) > 0;
  });
}

describe("observations/ wiring", () => {
  it("has a caller outside its own test file for every export", () => {
    const exportsFound = parsedFiles
      .filter((p) => sourceFiles.includes(p.path))
      .flatMap(collectExports);

    expect(exportsFound.length).toBeGreaterThan(0);

    const unwired = exportsFound
      .filter((symbol) => !hasCallerOutsideOwnTest(symbol))
      .map((symbol) => `${symbol.file.slice(OBSERVATIONS_DIR.length + 1)}: ${symbol.name}`);

    expect(unwired, unwired.join("\n")).toEqual([]);
  });
});
