import { describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { makeTempRepo, type TempRepo } from "../shared/temp-repo.fixture";
import { sessionRangeDiff } from "./diff";

function commitFile(repo: TempRepo, path: string, contents: string, message: string): string {
  repo.write(path, contents);
  return repo.commit(message);
}

describe("sessionRangeDiff", () => {
  it("scopes the diff to base..head, excluding commits outside the range, and to touched paths, excluding files the transcript doesn't name", () => {
    const repo = makeTempRepo("session-range-diff");

    const base = commitFile(repo, "prehistory.ts", "export const prehistory = true;\n", "seed"); 
    commitFile(repo, "mine.ts", "export const mine = 1;\n", "mine, inside range"); 
    const head = commitFile(repo, "theirs.ts", "export const theirs = 1;\n", "theirs, inside range"); 
    commitFile(repo, "mine.ts", "export const mine = 2;\n", "after head, outside range"); 

    const diff = sessionRangeDiff({ git: execGit, repoDir: repo.dir, base, head, touchedPaths: ["mine.ts"] });

    expect(diff).toContain("+export const mine = 1;"); 
    expect(diff).not.toContain("theirs.ts"); 
    expect(diff).not.toContain("prehistory"); 
    expect(diff).not.toContain("mine = 2;"); 
  });

  it("leaves the diff unrestricted when the transcript named no paths — show more, not less", () => {
    const repo = makeTempRepo("session-range-diff");

    const base = commitFile(repo, "mine.ts", "export const mine = 0;\n", "seed");
    const head = commitFile(repo, "theirs.ts", "export const theirs = 1;\n", "theirs, inside range");

    const diff = sessionRangeDiff({ git: execGit, repoDir: repo.dir, base, head, touchedPaths: [] });

    expect(diff).toContain("+export const theirs = 1;");
  });

  it("never diffs the working tree — an uncommitted change past head is invisible", () => {
    const repo = makeTempRepo("session-range-diff");

    const base = commitFile(repo, "mine.ts", "export const mine = 0;\n", "seed");
    const head = commitFile(repo, "mine.ts", "export const mine = 1;\n", "mine, inside range");
    repo.write("mine.ts", "export const mine = 99;\n"); 

    const diff = sessionRangeDiff({ git: execGit, repoDir: repo.dir, base, head });

    expect(diff).not.toContain("mine = 99");
  });

  it("threads the repo dir through argv as -C, never through the git executor's own closure", () => {
    const fake = createFakeGit(() => "");

    sessionRangeDiff({ git: fake.git, repoDir: "/some/repo", base: "abc", head: "def", touchedPaths: ["a.ts"] });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual(["-C", "/some/repo", "diff", "--no-color", "abc", "def", "--", "a.ts"]);
  });
});
