import { describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { makeTempRepo, type TempRepo } from "../shared/temp-repo.fixture";
import { deriveRange, EMPTY_TREE_HASH } from "./range";

/**
 * Commits one file at an explicit timestamp and hands back the new commit's SHA — `deriveRange`'s
 * whole job is reading commit dates back out of `git log --since/--until`, so every commit here
 * has to control its date precisely rather than let it fall out of "whenever the test happened to
 * run".
 */
function commitAt(repo: TempRepo, path: string, contents: string, message: string, iso: string): string {
  repo.write(path, contents);
  return repo.commit(message, { date: iso });
}

describe("deriveRange", () => {
  it("takes the newest commit in the window as head and the parent of the oldest as base, excluding a commit outside the window", () => {
    const repo = makeTempRepo("derive-range");

    commitAt(repo, "prehistory.ts", "export const prehistory = true;\n", "before the window", "2026-08-01T00:00:00Z");
    const parentOfOldest = commitAt(repo, "root.ts", "export const root = true;\n", "seed, before window too", "2026-08-01T00:01:00Z");
    const oldestInWindow = commitAt(repo, "mine.ts", "export const mine = 1;\n", "oldest inside window", "2026-08-10T12:00:00Z");
    const newestInWindow = commitAt(repo, "theirs.ts", "export const theirs = 1;\n", "newest inside window", "2026-08-10T13:00:00Z");
    commitAt(repo, "mine.ts", "export const mine = 2;\n", "after the window", "2026-08-20T00:00:00Z");

    const range = deriveRange({
      git: execGit,
      repoDir: repo.dir,
      since: "2026-08-10T00:00:00Z",
      until: "2026-08-10T23:59:59Z",
    });

    expect(range).toEqual({ base: parentOfOldest, head: newestInWindow });
    expect(range?.base).not.toBe(oldestInWindow);
  });

  it("falls back to the empty-tree hash as base when the oldest commit in the window is the repo's root commit", () => {
    const repo = makeTempRepo("derive-range");

    const root = commitAt(repo, "mine.ts", "export const mine = 1;\n", "root commit, inside window", "2026-08-10T12:00:00Z");
    const head = commitAt(repo, "theirs.ts", "export const theirs = 1;\n", "second commit, inside window", "2026-08-10T13:00:00Z");

    const range = deriveRange({
      git: execGit,
      repoDir: repo.dir,
      since: "2026-08-10T00:00:00Z",
      until: "2026-08-10T23:59:59Z",
    });

    expect(range).toEqual({ base: EMPTY_TREE_HASH, head });
    expect(range?.base).not.toBe(root);
  });

  it("returns no range when the window names no commits", () => {
    const repo = makeTempRepo("derive-range");

    commitAt(repo, "mine.ts", "export const mine = 1;\n", "well before the window", "2026-08-01T00:00:00Z");
    commitAt(repo, "theirs.ts", "export const theirs = 1;\n", "well after the window", "2026-08-20T00:00:00Z");

    const range = deriveRange({
      git: execGit,
      repoDir: repo.dir,
      since: "2026-08-10T00:00:00Z",
      until: "2026-08-10T23:59:59Z",
    });

    expect(range).toBeUndefined();
  });

  it("returns no range, never a widened working-tree diff, when the timestamps don't parse", () => {
    const repo = makeTempRepo("derive-range");
    const repoDir = repo.dir;

    commitAt(repo, "mine.ts", "export const mine = 1;\n", "the only commit", "2026-08-10T12:00:00Z");

    expect(deriveRange({ git: execGit, repoDir, since: "not-a-date", until: "2026-08-10T23:59:59Z" })).toBeUndefined();
    expect(deriveRange({ git: execGit, repoDir, since: "2026-08-10T00:00:00Z", until: "also-not-a-date" })).toBeUndefined();
  });
});
