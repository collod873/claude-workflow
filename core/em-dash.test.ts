import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emDashLines } from "./em-dash.ts";
import { loadedDocs, onDisk, type Tree } from "./loaded-docs.ts";
import { machineryFiles } from "./machinery.ts";
import { scratch } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const DASH = "\u2014";

function emDashesIn(tree: Tree): string[] {
  const inCore = machineryFiles(tree).flatMap((file) => emDashLines(tree.read(file) ?? "").map((line) => `${file}:${line}`));
  const inLoadedDocs = loadedDocs(tree).flatMap((doc) => doc.lines.filter(({ text }) => emDashLines(text).length > 0).map(({ number }) => `${doc.file}:${number}`));
  return [...new Set([...inCore, ...inLoadedDocs])].map((at) => `${at} carries an em dash`);
}

function plant(root: string, file: string, content: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

describe("nothing in the machinery and no doc a session loads carries an em dash (#681)", () => {
  it("finds the line of each em dash in text, and nothing in a hyphen or an en dash", () => {
    expect(emDashLines(`one\ntwo ${DASH} three\nfour - five – six\n${DASH}`)).toEqual([2, 4]);
    expect(emDashLines("")).toEqual([]);
  });

  it("holds today's machinery and loaded docs at none", () => {
    expect(emDashesIn(onDisk(REPO))).toEqual([]);
  });

  it("names the file and line of a planted em dash anywhere in the machinery or a loaded doc, and leaves what no session loads alone", () => {
    const repo = scratch("em-dash-");
    plant(repo, "core/bin/land", `#!/bin/bash\necho fine\necho ${DASH}\n`);
    plant(repo, "core/deep/part.ts", `export const a = 1;\n\nexport const b = "${DASH}";\n`);
    plant(repo, "core/node_modules/dep/index.js", `${DASH}\n`);
    plant(repo, ".claude/hooks/close-gate.py", `def refuse():\n    return "no ${DASH} thanks"\n`);
    plant(repo, ".claude/hooks/__pycache__/close-gate.pyc", `${DASH}\n`);
    plant(repo, "bin/close-ticket", `#!/usr/bin/env python3\nprint("done ${DASH} closed")\n`);
    plant(repo, "CONTEXT.md", `**Ticket**:\nOne unit ${DASH} the machine builds.\n`);
    plant(repo, ".claude/skills/tdd/SKILL.md", `---\nname: tdd\ndescription: Test first ${DASH} always.\n---\n\nThe body ${DASH} loads only when run.\n`);
    plant(repo, "docs/research/notes.md", `Nobody loads this ${DASH}.\n`);

    expect(emDashesIn(onDisk(repo))).toEqual([
      "core/bin/land:3 carries an em dash",
      "core/deep/part.ts:3 carries an em dash",
      ".claude/hooks/close-gate.py:2 carries an em dash",
      ".claude/skills/tdd/SKILL.md:3 carries an em dash",
      ".claude/skills/tdd/SKILL.md:6 carries an em dash",
      "bin/close-ticket:2 carries an em dash",
      "CONTEXT.md:2 carries an em dash",
    ]);
  });
});
