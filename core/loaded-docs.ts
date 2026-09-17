import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { isMap, isNode, isScalar, parseDocument } from "yaml";

export interface Tree {
  entries(dir: string): string[];
  read(file: string): string | undefined;
}

interface Line {
  number: number;
  text: string;
}

interface LoadedDoc {
  file: string;
  signed: boolean;
  lines: Line[];
}

const SIGNED = /^docs\/agents\/(charter\.md$|layers\/)/;
const DESCRIBED_BY = ["name", "description"];
const LINK = /\]\(([^)\s]+)\)/g;
const QUOTED = /`([^`]+)`/g;
const PATH = /^[\w.-]+(\/[\w.-]+)*\/?$/;
const SCHEME = /^[a-z][\w+.-]*:/i;
const ANOTHER_REPO = /^[\w.-]+\/[\w-]+$/;
const ENFORCER_HEADER = /\|\s*Enforcer\s*\|\s*$/;

export function onDisk(repo: string): Tree {
  const at = (path: string) => join(repo, path);
  return {
    entries: (dir) => (existsSync(at(dir)) ? readdirSync(at(dir)) : []),
    read: (file) => (existsSync(at(file)) && statSync(at(file)).isFile() ? readFileSync(at(file), "utf8") : undefined),
  };
}

function numbered(text: string, first = 1): Line[] {
  return text.trimEnd().split("\n").map((line, index) => ({ number: first + index, text: line }));
}

function whole(tree: Tree, file: string): LoadedDoc[] {
  const text = tree.read(file);
  return text === undefined ? [] : [{ file, signed: SIGNED.test(file), lines: numbered(text) }];
}

function described(tree: Tree, file: string): LoadedDoc[] {
  const front = tree.read(file)?.match(/^---\n([\s\S]*?\n)---(\n|$)/)?.[1];
  if (front === undefined) return [];
  const yaml = parseDocument(front);
  if (yaml.get("disable-model-invocation") === true || !isMap(yaml.contents)) return [];
  const lines = numbered(front, 2);
  const lineOf = (offset: number) => front.slice(0, offset).split("\n").length - 1;
  const kept = yaml.contents.items.flatMap(({ key, value }) => {
    if (!isScalar(key) || !DESCRIBED_BY.includes(String(key.value)) || !key.range) return [];
    const start = lineOf(key.range[0]);
    const end = isNode(value) && value.range ? lineOf(Math.max(key.range[0], value.range[1] - 1)) : start;
    return lines.slice(start, end + 1);
  });
  return [{ file, signed: false, lines: kept }];
}

export function loadedDocs(tree: Tree): LoadedDoc[] {
  const inDir = (dir: string) => tree.entries(dir).sort().map((entry) => `${dir}/${entry}`);
  return [
    ...["CLAUDE.md", "core/CLAUDE.md", "CONTEXT.md", "docs/agents/charter.md", ...inDir("docs/agents/layers")].flatMap((file) => whole(tree, file)),
    ...inDir(".claude/skills").flatMap((dir) => described(tree, `${dir}/SKILL.md`)),
    ...inDir(".claude/agents").filter((file) => file.endsWith(".md")).flatMap((file) => described(tree, file)),
  ];
}

export function bytesOutsideSignedPages(docs: LoadedDoc[]): number {
  return docs
    .filter((doc) => !doc.signed)
    .flatMap((doc) => doc.lines)
    .reduce((total, line) => total + Buffer.byteLength(line.text) + 1, 0);
}

function withoutUnbuiltEnforcers(doc: LoadedDoc): Line[] {
  if (!doc.signed) return doc.lines;
  let inEnforcerTable = false;
  return doc.lines.map((line) => {
    inEnforcerTable = line.text.startsWith("|") && (inEnforcerTable || ENFORCER_HEADER.test(line.text));
    return inEnforcerTable ? { ...line, text: line.text.split("|").slice(0, -2).join("|") } : line;
  });
}

function namedIn(file: string, text: string): string[] {
  const linked = [...text.matchAll(LINK)]
    .filter(([, target]) => !SCHEME.test(target) && !target.startsWith("#"))
    .map((match) => ({ at: match.index, path: normalize(join(dirname(file), match[1].split("#")[0])) }));
  const quoted = [...text.matchAll(QUOTED)]
    .filter(([, token]) => token.includes("/") && PATH.test(token))
    .map((match) => ({ at: match.index, path: match[1] }));
  return [...new Set([...linked, ...quoted].sort((a, b) => a.at - b.at).map(({ path }) => path))];
}

export function pathsToNothing(repo: string, docs: LoadedDoc[]): string[] {
  return docs.flatMap((doc) =>
    withoutUnbuiltEnforcers(doc).flatMap((line) =>
      namedIn(doc.file, line.text)
        .filter((path) => !(ANOTHER_REPO.test(path) && !existsSync(join(repo, path.split("/")[0]))))
        .filter((path) => !existsSync(join(repo, path)))
        .map((path) => `${doc.file}:${line.number} names ${path}, which does not exist`),
    ),
  );
}
