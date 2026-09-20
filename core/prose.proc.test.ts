import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { git } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const ARCHIVE = "docs/research/";
const MACHINE_READ =
  /shellcheck|eslint-|@ts-|prettier-ignore|[cv]8 ignore|@type\b|@shell\b|@fixture\b|noqa|pylint:|mypy:|pyright:|ruff:|type:\s*ignore|pragma:\s*no cover/;
const KNIP_TAG = /@shell\b|@fixture\b/;
const KNIP_TAG_CAP = 5;
const BRACE = /\.(m|c)?(t|j)s$/;
const HASH = /\.(sh|ya?ml)$/;
const SHEBANG = /^#!.*\b(bash|sh)\b/;
const PY = /\.py$/;
const PY_SHEBANG = /^#!.*\bpython/;
const PY_STRING = /^[rbufRBUF]{0,2}("""|'''|"|')/;

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

function closesAt(source: string, from: number, quote: string): number {
  let index = from;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source.startsWith(quote, index)) return index + quote.length;
    index += 1;
  }
  return source.length;
}

function pyProse(path: string, source: string): Prose[] {
  const found: Prose[] = [];
  const helpText = source.includes("__doc__");
  let index = 0;
  let startsLine = true;
  let atModuleDocstring = true;
  while (index < source.length) {
    const char = source[index];
    if (char === "\n") {
      startsLine = true;
      index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "#") {
      const ends = source.indexOf("\n", index);
      const stop = ends === -1 ? source.length : ends;
      const text = source.slice(index, stop);
      const line = lineOf(source, index);
      if (!(line === 1 && text.startsWith("#!")) && !MACHINE_READ.test(text)) found.push({ path, line, text });
      index = stop;
      continue;
    }
    const opener = PY_STRING.exec(source.slice(index, index + 5));
    if (opener !== null) {
      const quote = opener[1];
      const ends = closesAt(source, index + opener[0].length, quote);
      const readByArgparse = atModuleDocstring && helpText;
      if (startsLine && quote.length === 3 && !readByArgparse) found.push({ path, line: lineOf(source, index), text: source.slice(index, ends).split("\n")[0] });
      index = ends;
      startsLine = false;
      atModuleDocstring = false;
      continue;
    }
    startsLine = false;
    atModuleDocstring = false;
    index += 1;
  }
  return found;
}

function proseIn(path: string, source: string): Prose[] {
  if (BRACE.test(path)) return braceProse(path, source);
  if (PY.test(path) || PY_SHEBANG.test(source)) return pyProse(path, source);
  if (HASH.test(path) || SHEBANG.test(source)) return hashProse(path, source);
  return [];
}

function trackedCode(repo: string): string[] {
  return git(repo, "ls-files", "-z")
    .split("\0")
    .filter((file) => file !== "" && !file.startsWith(ARCHIVE) && existsSync(join(repo, file)));
}

describe("code this repo tracks carries no prose (ADR-0151)", () => {
  const sources = trackedCode(REPO).map((path) => ({ path, source: readFileSync(join(REPO, path), "utf8") }));

  it("reads every tracked file but the archive, so an empty scan can never pass by accident", () => {
    const covered = sources.map((file) => file.path);

    expect(covered).toContain("core/prose.proc.test.ts");
    expect(covered).toContain("core/check");
    expect(covered).toContain("core/eslint.config.js");
    expect(covered).toContain("bin/tests/test_md_html.py");
    expect(covered).toContain("bin/md-html");
    expect(covered).toContain(".github/workflows/core-check.yml");
    expect(covered).toContain("vitest.config.ts");
    expect(covered).not.toContain("docs/research/harness/hooks-per-event/drive.py");
  });

  it("finds a planted sentence in each language it claims to read", () => {
    expect(proseIn("planted.ts", "const x = 1; // a sentence\nexport { x };\n")).toHaveLength(1);
    expect(proseIn("planted.js", "/* a sentence */\nexport default {};\n")).toHaveLength(1);
    expect(proseIn("planted", "#!/bin/bash\n# a sentence\nrun\n")).toHaveLength(1);
    expect(proseIn("planted.yml", "jobs:\n  # a sentence\n  build: {}\n")).toHaveLength(1);
    expect(proseIn("planted.py", "x = 1  # a sentence\n")).toHaveLength(1);
    expect(proseIn("planted.py", '"""A sentence."""\n\n\ndef run():\n    """Another."""\n')).toHaveLength(2);
    expect(proseIn("planted", "#!/usr/bin/env python3\n# a sentence\nrun()\n")).toHaveLength(1);
  });

  it("leaves what a machine reads: knip tags, shellcheck directives, eslint pragmas, python pragmas", () => {
    expect(proseIn("kept.ts", "// eslint-disable-next-line no-eval\nconst x = 1;\n")).toHaveLength(0);
    expect(proseIn("kept.sh", "#!/bin/bash\n# shellcheck source=x.sh\nrun\n")).toHaveLength(0);
    expect(proseIn("kept.ts", "/**\n * @fixture Reached only from the suite.\n */\nexport const x = 1;\n")).toHaveLength(0);
    expect(proseIn("kept.py", "x = 1  # noqa: E501\ny = 2  # type: ignore[arg-type]\n")).toHaveLength(0);
  });

  it("leaves a module docstring the script hands to argparse, and still reads the docstrings under it", () => {
    const script = '"""usage: run [--days N]\n\nWhat it does.\n"""\n\n\ndef run():\n    """Another."""\n\n\nparser(description=__doc__)\n';

    expect(proseIn("helpful.py", script)).toEqual([{ path: "helpful.py", line: 8, text: '"""Another."""' }]);
    expect(proseIn("silent.py", script.replace("description=__doc__", "description='run'"))).toHaveLength(2);
  });

  it("refuses an essay hiding behind a knip tag", () => {
    expect(proseIn("essay.ts", "/**\n * @fixture one\n * two\n * three\n * four\n * five\n */\nexport const x = 1;\n")).toHaveLength(1);
  });

  it("reads a heredoc as data rather than as the comments it may contain", () => {
    expect(proseIn("here.sh", "#!/bin/bash\ncat <<EOF\n# not a comment\nEOF\n")).toHaveLength(0);
  });

  it("reads a python string held as data rather than as the docstring it resembles", () => {
    expect(proseIn("data.py", 'TEMPLATE = """\nnot a docstring\n"""\n\nBODY = "# not a comment"\n')).toHaveLength(0);
  });

  it("holds at none across everything tracked", () => {
    const found = sources.flatMap((file) => proseIn(file.path, file.source));
    const report = found.map(({ path, line, text }) => `${path}:${line}  ${text}`).join("\n");

    expect(found, `prose belongs in docs/adr/ or CONTEXT.md, never beside the code:\n${report}`).toHaveLength(0);
  });
});
