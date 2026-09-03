import { describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../shared/temp-repo.fixture";
import { worktreeChanges } from "./implement";

function fixtureRepo(): TempRepo {
  const repo = makeTempRepo("worktree-changes");
  repo.write("a/b.ts", "export const x = 1;\n");
  repo.write("a/other.ts", "export const y = 1;\n");
  repo.commit("first");
  return repo;
}

const changesIn = (repo: TempRepo, paths: string[]) => worktreeChanges((args) => repo.git(...args), paths);

describe("worktreeChanges, against a real repository", () => {
  it("reports nothing when the path still matches the commit the run started at", () => {
    expect(changesIn(fixtureRepo(), ["a/b.ts"])).toEqual([]);
  });

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
