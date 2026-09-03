import { describe, expect, it, vi } from "vitest";

const gitCalls: string[][] = [];

vi.mock("../shared/git", () => ({
  execGit: (args: string[]) => {
    gitCalls.push(args);
    return "";
  },
}));

vi.mock("../shared/gh", () => ({
  execGh: () => "",
}));

const { buildAcceptDeps } = await import("./run-accept");

describe("buildAcceptDeps", () => {
  it("binds every git call to the target checkout, not the process's own cwd", () => {
    gitCalls.length = 0;
    const deps = buildAcceptDeps("/some/target/checkout");

    deps.git(["add", "docs/adr/0999-x.md"]);
    deps.git(["commit", "-m", "x"]);
    deps.git(["fetch", "origin", "main"]);
    deps.git(["rebase", "origin/main"]);
    deps.git(["push", "origin", "HEAD:main"]);

    for (const call of gitCalls) {
      expect(call.slice(0, 2)).toEqual(["-C", "/some/target/checkout"]);
    }
    expect(gitCalls.map((call) => call[2])).toEqual(["add", "commit", "fetch", "rebase", "push"]);
  });
});
