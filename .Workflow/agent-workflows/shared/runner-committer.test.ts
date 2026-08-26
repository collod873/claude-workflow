import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * The guard #109 exists for.
 *
 * `git notes add` writes an object, an object carries a committer, and a
 * GitHub runner has no git identity — so a workflow that reaches that write
 * without configuring one dies on `empty ident name`, having already spent
 * the checkout and everything before it. `audit.yml` hit this on its very
 * first non-skipped run, after both lens passes had produced findings (#107).
 *
 * The fix there was a `git config` step in that file. It was correct and it
 * did not travel: `ratify-release.yml` reaches the same write by a different
 * entrypoint and carried the same defect, invisible because that lane has
 * never run either (#109). A test naming those two files would not have
 * travelled any further than the fix did.
 *
 * So this derives the question instead of listing the answer. It reads every
 * workflow, finds the entrypoint each one runs, walks out from that
 * entrypoint through the declarations it actually calls, and asks whether
 * any of them writes a git note. Whatever comes back yes must configure a
 * committer — including a workflow, an entrypoint, and a note writer that do
 * not exist yet.
 *
 * The walk follows *declarations*, not files. `release-on-prd-close.yml`
 * imports `readObservations` from the same module `writeObservationNote`
 * lives in; a file-level walk calls that lane a note writer and asks it for
 * a step it does not need. Importing a module is not calling every function
 * in it, and this guard is only worth having if it says the true thing about
 * every lane rather than the safe thing about all of them.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

/** `git notes … add`, as all three of this repo's note writers spell it (one argv array, one line). */
const NOTES_ADD = /"notes"[\s\S]{0,120}?"add"/;

/** A `git config user.email`, however the step around it is written. */
const CONFIGURES_COMMITTER = /git config (--\S+ )?user\.email/;

/** Every TypeScript entrypoint a workflow hands to `npx tsx`, repo-relative as the workflow spells it. */
function entrypointsOf(workflowSource: string): string[] {
  return [...workflowSource.matchAll(/npx tsx (\S+\.ts)/g)].map((match) => match[1]);
}

/** One name this module can reach in another: `readObservations` in `./notes`, as imported. */
interface Binding {
  file: string;
  name: string;
}

interface Module {
  /** Local identifier → where it actually comes from. Relative imports only. */
  bindings: Map<string, Binding>;
  /** Top-level declaration name → its node, so a reachable name can be read as code. */
  declarations: Map<string, ts.Node>;
  /** Everything not inside a declaration — a CLI's own `main()` call at the bottom of the file. */
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
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
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
  if (!specifier.startsWith(".")) return; // A package is not somewhere this repo's `git` seam is called.

  const resolved = resolve(dirname(fromPath), specifier);
  const file = resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
  const clause = statement.importClause;
  if (!clause) return;

  // `import type { X }` reaches nothing at runtime, and neither does a type-only specifier.
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

/** Every identifier `node` mentions — the crude form of "what this code can call". */
function identifiersIn(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) names.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

/**
 * Whether anything the run of `entry` can call writes a git note. Starts from
 * the entrypoint's whole module — a CLI runs its top-level — and follows only
 * the names that reachable code actually mentions.
 */
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

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({ name, source: readFileSync(join(WORKFLOWS_DIR, name), "utf8") }));

describe("every workflow that can reach `git notes add` configures a committer", () => {
  it.each(workflows)("$name", ({ name, source }) => {
    const writers = entrypointsOf(source).filter(writesAGitNote);
    if (writers.length === 0) return;

    // Named in the failure, so the reader learns which lane is about to die and on which write —
    // the two things `empty ident name` on a runner does not tell you.
    expect(
      CONFIGURES_COMMITTER.test(source),
      `${name} runs ${writers.join(", ")}, which reaches \`git notes add\`, but configures no committer — ` +
        "a runner has no git identity, so that write will exit `fatal: empty ident name`",
    ).toBe(true);
  });

  it("actually finds the note writers, so a passing suite is not an empty sweep", () => {
    const reaching = workflows.filter(({ source }) => entrypointsOf(source).some(writesAGitNote));

    // The check above is vacuously true for a workflow it finds nothing in, and a broken walk finds
    // nothing in all of them. These two are the lanes that write a note today; the assertion is
    // that the walk still sees them, not that they are the only ones it may ever see.
    expect(reaching.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining(["audit.yml", "ratify-release.yml"]),
    );
  });

  it("does not mistake a workflow that writes no note for one that does", () => {
    // `release-on-prd-close.yml` writes `refs/release/last` with `git update-ref`, which needs no
    // committer, and the close-gate lanes write no git object at all. A guard that flagged these
    // would be asking three workflows to carry a step none of them needs.
    const quiet = ["release-on-prd-close.yml", "close-gate.yml", "close-gate-reconcile.yml"];

    for (const name of quiet) {
      const workflow = workflows.find((each) => each.name === name);
      expect(workflow, `${name} no longer exists — this test's premise needs rechecking`).toBeDefined();
      expect(entrypointsOf(workflow!.source).some(writesAGitNote), `${name} now writes a git note`).toBe(false);
    }
  });
});
