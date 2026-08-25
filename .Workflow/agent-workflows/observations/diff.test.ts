import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { sessionRangeDiff } from "./diff";

/**
 * A throwaway git repo for one test, with a helper to commit a file and hand
 * back the new commit's SHA — the unit `sessionRangeDiff`'s `base`/`head`
 * are built from.
 */
function makeRepo(): { dir: string; commit: (path: string, contents: string, message: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "session-range-diff-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  function commit(path: string, contents: string, message: string): string {
    writeFileSync(join(dir, path), contents, "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  return { dir, commit };
}

describe("sessionRangeDiff", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("scopes the diff to base..head, excluding commits outside the range, and to touched paths, excluding files the transcript doesn't name", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("prehistory.ts", "export const prehistory = true;\n", "seed"); // outside range: before base
    repo.commit("mine.ts", "export const mine = 1;\n", "mine, inside range"); // inside range, named
    const head = repo.commit("theirs.ts", "export const theirs = 1;\n", "theirs, inside range"); // inside range, unnamed
    repo.commit("mine.ts", "export const mine = 2;\n", "after head, outside range"); // outside range: after head

    const diff = sessionRangeDiff({ git: execGit, repoDir: dir, base, head, touchedPaths: ["mine.ts"] });

    expect(diff).toContain("+export const mine = 1;"); // inside range, named — kept
    expect(diff).not.toContain("theirs.ts"); // inside range, not named — dropped
    expect(diff).not.toContain("prehistory"); // at/before base, untouched since — excluded by the range itself
    expect(diff).not.toContain("mine = 2;"); // after head — excluded by the range itself
  });

  it("leaves the diff unrestricted when the transcript named no paths — show more, not less", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("mine.ts", "export const mine = 0;\n", "seed");
    const head = repo.commit("theirs.ts", "export const theirs = 1;\n", "theirs, inside range");

    const diff = sessionRangeDiff({ git: execGit, repoDir: dir, base, head, touchedPaths: [] });

    expect(diff).toContain("+export const theirs = 1;");
  });

  it("never diffs the working tree — an uncommitted change past head is invisible", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("mine.ts", "export const mine = 0;\n", "seed");
    const head = repo.commit("mine.ts", "export const mine = 1;\n", "mine, inside range");
    writeFileSync(join(dir, "mine.ts"), "export const mine = 99;\n", "utf8"); // dirty, uncommitted

    const diff = sessionRangeDiff({ git: execGit, repoDir: dir, base, head });

    expect(diff).not.toContain("mine = 99");
  });

  it("threads the repo dir through argv as -C, never through the git executor's own closure", () => {
    const fake = createFakeGit(() => "");

    sessionRangeDiff({ git: fake.git, repoDir: "/some/repo", base: "abc", head: "def", touchedPaths: ["a.ts"] });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual(["-C", "/some/repo", "diff", "--no-color", "abc", "def", "--", "a.ts"]);
  });
});
