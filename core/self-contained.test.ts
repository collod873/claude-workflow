import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const CODE = /\.(m|c)?(t|j)sx?$/;
const REPO = resolve(import.meta.dirname, "..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function leavesCore(repo: string, file: string, specifier: string): boolean {
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) return false;
  const target = relative(join(repo, "core"), resolve(dirname(file), specifier));
  return target === "" || target === ".." || target.startsWith(".." + sep);
}

function importsOutsideCore(repo: string): string[] {
  return filesUnder(join(repo, "core"))
    .filter((file) => CODE.test(file))
    .flatMap((file) =>
      ts
        .preProcessFile(readFileSync(file, "utf8"), true, true)
        .importedFiles.map(({ fileName }) => fileName)
        .filter((specifier) => leavesCore(repo, file, specifier))
        .map((specifier) => `${relative(repo, file)} imports ${specifier}`),
    );
}

describe("the machine is all of core/ and nothing outside it (ADR-0200)", () => {
  const copies: string[] = [];

  afterEach(() => {
    for (const copy of copies.splice(0)) rmSync(copy, { recursive: true, force: true });
  });

  it("reads core/ at all, so an empty scan can never pass by accident", () => {
    expect(filesUnder(join(REPO, "core"))).toContain(join(REPO, "core", "self-contained.test.ts"));
  });

  it("finds no import in core/ that resolves outside core/", () => {
    expect(importsOutsideCore(REPO)).toEqual([]);
  });

  it.each([
    ["an import from a sibling folder", "core/planted.ts", "../.Workflow/agent-workflows/shared/reason.ts", 'import { reason } from "%s";\n'],
    ["a require from a session hook", "core/nested/planted.js", "../../.claude/hooks/roster.json", 'const roster = require("%s");\n'],
    ["a re-export from a repo script", "core/planted.ts", "../bin/land", 'export * from "%s";\n'],
    ["a dynamic import of the repo root", "core/planted.ts", "..", 'await import("%s");\n'],
    ["an import of a folder nobody has added yet", "core/planted.ts", "../vendor/thing.ts", 'import "%s";\n'],
  ])("fails naming the file when a copy of core/ holds %s", (_, planted, specifier, form) => {
    const copy = mkdtempSync(join(tmpdir(), "self-contained-"));
    copies.push(copy);
    cpSync(join(REPO, "core"), join(copy, "core"), { recursive: true });
    mkdirSync(join(copy, dirname(planted)), { recursive: true });
    writeFileSync(join(copy, planted), form.replace("%s", specifier));

    expect(importsOutsideCore(copy)).toEqual([`${planted} imports ${specifier}`]);
  });
});
