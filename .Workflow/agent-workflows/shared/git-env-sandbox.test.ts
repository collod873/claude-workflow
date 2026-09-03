import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GIT_LOCATION_VARS, TARGET_LOCATION_VARS } from "./child-env";
import { makeTempRepo, type TempRepo } from "./temp-repo.fixture.ts";

/**
 * #86: with `GIT_DIR` exported, every fixture in this suite committed into the
 * repository the suite was running inside — 74 commits onto `main`, once
 * pushed to `origin`. The seam (`git.ts`, `gh.ts`) was already scrubbed; the
 * fixtures were not, because a fixture spawned `git` with the inherited
 * environment and never touched the seam.
 *
 * Two things hold the fix in place now. `scrub-git-env.setup.ts` removes the
 * variables from every worker's own `process.env`, which the first block
 * checks is wired. And every git-touching fixture is built on
 * `temp-repo.fixture.ts`, whose `git` scrubs them again on each spawn — so a
 * fixture-spawned `git` ignores an inherited `GIT_DIR` even when one is set
 * *after* the setup file ran, which is what the last case stages. The half
 * that cannot live in code — *no* test in the suite writes to its own
 * repository, including tests written after this one — is demonstrated rather
 * than asserted, by the gauntlet running the whole suite against a throwaway
 * repository named by `GIT_DIR` and failing if a single object appears in it.
 */

/**
 * Every branch tip in `repo` — empty for a repository nothing has committed to.
 * `for-each-ref` rather than `rev-parse HEAD` because an unborn HEAD is the
 * expected answer here, and `rev-parse` reports that by exiting non-zero.
 */
function branchTips(repo: TempRepo): string[] {
  return repo.git("for-each-ref", "--format=%(objectname)", "refs/heads").split("\n").filter((line) => line !== "");
}

describe("git location variables in the test environment", () => {
  // The wiring test. If `setupFiles` is dropped from `vitest.config.ts`, or a future config
  // rewrite replaces the array instead of appending to it, this is what goes red — and it goes
  // red in every venue, not only the one that happened to have `GIT_DIR` set.
  it.each(GIT_LOCATION_VARS)("is not in the worker's environment: %s", (name) => {
    expect(process.env[name]).toBeUndefined();
  });

  // Why the fixture has to scrub at all: `cwd` is not what decides which repository a `git` child
  // writes to — an inherited `GIT_DIR` beats it every time. This stays here so nobody
  // "simplifies" the scrub away on the theory that `cwd` was already enough.
  it("keeps a fixture's commit in the fixture when the worker inherits a GIT_DIR naming another repo", () => {
    const fixture = makeTempRepo("git-env-fixture");
    const victim = makeTempRepo("git-env-victim");

    process.env.GIT_DIR = join(victim.dir, ".git");
    try {
      fixture.write("a.txt", "a");
      fixture.commit("seed");
    } finally {
      delete process.env.GIT_DIR;
    }

    expect(branchTips(fixture)).toHaveLength(1);
    expect(branchTips(victim)).toEqual([]);
  });
});

/**
 * Why `TARGET_LOCATION_VARS` and `scrubTargetLocationVars` exist is written once, in their
 * docstrings in `child-env.ts` (run 33698888723). This file only holds the wiring in place.
 *
 * Nothing here reproduces the redirection the way the git half above does: `new-adr.proc.test.ts`'s
 * "drafts and lands into the target checkout … given TARGET_WORKSPACE" already drives it, on
 * purpose, from an explicit per-call value. That is the distinction this describe keeps standing —
 * set on the call it is a seam, inherited from the worker it is a leak.
 */
describe("the machine's location variable in the test environment", () => {
  // The wiring test, and the only half of this that can speak for a test nobody has written yet.
  it.each(TARGET_LOCATION_VARS)("is not in the worker's environment: %s", (name) => {
    expect(process.env[name]).toBeUndefined();
  });
});
