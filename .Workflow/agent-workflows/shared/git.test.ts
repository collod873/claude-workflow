import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "./git";

/**
 * A throwaway repo with one commit, distinguishable from whatever repo an
 * inherited `GIT_DIR` might point at — `execGit`'s job under test is
 * reporting on *this* repo regardless of what the ambient environment
 * claims the repo is.
 */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "git-env-leak-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "fixture.txt"), "fixture\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "fixture commit"], { cwd: dir });
  return dir;
}

describe("execGit", () => {
  let dir: string | undefined;
  let originalGitDir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
    if (originalGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = originalGitDir;
    originalGitDir = undefined;
  });

  it("operates on the repo named by -C, not an inherited GIT_DIR", () => {
    dir = makeRepo();

    // A directory that is not a git repo at all: if GIT_DIR leaked through,
    // git would fail to even find a repo there rather than silently
    // succeeding against the wrong one — either way this proves -C won.
    const decoy = mkdtempSync(join(tmpdir(), "git-env-leak-decoy-"));
    try {
      originalGitDir = process.env.GIT_DIR;
      process.env.GIT_DIR = join(decoy, ".git");

      const log = execGit(["-C", dir, "log", "--format=%s"]);

      expect(log.trim()).toBe("fixture commit");
    } finally {
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});
