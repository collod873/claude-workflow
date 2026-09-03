import { describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../shared/temp-repo.fixture";
import { worktreeChanges } from "./implement";

/**
 * `worktreeChanges` against real git, not the fake.
 *
 * The fake in `shared/implementation-landing.test.ts` proves what the lane *does* with an answer
 * from git; it cannot prove the answer is real, because it is the thing supplying it. What is
 * load-bearing here is a claim about `git status --porcelain -- <paths>` itself — that it reports a
 * modified tracked file, reports an untracked new one, stays silent about a path that matches HEAD,
 * and confines itself to the paths it is given. If any of those is wrong, the fake agrees with the
 * bug and lane 05 throws away another twenty minutes of work (ADR-0103). So this asks git.
 */

/** A real repo with one commit: `a/b.ts` and `a/other.ts`, both holding their original content. */
function fixtureRepo(): TempRepo {
  const repo = makeTempRepo("worktree-changes");
  repo.write("a/b.ts", "export const x = 1;\n");
  repo.write("a/other.ts", "export const y = 1;\n");
  repo.commit("first");
  return repo;
}

/** `worktreeChanges` asked of `repo`, through the same `GitExec` shape production binds. */
const changesIn = (repo: TempRepo, paths: string[]) => worktreeChanges((args) => repo.git(...args), paths);

describe("worktreeChanges, against a real repository", () => {
  it("reports nothing when the path still matches the commit the run started at", () => {
    expect(changesIn(fixtureRepo(), ["a/b.ts"])).toEqual([]);
  });

  /**
   * The #237 case. The implementer edited the file itself during its run, then reported that same
   * content — so a filesystem comparison sees agreement and git sees the work.
   */
  it("reports a tracked file the implementer edited in place", () => {
    const repo = fixtureRepo();
    repo.write("a/b.ts", "export const x = 2;\n");

    expect(changesIn(repo, ["a/b.ts"])).toHaveLength(1);
  });

  it("reports a file the implementer created, which is untracked and so absent from a plain diff", () => {
    const repo = fixtureRepo();
    repo.write("a/new.ts", "export const z = 1;\n");

    expect(changesIn(repo, ["a/new.ts"])).toHaveLength(1);
  });

  it("ignores a change to a path it was not asked about, so a stray edit cannot make a no-op look like work", () => {
    const repo = fixtureRepo();
    repo.write("a/other.ts", "export const y = 2;\n");

    expect(changesIn(repo, ["a/b.ts"])).toEqual([]);
  });

  it("asks git nothing when the implementer reported no files at all", () => {
    const calls: string[][] = [];

    expect(worktreeChanges((args) => (calls.push(args), ""), [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
