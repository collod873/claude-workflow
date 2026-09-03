import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { repoScoped, toRepoRelative, worktreeRoot } from "./touched-paths";

const ROOT = "/home/collin/Claude Projects/Workflow";

describe("toRepoRelative", () => {
  it("rewrites an in-repo absolute path relative to the root, with forward slashes", () => {
    expect(toRepoRelative([`${ROOT}/.claude/hooks/session-capture.sh`], ROOT)).toEqual([
      ".claude/hooks/session-capture.sh",
    ]);
  });

  it("drops an edit that was never in the repo", () => {
    expect(
      toRepoRelative(
        [
          "/home/collin/.claude/settings.json",
          `${ROOT}/.Workflow/agent-workflows/shared/spine.ts`,
          "/tmp/claude-1000/scratchpad/103.md",
        ],
        ROOT,
      ),
    ).toEqual([".Workflow/agent-workflows/shared/spine.ts"]);
  });

  it("drops a sibling directory that merely shares the root's prefix", () => {
    expect(toRepoRelative([`${ROOT}-old/a.ts`], ROOT)).toEqual([]);
  });

  it("relativises against the worktree the session ran in, not this checkout", () => {
    expect(toRepoRelative(["/home/collin/other-clone/a.ts"], "/home/collin/other-clone")).toEqual(["a.ts"]);
  });

  it("passes relative paths through and dedupes, first occurrence winning", () => {
    expect(toRepoRelative(["a.ts", `${ROOT}/a.ts`, "b.ts"], ROOT)).toEqual(["a.ts", "b.ts"]);
  });

  it("drops the root itself, which is a pathspec for everything rather than for a file", () => {
    expect(toRepoRelative([ROOT], ROOT)).toEqual([]);
  });
});

describe("repoScoped", () => {
  it("keeps the relative paths a checkout anywhere can diff", () => {
    expect(repoScoped(["a.ts", ".claude/hooks/session-capture.sh"])).toEqual([
      "a.ts",
      ".claude/hooks/session-capture.sh",
    ]);
  });

  it("drops the absolute paths the pre-fix records carry, since it cannot know what they meant", () => {
    expect(repoScoped([`${ROOT}/a.ts`, "/home/collin/.claude/settings.json", "b.ts"])).toEqual(["b.ts"]);
  });

  it("drops a path escaping the repo root", () => {
    expect(repoScoped(["../elsewhere/a.ts", "a/../b.ts"])).toEqual([]);
  });
});

describe("worktreeRoot", () => {
  it("is git's own answer for the session's cwd, asked of that cwd", () => {
    const fake = createFakeGit(() => `${ROOT}\n`);
    expect(worktreeRoot(fake.git, `${ROOT}/docs`)).toBe(ROOT);
    expect(fake.calls).toEqual([["-C", `${ROOT}/docs`, "rev-parse", "--show-toplevel"]]);
  });

  it("is undefined, not a throw, outside a work tree", () => {
    const git = () => {
      throw new Error("fatal: not a git repository");
    };
    expect(worktreeRoot(git, "/tmp")).toBeUndefined();
  });
});
