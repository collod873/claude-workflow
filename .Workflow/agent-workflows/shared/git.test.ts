import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "./git";
import { scratchDir } from "./scratch.fixture";
import { makeTempRepo } from "./temp-repo.fixture";

describe("execGit", () => {
  let originalGitDir: string | undefined;

  afterEach(() => {
    if (originalGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = originalGitDir;
    originalGitDir = undefined;
  });

  it("operates on the repo named by -C, not an inherited GIT_DIR", () => {
    // A throwaway repo with one commit, distinguishable from whatever repo an inherited `GIT_DIR`
    // might point at — `execGit`'s job under test is reporting on *this* repo regardless of what
    // the ambient environment claims the repo is.
    const repo = makeTempRepo("git-env-leak");
    repo.write("fixture.txt", "fixture\n");
    repo.commit("fixture commit");

    // A directory that is not a git repo at all: if GIT_DIR leaked through,
    // git would fail to even find a repo there rather than silently
    // succeeding against the wrong one — either way this proves -C won.
    const decoy = scratchDir("git-env-leak-decoy");
    originalGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(decoy, ".git");

    const log = execGit(["-C", repo.dir, "log", "--format=%s"]);

    expect(log.trim()).toBe("fixture commit");
  });
});
