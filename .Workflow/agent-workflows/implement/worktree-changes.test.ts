import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GitExec } from "../shared/git";
import { worktreeChanges } from "./implement";

/**
 * `worktreeChanges` against real git, not the fake.
 *
 * The fake in `implement.test.ts` proves what the lane *does* with an answer from git; it cannot
 * prove the answer is real, because it is the thing supplying it. What is load-bearing here is a
 * claim about `git status --porcelain -- <paths>` itself — that it reports a modified tracked file,
 * reports an untracked new one, stays silent about a path that matches HEAD, and confines itself to
 * the paths it is given. If any of those is wrong, the fake agrees with the bug and lane 05 throws
 * away another twenty minutes of work (ADR-0103). So this asks git.
 */
const repos: string[] = [];

afterAll(() => {
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
});

/** A real repo with one commit: `a/b.ts` and `a/other.ts`, both holding their original content. */
function fixtureRepo(): { git: GitExec; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "worktree-changes-"));
  repos.push(dir);
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  run(["init", "-q"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  mkdirSync(join(dir, "a"), { recursive: true });
  writeFileSync(join(dir, "a/b.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "a/other.ts"), "export const y = 1;\n");
  run(["add", "."]);
  run(["commit", "-q", "-m", "first"]);
  return { git: (args) => run(args), dir };
}

describe("worktreeChanges, against a real repository", () => {
  it("reports nothing when the path still matches the commit the run started at", () => {
    const { git } = fixtureRepo();

    expect(worktreeChanges(git, ["a/b.ts"])).toEqual([]);
  });

  /**
   * The #237 case. The implementer edited the file itself during its run, then reported that same
   * content — so a filesystem comparison sees agreement and git sees the work.
   */
  it("reports a tracked file the implementer edited in place", () => {
    const { git, dir } = fixtureRepo();
    writeFileSync(join(dir, "a/b.ts"), "export const x = 2;\n");

    expect(worktreeChanges(git, ["a/b.ts"])).toHaveLength(1);
  });

  it("reports a file the implementer created, which is untracked and so absent from a plain diff", () => {
    const { git, dir } = fixtureRepo();
    writeFileSync(join(dir, "a/new.ts"), "export const z = 1;\n");

    expect(worktreeChanges(git, ["a/new.ts"])).toHaveLength(1);
  });

  it("ignores a change to a path it was not asked about, so a stray edit cannot make a no-op look like work", () => {
    const { git, dir } = fixtureRepo();
    writeFileSync(join(dir, "a/other.ts"), "export const y = 2;\n");

    expect(worktreeChanges(git, ["a/b.ts"])).toEqual([]);
  });

  it("asks git nothing when the implementer reported no files at all", () => {
    const calls: string[][] = [];

    expect(worktreeChanges((args) => (calls.push(args), ""), [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
