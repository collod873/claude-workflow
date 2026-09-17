import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const OLD_MACHINE = [".Workflow", ".claude", "bin"];
const CODE = /\.(m|c)?(t|j)sx?$/;
const REPO = resolve(import.meta.dirname, "..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function reachesOldMachine(repo: string, file: string, specifier: string): boolean {
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) return false;
  const target = relative(repo, resolve(dirname(file), specifier));
  return OLD_MACHINE.some((root) => target === root || target.startsWith(root + sep));
}

function oldMachineImports(repo: string): string[] {
  return filesUnder(join(repo, "core"))
    .filter((file) => CODE.test(file))
    .flatMap((file) =>
      ts
        .preProcessFile(readFileSync(file, "utf8"), true, true)
        .importedFiles.map(({ fileName }) => fileName)
        .filter((specifier) => reachesOldMachine(repo, file, specifier))
        .map((specifier) => `${relative(repo, file)} imports ${specifier}`),
    );
}

describe("the New core never imports the Old machine (ADR-0200)", () => {
  const copies: string[] = [];

  afterEach(() => {
    for (const copy of copies.splice(0)) rmSync(copy, { recursive: true, force: true });
  });

  it("reads core/ at all, so an empty scan can never pass by accident", () => {
    expect(filesUnder(join(REPO, "core"))).toContain(join(REPO, "core", "old-machine-boundary.test.ts"));
  });

  it("finds no import from core/ into .Workflow/, .claude/ or bin/", () => {
    expect(oldMachineImports(REPO)).toEqual([]);
  });

  it.each([
    ["an import from .Workflow/", "core/planted.ts", "../.Workflow/agent-workflows/shared/reason.ts", 'import { reason } from "%s";\n'],
    ["a require from .claude/", "core/nested/planted.js", "../../.claude/hooks/roster.json", 'const roster = require("%s");\n'],
    ["a re-export from bin/", "core/planted.ts", "../bin/land", 'export * from "%s";\n'],
    ["a dynamic import of .Workflow/ itself", "core/planted.ts", "../.Workflow", 'await import("%s");\n'],
  ])("fails naming the file when a copy of core/ holds %s", (_, planted, specifier, form) => {
    const copy = mkdtempSync(join(tmpdir(), "core-boundary-"));
    copies.push(copy);
    cpSync(join(REPO, "core"), join(copy, "core"), { recursive: true });
    mkdirSync(join(copy, dirname(planted)), { recursive: true });
    writeFileSync(join(copy, planted), form.replace("%s", specifier));

    expect(oldMachineImports(copy)).toEqual([`${planted} imports ${specifier}`]);
  });
});
