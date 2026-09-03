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
    const repo = makeTempRepo("git-env-leak");
    repo.write("fixture.txt", "fixture\n");
    repo.commit("fixture commit");

    const decoy = scratchDir("git-env-leak-decoy");
    originalGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(decoy, ".git");

    const log = execGit(["-C", repo.dir, "log", "--format=%s"]);

    expect(log.trim()).toBe("fixture commit");
  });
});
