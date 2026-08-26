import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { deriveRange, EMPTY_TREE_HASH } from "./range";

/**
 * A throwaway git repo for one test, with a helper to commit a file at an explicit timestamp and
 * hand back the new commit's SHA — `deriveRange`'s whole job is reading commit dates back out of
 * `git log --since/--until`, so the fixture has to control them precisely rather than let them
 * fall out of "whenever the test happened to run".
 */
function makeRepo(): { dir: string; commit: (path: string, contents: string, message: string, iso: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "derive-range-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  function commit(path: string, contents: string, message: string, iso: string): string {
    writeFileSync(join(dir, path), contents, "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
    });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  return { dir, commit };
}

describe("deriveRange", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("takes the newest commit in the window as head and the parent of the oldest as base, excluding a commit outside the window", () => {
    const repo = makeRepo();
    dir = repo.dir;

    repo.commit("prehistory.ts", "export const prehistory = true;\n", "before the window", "2026-08-01T00:00:00Z");
    const parentOfOldest = repo.commit("root.ts", "export const root = true;\n", "seed, before window too", "2026-08-01T00:01:00Z");
    const oldestInWindow = repo.commit("mine.ts", "export const mine = 1;\n", "oldest inside window", "2026-08-10T12:00:00Z");
    const newestInWindow = repo.commit("theirs.ts", "export const theirs = 1;\n", "newest inside window", "2026-08-10T13:00:00Z");
    repo.commit("mine.ts", "export const mine = 2;\n", "after the window", "2026-08-20T00:00:00Z");

    const range = deriveRange({
      git: execGit,
      repoDir: dir,
      since: "2026-08-10T00:00:00Z",
      until: "2026-08-10T23:59:59Z",
    });

    expect(range).toEqual({ base: parentOfOldest, head: newestInWindow });
    expect(range?.base).not.toBe(oldestInWindow);
  });

  it("falls back to the empty-tree hash as base when the oldest commit in the window is the repo's root commit", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const root = repo.commit("mine.ts", "export const mine = 1;\n", "root commit, inside window", "2026-08-10T12:00:00Z");
    const head = repo.commit("theirs.ts", "export const theirs = 1;\n", "second commit, inside window", "2026-08-10T13:00:00Z");

    const range = deriveRange({
      git: execGit,
      repoDir: dir,
      since: "2026-08-10T00:00:00Z",
      until: "2026-08-10T23:59:59Z",
    });

    expect(range).toEqual({ base: EMPTY_TREE_HASH, head });
    expect(range?.base).not.toBe(root);
  });

  it("returns no range when the window names no commits", () => {
    const repo = makeRepo();
    dir = repo.dir;

    repo.commit("mine.ts", "export const mine = 1;\n", "well before the window", "2026-08-01T00:00:00Z");
    repo.commit("theirs.ts", "export const theirs = 1;\n", "well after the window", "2026-08-20T00:00:00Z");

    const range = deriveRange({
      git: execGit,
      repoDir: dir,
      since: "2026-08-10T00:00:00Z",
      until: "2026-08-10T23:59:59Z",
    });

    expect(range).toBeUndefined();
  });

  it("returns no range, never a widened working-tree diff, when the timestamps don't parse", () => {
    const repo = makeRepo();
    dir = repo.dir;

    repo.commit("mine.ts", "export const mine = 1;\n", "the only commit", "2026-08-10T12:00:00Z");

    expect(deriveRange({ git: execGit, repoDir: dir, since: "not-a-date", until: "2026-08-10T23:59:59Z" })).toBeUndefined();
    expect(deriveRange({ git: execGit, repoDir: dir, since: "2026-08-10T00:00:00Z", until: "also-not-a-date" })).toBeUndefined();
  });
});
