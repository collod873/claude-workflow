import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readWorkflows } from "./read-workflow";
import { readRepoText, REPO_ROOT } from "./repo-sources";

const NOTES_ADD = /"notes"[\s\S]{0,120}?"add"/;

const CONFIGURES_COMMITTER = /git config (--\S+ )?user\.email/;

function entrypointsOf(workflowSource: string): string[] {
  return [...workflowSource.matchAll(/npx tsx (\S+\.ts)/g)].map((match) => match[1]);
}

interface Binding {
  file: string;
  name: string;
}

interface Module {
  bindings: Map<string, Binding>;
  declarations: Map<string, ts.Node>;
  topLevel: ts.Node[];
}

const modules = new Map<string, Module | undefined>();

function loadModule(path: string): Module | undefined {
  if (modules.has(path)) return modules.get(path);

  const module = existsSync(path) ? parseModule(path) : undefined;
  modules.set(path, module);
  return module;
}

function parseModule(path: string): Module {
  const source = ts.createSourceFile(path, readRepoText(path), ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, Binding>();
  const declarations = new Map<string, ts.Node>();
  const topLevel: ts.Node[] = [];

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      recordImport(path, statement, bindings);
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
      }
      continue;
    }
    topLevel.push(statement);
  }

  return { bindings, declarations, topLevel };
}

function recordImport(fromPath: string, statement: ts.ImportDeclaration, bindings: Map<string, Binding>): void {
  const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
  if (!specifier.startsWith(".")) return; 

  const resolved = resolve(dirname(fromPath), specifier);
  const file = resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
  const clause = statement.importClause;
  if (!clause) return;

  if (clause.isTypeOnly) return;
  if (clause.name) bindings.set(clause.name.text, { file, name: "*" });

  const named = clause.namedBindings;
  if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, { file, name: "*" });
  if (named && ts.isNamedImports(named)) {
    for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      bindings.set(element.name.text, { file, name: (element.propertyName ?? element.name).text });
    }
  }
}

function identifiersIn(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) names.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function writesAGitNote(entry: string): boolean {
  const seen = new Set<string>();
  const queue: Binding[] = [{ file: join(REPO_ROOT, entry), name: "*" }];

  while (queue.length > 0) {
    const { file, name } = queue.shift()!;
    const key = `${file}#${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const module = loadModule(file);
    if (!module) continue;

    const reached =
      name === "*"
        ? [...module.topLevel, ...module.declarations.values()]
        : module.declarations.has(name)
          ? [module.declarations.get(name)!]
          : [];

    for (const node of reached) {
      if (NOTES_ADD.test(node.getFullText())) return true;
      for (const identifier of identifiersIn(node)) {
        const binding = module.bindings.get(identifier);
        if (binding) queue.push(binding);
        else if (module.declarations.has(identifier)) queue.push({ file, name: identifier });
      }
    }
  }

  return false;
}

const workflows = readWorkflows().map(({ name, source }) => ({ name, source }));

describe("every workflow that can reach `git notes add` configures a committer", () => {
  it.each(workflows)("$name", ({ name, source }) => {
    const writers = entrypointsOf(source).filter(writesAGitNote);
    if (writers.length === 0) return;

    expect(
      CONFIGURES_COMMITTER.test(source),
      `${name} runs ${writers.join(", ")}, which reaches \`git notes add\`, but configures no committer: ` +
        "a runner has no git identity, so that write will exit `fatal: empty ident name`",
    ).toBe(true);
  });

  it("actually finds the note writers, so a passing suite is not an empty sweep", () => {
    const reaching = workflows.filter(({ source }) => entrypointsOf(source).some(writesAGitNote));

    expect(reaching.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining(["audit.yml", "decline-on-revert.yml", "ratify-release.yml", "ratify.yml"]),
    );
  });

  it("does not mistake a workflow that writes no note for one that does", () => {
    const quiet = ["ratify-on-prd-close.yml", "dispatch-reconcile.yml"];

    for (const name of quiet) {
      const workflow = workflows.find((each) => each.name === name);
      expect(workflow, `${name} no longer exists, so this test's premise needs rechecking`).toBeDefined();
      expect(entrypointsOf(workflow!.source).some(writesAGitNote), `${name} now writes a git note`).toBe(false);
    }
  });
});
