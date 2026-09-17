import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CORE = import.meta.dirname;
const MACHINE_READ = /shellcheck|eslint-|@ts-|prettier-ignore|[cv]8 ignore|@type\b|@shell\b|@fixture\b/;
const KNIP_TAG = /@shell\b|@fixture\b/;
const KNIP_TAG_CAP = 5;
const BRACE = /\.(m|c)?(t|j)s$/;
const HASH = /\.(sh|ya?ml)$/;
const SHEBANG = /^#!.*\b(bash|sh)\b/;

interface Prose {
  path: string;
  line: number;
  text: string;
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function braceProse(path: string, source: string): Prose[] {
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

function hashProse(path: string, source: string): Prose[] {
  const found: Prose[] = [];
  let heredoc: string | undefined;
  source.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (index === 0 && line.startsWith("#!")) return;
    if (heredoc !== undefined) {
      if (line === heredoc) heredoc = undefined;
      return;
    }
    if (line.startsWith("#") && !MACHINE_READ.test(line)) {
      found.push({ path, line: index + 1, text: line });
      return;
    }
    const opener = /<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?/.exec(raw);
    if (opener !== null) heredoc = opener[1];
  });
  return found;
}

function proseIn(path: string, source: string): Prose[] {
  if (BRACE.test(path)) return braceProse(path, source);
  if (HASH.test(path) || SHEBANG.test(source)) return hashProse(path, source);
  return [];
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name !== "node_modules")
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
}

describe("code in the New core carries no prose (ADR-0151)", () => {
  const sources = filesUnder(CORE).map((path) => ({ path: relative(CORE, path), source: readFileSync(path, "utf8") }));

  it("reads the core's code, scripts and configs, so an empty scan can never pass by accident", () => {
    const covered = sources.map((file) => file.path);

    expect(covered).toContain("prose.test.ts");
    expect(covered).toContain("check");
    expect(covered).toContain("eslint.config.js");
  });

  it("finds a planted sentence in each language it claims to read", () => {
    expect(proseIn("planted.ts", "const x = 1; // a sentence\nexport { x };\n")).toHaveLength(1);
    expect(proseIn("planted.js", "/* a sentence */\nexport default {};\n")).toHaveLength(1);
    expect(proseIn("planted", "#!/bin/bash\n# a sentence\nrun\n")).toHaveLength(1);
    expect(proseIn("planted.yml", "jobs:\n  # a sentence\n  build: {}\n")).toHaveLength(1);
  });

  it("leaves what a machine reads: knip tags, shellcheck directives, eslint pragmas", () => {
    expect(proseIn("kept.ts", "// eslint-disable-next-line no-eval\nconst x = 1;\n")).toHaveLength(0);
    expect(proseIn("kept.sh", "#!/bin/bash\n# shellcheck source=x.sh\nrun\n")).toHaveLength(0);
    expect(proseIn("kept.ts", "/**\n * @fixture Reached only from the suite.\n */\nexport const x = 1;\n")).toHaveLength(0);
  });

  it("refuses an essay hiding behind a knip tag", () => {
    expect(proseIn("essay.ts", "/**\n * @fixture one\n * two\n * three\n * four\n * five\n */\nexport const x = 1;\n")).toHaveLength(1);
  });

  it("reads a heredoc as data rather than as the comments it may contain", () => {
    expect(proseIn("here.sh", "#!/bin/bash\ncat <<EOF\n# not a comment\nEOF\n")).toHaveLength(0);
  });

  it("holds at none across the core", () => {
    const found = sources.flatMap((file) => proseIn(file.path, file.source));
    const report = found.map(({ path, line, text }) => `core/${path}:${line}  ${text}`).join("\n");

    expect(found, `prose belongs in docs/adr/ or CONTEXT.md, never beside the code:\n${report}`).toHaveLength(0);
  });
});
