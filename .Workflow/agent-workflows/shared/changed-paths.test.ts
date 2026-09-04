import { describe, expect, it } from "vitest";
import { changedPaths, describeAttempt } from "./changed-paths";
import type { GitExec } from "./git";

describe("changedPaths", () => {
  function gitReporting(porcelain: string) {
    return ((args) => (args[0] === "status" ? porcelain : "")) as GitExec;
  }

  it("asks git for the stable, config-independent format, listing new files one by one", () => {
    const calls: string[][] = [];
    changedPaths((args) => {
      calls.push([...args]);
      return "";
    });
    expect(calls).toEqual([["status", "--porcelain", "-uall"]]);
  });

  it("reads back a modified, an added and a deleted path", () => {
    expect(changedPaths(gitReporting(" M a.ts\n?? b.ts\n D c.ts"))).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("is empty for a clean tree, a stage that answered without changing anything", () => {
    expect(changedPaths(gitReporting(""))).toEqual([]);
    expect(changedPaths(gitReporting("\n"))).toEqual([]);
  });

  it("takes the destination of a rename, not the source", () => {
    expect(changedPaths(gitReporting("R  old.ts -> new.ts"))).toEqual(["new.ts"]);
  });

  it("keeps a path that contains spaces intact", () => {
    expect(changedPaths(gitReporting(" M docs/some notes.md"))).toEqual(["docs/some notes.md"]);
  });

  it("strips the quotes git puts around a non-ASCII path", () => {
    expect(changedPaths(gitReporting(' M "docs/caf\\303\\251.md"'))).toEqual(["docs/caf\\303\\251.md"]);
  });
});

describe("describeAttempt", () => {
  function gitAnswering(diff: string, status: string): GitExec {
    return (args) => (args[0] === "diff" ? diff : args[0] === "status" ? status : "");
  }

  it("is the diff alone when it already shows every changed path", () => {
    const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new";

    expect(describeAttempt(gitAnswering(diff, " M a.ts"))).toBe(diff);
  });

  it("appends an Untracked: list for a changed path the diff never shows", () => {
    expect(describeAttempt(gitAnswering("", "?? new.ts"))).toBe("\nUntracked:\n- new.ts");
  });

  it("lists only the paths the diff omits, when it shows some but not all", () => {
    const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new";

    expect(describeAttempt(gitAnswering(diff, " M a.ts\n?? new.ts"))).toBe(`${diff}\nUntracked:\n- new.ts`);
  });
});
