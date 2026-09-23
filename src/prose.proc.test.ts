import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { git } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const MACHINE_READ = /^(\/\/|\/\*+|#)\s*\*?\s*(shellcheck|eslint-|@ts-|prettier-ignore|[cv]8 ignore|@type\b)/;
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
  if (HASH.test(path) || SHEBANG.test(source) || path.startsWith(".husky/")) return hashProse(path, source);
  return [];
}

function trackedCode(repo: string): string[] {
  return git(repo, "ls-files", "-z")
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(repo, file)));
}

describe("code this repo tracks carries no prose", () => {
  const sources = trackedCode(REPO).map((path) => ({ path, source: readFileSync(join(REPO, path), "utf8") }));

  it("reads every tracked file, so an empty scan can never pass by accident", () => {
    const covered = sources.map((file) => file.path);

    expect(covered).toContain("src/prose.proc.test.ts");
    expect(covered).toContain("bin/check");
    expect(covered).toContain("eslint.config.js");
    expect(covered).toContain(".github/workflows/core-check.yml");
  });

  it("finds a planted sentence in each language it claims to read", () => {
    expect(proseIn("planted.ts", "const x = 1; // a sentence\nexport { x };\n")).toHaveLength(1);
    expect(proseIn("planted.js", "/* a sentence */\nexport default {};\n")).toHaveLength(1);
    expect(proseIn("planted", "#!/bin/bash\n# a sentence\nrun\n")).toHaveLength(1);
    expect(proseIn("planted.yml", "jobs:\n  # a sentence\n  build: {}\n")).toHaveLength(1);
    expect(proseIn(".husky/pre-push", "# a sentence\nbin/check\n")).toHaveLength(1);
  });

  it("leaves what a machine reads: shellcheck directives and eslint pragmas, and reads a sentence that only mentions one", () => {
    expect(proseIn("kept.ts", "// eslint-disable-next-line no-eval\nconst x = 1;\n")).toHaveLength(0);
    expect(proseIn("kept.sh", "#!/bin/bash\n# shellcheck source=x.sh\nrun\n")).toHaveLength(0);
    expect(proseIn("said.ts", "// we skip eslint-disable here because it lies\nconst x = 1;\n")).toHaveLength(1);
  });

  it("reads a heredoc as data rather than as the comments it may contain", () => {
    expect(proseIn("here.sh", "#!/bin/bash\ncat <<EOF\n# not a comment\nEOF\n")).toHaveLength(0);
  });

  it("holds at none across everything tracked", () => {
    const found = sources.flatMap((file) => proseIn(file.path, file.source));
    const report = found.map(({ path, line, text }) => `${path}:${line}  ${text}`).join("\n");

    expect(found, `prose belongs in the commit message or CONTEXT.md, never beside the code:\n${report}`).toHaveLength(0);
  });
});
