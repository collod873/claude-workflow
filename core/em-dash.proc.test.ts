import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emDashLines } from "./em-dash.ts";
import { git, scratch } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const DASH = String.fromCodePoint(0x2014);

function emDashesIn(repo: string): string[] {
  return git(repo, "ls-files", "-z")
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(repo, file)))
    .flatMap((file) => emDashLines(readFileSync(join(repo, file), "utf8")).map((line) => `${file}:${line} carries an em dash`));
}

function plant(root: string, file: string, content: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

describe("no file this repo tracks carries an em dash (#681)", () => {
  it("finds the line of each em dash in text, and nothing in a hyphen or an en dash", () => {
    expect(emDashLines(`one\ntwo ${DASH} three\nfour - five ${String.fromCodePoint(0x2013)} six\n${DASH}`)).toEqual([2, 4]);
    expect(emDashLines("")).toEqual([]);
  });

  it("holds today's repo at none", () => {
    expect(emDashesIn(REPO)).toEqual([]);
  });

  it("names the file and line of a planted em dash wherever it is tracked, and leaves what the repo does not track alone", () => {
    const repo = scratch("em-dash-");
    git(repo, "init", "-q");
    plant(repo, ".gitignore", "state/\n");
    plant(repo, "core/deep/part.ts", `export const a = 1;\n\nexport const b = "${DASH}";\n`);
    plant(repo, ".claude/skills/tdd/SKILL.md", `---\nname: tdd\ndescription: Test first ${DASH} always.\n---\n\nThe body ${DASH} loads only when run.\n`);
    plant(repo, "docs/research/notes.md", `A post-mortem ${DASH} tracked like everything else.\n`);
    git(repo, "add", "-A");
    plant(repo, "state/capture.txt", `Session text nobody wrote ${DASH} ignored.\n`);
    plant(repo, "untracked.md", `Never added ${DASH} so never read.\n`);

    expect(emDashesIn(repo)).toEqual([
      ".claude/skills/tdd/SKILL.md:3 carries an em dash",
      ".claude/skills/tdd/SKILL.md:6 carries an em dash",
      "core/deep/part.ts:3 carries an em dash",
      "docs/research/notes.md:1 carries an em dash",
    ]);
  });
});
