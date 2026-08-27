import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// bin/new-research derives its filename number from BASH_SOURCE's own directory (repo_root/..),
// the same mechanic bin/new-adr uses — so "a scratch research directory" means a scratch *repo*:
// a throwaway tree carrying its own bin/new-research and its own docs/research/, not a flag this
// script accepts to redirect where it writes. That mirrors the seam under test rather than adding
// one bin/new-adr doesn't have.

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SCRIPT = join(REPO_ROOT, "bin/new-research");

/** A scratch repo shaped like this one, minus everything but the one script under test. */
function makeScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "new-research-"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  cpSync(SCRIPT, join(dir, "bin/new-research"));
  chmodSync(join(dir, "bin/new-research"), 0o755);
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

const scratchDirs: string[] = [];
afterEach(() => {
  while (scratchDirs.length) rmSync(scratchDirs.pop()!, { recursive: true, force: true });
});

describe("bin/new-research", () => {
  it("writes the Resolves: field from the issue number the invocation names", () => {
    const dir = makeScratchRepo();
    scratchDirs.push(dir);

    const result = runNewResearch(dir, ["128", "a title"]);

    expect(result.status).toBe(0);
    const file = result.stdout.trim();
    expect(readFileSync(file, "utf8")).toContain("Resolves: #128");
  });

  it("derives the next filename number the same way bin/new-adr does: highest existing plus one, four digits", () => {
    const dir = makeScratchRepo();
    scratchDirs.push(dir);
    const researchDir = join(dir, "docs/research");
    mkdirSync(researchDir, { recursive: true });
    // A gap and an out-of-order write: the highest number present must still win, and a
    // non-numbered legacy note (this repo's existing docs/research/ shape) must not confuse it.
    for (const name of ["0003-third.md", "0001-first.md", "legacy-note-2026-08.md"]) {
      cpSync(SCRIPT, join(researchDir, name)); // any content — only the filename is read
    }

    const result = runNewResearch(dir, ["9", "fourth note"]);

    expect(result.status).toBe(0);
    const created = result.stdout.trim();
    expect(created.split("/").pop()).toMatch(/^0004-/);
  });

  it("starts numbering at 0001 when no numbered note exists yet", () => {
    const dir = makeScratchRepo();
    scratchDirs.push(dir);

    const result = runNewResearch(dir, ["7", "first note"]);

    expect(result.status).toBe(0);
    const created = result.stdout.trim();
    expect(created.split("/").pop()).toMatch(/^0001-/);
  });

  it("slugifies the title the way bin/new-adr does — lowercased, non-alphanumeric collapsed to hyphens", () => {
    const dir = makeScratchRepo();
    scratchDirs.push(dir);

    const result = runNewResearch(dir, ["5", "A Title: With Punctuation!"]);

    expect(result.status).toBe(0);
    const created = result.stdout.trim();
    expect(created.split("/").pop()).toBe("0001-a-title-with-punctuation.md");
  });

  it("creates docs/research/ under the invoking repo, not the caller's cwd", () => {
    const dir = makeScratchRepo();
    scratchDirs.push(dir);

    const result = runNewResearch(dir, ["1", "note"]);

    expect(result.status).toBe(0);
    expect(readdirSync(join(dir, "docs/research"))).toContain("0001-note.md");
  });

  it("exits non-zero and writes nothing when the issue number or title is missing", () => {
    const dir = makeScratchRepo();
    scratchDirs.push(dir);

    const result = runNewResearch(dir, ["128"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});
