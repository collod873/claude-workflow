import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { everySourceUnder, REPO_ROOT, type RepoFile } from "./repo-sources";

/**
 * @fixture Reached only from `prose-gate.test.ts`, by design: no lane reads its own source tree.
 */

const MACHINE_READ = /shellcheck|eslint-|@ts-|prettier-ignore|[cv]8 ignore|istanbul|@type\b|@shell\b|@fixture\b/;
const KNIP_TAG = /@shell\b|@fixture\b/;
const KNIP_TAG_CAP = 5;

const BRACE = /\.(m|c)?(t|j)s$/;
const HASH = /\.(py|sh|ya?ml)$/;
const HUSKY = /(^|\/)\.husky\//;
const SHEBANG = /^#!.*\b(bash|sh|python3?)\b/;

export interface Prose {
  path: string;
  line: number;
  text: string;
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

export function braceProse(path: string, source: string): Prose[] {
  const kind = /\.(m|c)?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const comments = new Map<number, ts.CommentRange>();
  const collect = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) comments.set(range.pos, range);
    for (const range of ts.getTrailingCommentRanges(source, node.end) ?? []) comments.set(range.pos, range);
    node.getChildren(file).forEach(collect);
  };
  collect(file);
  for (const range of ts.getLeadingCommentRanges(source, 0) ?? []) comments.set(range.pos, range);

  const found: Prose[] = [];
  for (const range of comments.values()) {
    const text = source.slice(range.pos, range.end);
    const line = lineOf(source, range.pos);
    const height = text.split("\n").length;
    if (KNIP_TAG.test(text)) {
      if (height > KNIP_TAG_CAP) found.push({ path, line, text: `${height} lines behind a knip tag` });
      continue;
    }
    if (MACHINE_READ.test(text)) continue;
    found.push({ path, line, text: text.split("\n")[0] });
  }
  return found.sort((a, b) => a.line - b.line);
}

export function hashProse(path: string, source: string): Prose[] {
  const found: Prose[] = [];
  const python = /\.py$/.test(path) || /^#!.*python/.test(source);
  const keepsModuleDoc = source.includes("__doc__");
  let heredoc: string | undefined;
  let quoted: string | undefined;
  let allowed = false;
  let previous = "";

  source.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const at = { path, line: index + 1, text: line };
    if (index === 0 && line.startsWith("#!")) return;
    if (heredoc !== undefined) {
      if (line === heredoc) heredoc = undefined;
      return;
    }
    if (quoted !== undefined) {
      if (!allowed) found.push(at);
      if (line.endsWith(quoted)) quoted = undefined;
      return;
    }
    const opener = python ? /^[rbfu]{0,2}("""|''')/.exec(line) : null;
    if (opener !== null && (previous.endsWith(":") || previous === "")) {
      allowed = previous === "" && keepsModuleDoc;
      const body = line.slice(opener[0].length);
      if (!allowed) found.push(at);
      if (!body.endsWith(opener[1]) || body === "") quoted = opener[1];
      previous = line;
      return;
    }
    if (line.startsWith("#") && !line.startsWith("#!") && !MACHINE_READ.test(line)) {
      found.push(at);
      return;
    }
    const heredocOpener = /<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?/.exec(raw);
    if (heredocOpener !== null) heredoc = heredocOpener[1];
    if (line !== "") previous = line;
  });
  return found;
}

export function proseIn(file: RepoFile): Prose[] {
  if (BRACE.test(file.relative)) return braceProse(file.relative, file.source);
  if (HASH.test(file.relative) || HUSKY.test(file.relative) || SHEBANG.test(file.source)) {
    return hashProse(file.relative, file.source);
  }
  return [];
}

export function gatedSources(): RepoFile[] {
  const roots = everySourceUnder(".Workflow/agent-workflows", "bin", ".claude", ".github", ".husky");
  const loose = readdirSync(REPO_ROOT)
    .map((entry) => join(REPO_ROOT, entry))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, relative: relative(REPO_ROOT, path), source: readFileSync(path, "utf8") }));
  return [...roots, ...loose];
}
