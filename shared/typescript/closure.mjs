import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { sha } from "./files.mjs";
import { parsedTsconfig } from "./tsconfig-guard.mjs";

const MODULE_SYNTAX = /^\s*(?:import|export)\b/m;
const AUGMENTS = /\bdeclare\s+(?:global|module)\b/;
const RESOLVES_EVERY_LOCAL_FILE = { allowJs: true, resolveJsonModule: true };

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

export function importClosures(root, entries) {
  const { options, programFiles } = compilerSetup(root);
  const cache = ts.createModuleResolutionCache(root, (name) => name, options);
  const nameOf = (path) => relative(root, path);
  const program = new Set(programFiles.map(nameOf));
  const contentOf = new Map();
  const edges = new Map();
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
    for (const imported of info.importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        path,
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport)
        targets.add(nameOf(resolved.resolvedFileName));
    }
    for (const referenced of info.referencedFiles) {
      const target = nameOf(join(path, "..", referenced.fileName));
      if (existsSync(join(root, target))) targets.add(target);
    }
    edges.set(file, [...targets].sort());
    pending.push(...targets);
  }
  const componentOf = new Map();
  const componentDigest = new Map();
  for (const members of strongComponents([...edges.keys()].sort(), edges)) {
    const id = members[0];
    for (const member of members) componentOf.set(member, id);
    const outward = new Set();
    for (const member of members)
      for (const next of edges.get(member))
        if (componentOf.get(next) !== id) outward.add(componentDigest.get(componentOf.get(next)));
    const own = members.map((member) => `${member}\0${contentOf.get(member)}`).sort();
    componentDigest.set(id, sha(JSON.stringify([own, [...outward].sort()])));
  }
  const closureOf = (file) => componentDigest.get(componentOf.get(file));
  const ambientDigest = sha(JSON.stringify(ambient.sort().map((file) => [file, closureOf(file)])));
  return { closureOf, contentOf, ambientDigest };
}
