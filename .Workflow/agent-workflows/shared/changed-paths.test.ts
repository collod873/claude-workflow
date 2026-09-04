import { describe, expect, it } from "vitest";
import { changedPaths } from "./changed-paths";
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
