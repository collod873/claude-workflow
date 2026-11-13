import { existsSync, readFileSync } from "node:fs";
import { join, matchesGlob, relative } from "node:path";
import ts from "typescript";
import { sha } from "./files.mjs";
import { parsedTsconfig } from "./tsconfig-guard.mjs";

const MODULE_SYNTAX = /^\s*(?:import|export)\b/m;
const AUGMENTS = /\bdeclare\s+(?:global|module)\b/;
const RESOLVES_EVERY_LOCAL_FILE = { allowJs: true, resolveJsonModule: true };
const SCRIPT = /\.[cm]?[jt]sx?$/;
const MAY_CROSS_CLIENT_BOUNDARY = /use client|\bexport\b[^;]*?\bfrom\b/;
const BARE_PACKAGE = /^(?![./]|node:)((?:@[^/]+\/)?[^/]+)/;

function compilerSetup(root) {
  const config = join(root, "tsconfig.json");
  if (!existsSync(config)) return { options: RESOLVES_EVERY_LOCAL_FILE, programFiles: [] };
  const parsed = parsedTsconfig(config);
  if (!parsed) throw new Error(`${config} could not be read`);
  return {
    options: { ...parsed.options, ...RESOLVES_EVERY_LOCAL_FILE },
    programFiles: parsed.fileNames,
  };
}

function strongComponents(nodes, edges) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  const frames = [];
  const visit = (node) => {
    index.set(node, index.size);
    low.set(node, index.get(node));
    stack.push(node);
    onStack.add(node);
    frames.push([node, 0]);
  };
  for (const start of nodes) {
    if (index.has(start)) continue;
    visit(start);
    while (frames.length > 0) {
      const frame = frames.at(-1);
      const [node, position] = frame;
      const next = edges.get(node)[position];
      if (next !== undefined) {
        frame[1] += 1;
        if (!index.has(next)) visit(next);
        else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = frames.at(-1)[0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === index.get(node)) {
        const members = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          members.push(member);
        } while (member !== node);
        components.push(members);
      }
    }
  }
  return components;
}

function declaresUseClient(statements) {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression))
      return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function clientBoundaryOf(file, text) {
  if (!SCRIPT.test(file) || !MAY_CROSS_CLIENT_BOUNDARY.test(text)) return [false, []];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const reexports = source.statements
    .filter((statement) => ts.isExportDeclaration(statement) && statement.moduleSpecifier)
    .map((statement) => statement.getText(source));
  return [declaresUseClient(source.statements), reexports];
}

function digestsOverComponents(components, edges, partOf) {
  const componentOf = new Map();
  const componentDigest = new Map();
  for (const members of components) {
    const id = members[0];
    for (const member of members) componentOf.set(member, id);
    const outward = new Set();
    for (const member of members)
      for (const next of edges.get(member))
        if (componentOf.get(next) !== id) outward.add(componentDigest.get(componentOf.get(next)));
    const own = members.map((member) => `${member}\0${partOf(member)}`).sort();
    componentDigest.set(id, sha(JSON.stringify([own, [...outward].sort()])));
  }
  return (file) => componentDigest.get(componentOf.get(file));
}

export function importClosures(root, entries, held) {
  const { options, programFiles } = compilerSetup(root);
  const cache = ts.createModuleResolutionCache(root, (name) => name, options);
  const nameOf = (path) => relative(root, path);
  const program = new Set(programFiles.map(nameOf).filter((file) => held.has(file)));
  const contentOf = new Map();
  const edges = new Map();
  const packagesNamed = new Map();
  const resolutions = new Map();
  const ambient = [];
  const pending = [...program, ...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (edges.has(file)) continue;
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    contentOf.set(file, sha(text));
    if (
      program.has(file) &&
      (file.endsWith(".d.ts") || !MODULE_SYNTAX.test(text) || AUGMENTS.test(text))
    )
      ambient.push(file);
    const info = ts.preProcessFile(text, true, true);
    const targets = new Set();
    const named = new Set();
    const resolvedTo = [];
    for (const imported of info.importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        path,
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      const target = resolved && nameOf(resolved.resolvedFileName);
      if (resolved && !resolved.isExternalLibraryImport && held.has(target)) {
        targets.add(target);
        resolvedTo.push([imported.fileName, target]);
      } else {
        if (BARE_PACKAGE.test(imported.fileName))
          named.add(BARE_PACKAGE.exec(imported.fileName)[1]);
        resolvedTo.push([imported.fileName, resolved ? "external" : null]);
      }
    }
    resolutions.set(file, resolvedTo);
    packagesNamed.set(file, [...named].sort());
    for (const referenced of info.referencedFiles) {
      const target = nameOf(join(path, "..", referenced.fileName));
      if (held.has(target)) targets.add(target);
    }
    edges.set(file, [...targets].sort());
    pending.push(...targets);
  }
  const components = strongComponents([...edges.keys()].sort(), edges);
  const closureOf = digestsOverComponents(components, edges, (file) => contentOf.get(file));
  const ambientDigest = sha(JSON.stringify(ambient.sort().map((file) => [file, closureOf(file)])));
  const boundaries = new Map();
  const boundaryOf = (file) => {
    if (!boundaries.has(file))
      boundaries.set(file, clientBoundaryOf(file, readFileSync(join(root, file), "utf8")));
    return boundaries.get(file);
  };
  const readsClosures = new Map();
  const readsClosureOf = ({ clientBoundary, content }) => {
    const key = JSON.stringify([clientBoundary, content]);
    if (!readsClosures.has(key)) {
      const unmatched = content.filter(
        (pattern) => ![...edges.keys()].some((file) => matchesGlob(file, pattern)),
      );
      if (unmatched.length > 0)
        throw new Error(
          `reads.content pattern ${unmatched.join(", ")} matches no file; a pattern matches the whole path from the repo root, as **/*.tsx`,
        );
      readsClosures.set(
        key,
        digestsOverComponents(components, edges, (file) =>
          JSON.stringify([
            clientBoundary ? boundaryOf(file) : null,
            content.some((pattern) => matchesGlob(file, pattern)) ? contentOf.get(file) : null,
          ]),
        ),
      );
    }
    return readsClosures.get(key);
  };
  const packagesImportedBy = (file) => {
    const reached = new Set([file]);
    for (const member of reached) for (const next of edges.get(member) ?? []) reached.add(next);
    return [...reached].flatMap((member) =>
      (packagesNamed.get(member) ?? []).map((name) => [member, name]),
    );
  };
  const resolutionsOf = (file) => resolutions.get(file) ?? null;
  return {
    closureOf,
    contentOf,
    ambientDigest,
    readsClosureOf,
    packagesImportedBy,
    resolutionsOf,
  };
}
