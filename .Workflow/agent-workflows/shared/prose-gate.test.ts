import { describe, expect, it } from "vitest";
import { braceProse, gatedSources, hashProse, proseIn } from "./prose";
import { repoFileExists } from "./repo-sources";
import { VENDORED_COPIES } from "./vendored.fixture";

describe("code in this repo carries no prose (#360)", () => {
  const sources = gatedSources();

  it("reads a source tree at all, so an empty scan can never pass by accident", () => {
    expect(sources.filter((file) => file.relative.endsWith(".ts")).length).toBeGreaterThan(100);
  });

  it("reaches the corners a gate scoped to extensions and lane sources would miss", () => {
    const covered = new Set(sources.map((file) => file.relative));

    expect(covered).toContain(".husky/pre-push");
    expect([...covered].filter((path) => path.includes(".fixtures/")).length).toBeGreaterThan(0);
  });

  it("leaves a vendored copy to its digest pin, and only a copy that exists", () => {
    const covered = new Set(sources.map((file) => file.relative));

    for (const copy of VENDORED_COPIES) {
      expect(repoFileExists(copy.relative), `${copy.relative} is pinned but missing`).toBe(true);
      expect(covered).not.toContain(copy.relative);
    }
  });

  it("reads an extensionless husky hook as the shell it is", () => {
    expect(proseIn({ path: "", relative: ".husky/pre-push", source: "# a sentence\nnpm run check\n" })).toHaveLength(1);
  });

  it("finds a planted sentence in each language it claims to read", () => {
    expect(braceProse("planted.ts", "const x = 1; // a sentence\nexport { x };\n")).toHaveLength(1);
    expect(hashProse("planted.sh", "#!/bin/bash\n# a sentence\nrun\n")).toHaveLength(1);
    expect(hashProse("planted.py", 'def f():\n    """A sentence."""\n    return 1\n')).toHaveLength(1);
    expect(hashProse("planted.yml", "jobs:\n  # a sentence\n  build: {}\n")).toHaveLength(1);
  });

  it("leaves what a machine reads: knip tags, shellcheck directives, eslint pragmas", () => {
    expect(braceProse("kept.ts", "// eslint-disable-next-line no-eval\nconst x = 1;\n")).toHaveLength(0);
    expect(hashProse("kept.sh", "#!/bin/bash\n# shellcheck source=bin/x.sh\nrun\n")).toHaveLength(0);
    expect(braceProse("kept.ts", "/**\n * @fixture Reached only from the suite.\n */\nexport const x = 1;\n")).toHaveLength(0);
  });

  it("refuses an essay hiding behind a knip tag", () => {
    expect(braceProse("essay.ts", "/**\n * @fixture one\n * two\n * three\n * four\n * five\n */\nexport const x = 1;\n")).toHaveLength(1);
  });

  it("reads a heredoc as data rather than as the comments it may contain", () => {
    expect(hashProse("here.sh", "#!/bin/bash\ncat <<EOF\n# not a comment\nEOF\n")).toHaveLength(0);
  });

  it("holds at none across every file the gate covers", () => {
    const found = sources.flatMap(proseIn);
    const report = found.map(({ path, line, text }) => `${path}:${line}  ${text}`).join("\n");

    expect(found, `prose belongs in docs/adr/ or CONTEXT.md, never beside the code:\n${report}`).toHaveLength(0);
  });
});
