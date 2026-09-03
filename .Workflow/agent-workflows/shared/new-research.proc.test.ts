import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { vendorBin } from "./new-adr.fixture.ts";
import { scratchDir } from "./scratch.fixture.ts";

function scratchTree(): string {
  const dir = scratchDir("new-research");
  vendorBin(dir, "new-research");
  return dir;
}

function runNewResearch(dir: string, args: string[]) {
  const env = { ...process.env };
  delete env.EDITOR;
  delete env.VISUAL;
  return spawnSync(join(dir, "bin/new-research"), args, { cwd: dir, encoding: "utf8", env });
}

function createdName(dir: string, args: string[]): string {
  const result = runNewResearch(dir, args);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim().split("/").pop() ?? "";
}

describe("bin/new-research", () => {
  it("writes the Resolves: field from the issue number the invocation names", () => {
    const dir = scratchTree();

    const result = runNewResearch(dir, ["128", "a title"]);

    expect(result.status).toBe(0);
    expect(readFileSync(result.stdout.trim(), "utf8")).toContain("Resolves: #128");
  });

  it("writes Unprompted: instead, and never a Resolves:, when the invocation names no issue", () => {
    const dir = scratchTree();

    const result = runNewResearch(dir, ["none", "a title"]);

    expect(result.status).toBe(0);
    const written = readFileSync(result.stdout.trim(), "utf8");
    expect(written).toContain("Unprompted: no issue preceded this note");
    expect(written).not.toContain("Resolves:");
  });

  it("derives the next filename number the same way bin/new-adr does: highest existing plus one, four digits", () => {
    const dir = scratchTree();
    const researchDir = join(dir, "docs/research");
    mkdirSync(researchDir, { recursive: true });
    for (const name of ["0003-third.md", "0001-first.md", "legacy-note-2026-08.md"]) {
      writeFileSync(join(researchDir, name), "any content — only the filename is read\n");
    }

    expect(createdName(dir, ["9", "fourth note"])).toMatch(/^0004-/);
  });

  it("starts numbering at 0001 when no numbered note exists yet", () => {
    expect(createdName(scratchTree(), ["7", "first note"])).toMatch(/^0001-/);
  });

  it("slugifies the title the way bin/new-adr does — lowercased, non-alphanumeric collapsed to hyphens", () => {
    expect(createdName(scratchTree(), ["5", "A Title: With Punctuation!"])).toBe("0001-a-title-with-punctuation.md");
  });

  it("creates docs/research/ under the invoking repo, not the caller's cwd", () => {
    const dir = scratchTree();

    expect(createdName(dir, ["1", "note"])).toBe("0001-note.md");
    expect(readdirSync(join(dir, "docs/research"))).toContain("0001-note.md");
  });

  it("exits non-zero and writes nothing when the issue number or title is missing", () => {
    const result = runNewResearch(scratchTree(), ["128"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});
