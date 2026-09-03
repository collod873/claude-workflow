import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { vendorBin } from "./new-adr.fixture.ts";
import { scratchDir } from "./scratch.fixture.ts";

// bin/new-research derives its filename number from BASH_SOURCE's own directory (repo_root/..),
// the same mechanic bin/new-adr uses — so "a scratch research directory" means a scratch *tree*:
// a throwaway directory carrying its own bin/new-research and its own docs/research/, not a flag
// this script accepts to redirect where it writes. That mirrors the seam under test rather than
// adding one bin/new-adr doesn't have. `new-adr.fixture.ts`'s `vendorBin` owns the copy.

/** A scratch tree shaped like this repo, minus everything but the one script under test. */
function scratchTree(): string {
  const dir = scratchDir("new-research");
  vendorBin(dir, "new-research");
  return dir;
}

// Sibling ticket #122 hit this against bin/new-adr: with EDITOR or VISUAL set, the script's own
// final line `exec`s into that editor on the file it just created, and a spawnSync in a test
// environment that inherited either variable hangs rather than returning. Strip both so the child
// always takes the non-interactive path.
function runNewResearch(dir: string, args: string[]) {
  const env = { ...process.env };
  delete env.EDITOR;
  delete env.VISUAL;
  return spawnSync(join(dir, "bin/new-research"), args, { cwd: dir, encoding: "utf8", env });
}

/** The basename of the file a successful run printed. */
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

  // ADR-0072: a note nobody asked for says so, and the tool writes that field for the same reason
  // it writes the other one — a state the counter asks about has to be as cheap to declare.
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
    // A gap and an out-of-order write: the highest number present must still win, and a
    // non-numbered legacy note (this repo's existing docs/research/ shape) must not confuse it.
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
