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

/**
 * `accept.ts`'s `commitAndPush` adds, commits, fetches, rebases and pushes with no path of its
 * own — `git`'s docstring (`shared/git.ts`) is explicit that `execGit` carries no working
 * directory, so every caller has to thread the repo it means through argv. Before this bound
 * `-C targetWorkspace` in, every one of those five calls ran against `process.cwd()` — the machine
 * checkout, not the target's — and the ADRs and CONTEXT.md `accept.ts` had just written landed
 * nowhere `git status` in the target could ever see.
 */
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
