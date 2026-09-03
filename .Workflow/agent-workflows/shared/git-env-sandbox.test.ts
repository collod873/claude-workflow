import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GIT_LOCATION_VARS, TARGET_LOCATION_VARS, scrubGitLocationVars } from "./child-env";

/**
 * #86: with `GIT_DIR` exported, every fixture in this suite committed into the
 * repository the suite was running inside — 74 commits onto `main`, once
 * pushed to `origin`. The seam (`git.ts`, `gh.ts`) was already scrubbed; the
 * fixtures were not, because a fixture spawns `git` with the inherited
 * environment and never touches the seam.
 *
 * These tests hold the two halves of the fix that live in code. The half that
 * cannot live in code — *no* test in the suite writes to its own repository,
 * including tests written after this one — is demonstrated rather than
 * asserted, by `bin/gauntlet` running the whole suite against a throwaway
 * repository named by `GIT_DIR` and failing if a single object appears in it.
 */

/** A repo a fixture means to write to, and a repo it must not. */
function makeRepos(): { fixture: string; victim: string } {
  const fixture = mkdtempSync(join(tmpdir(), "git-env-fixture-"));
  const victim = mkdtempSync(join(tmpdir(), "git-env-victim-"));
  for (const dir of [fixture, victim]) {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  }
  return { fixture, victim };
}

/** The shape every git-touching fixture in this repo uses: argv, a `cwd`, an inherited env. */
function commitLikeAFixture(dir: string, env: NodeJS.ProcessEnv): void {
  writeFileSync(join(dir, "a.txt"), "a", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: dir, env });
}

/**
 * Every branch tip in `dir` — empty for a repository nothing has committed to.
 * `for-each-ref` rather than `rev-parse HEAD` because an unborn HEAD is the
 * expected answer here, and `rev-parse` reports that by exiting non-zero.
 */
function branchTips(dir: string): string[] {
  return execFileSync("git", ["for-each-ref", "--format=%(objectname)", "refs/heads"], {
    cwd: dir,
    encoding: "utf8",
    env: scrubGitLocationVars({ ...process.env }),
  })
    .split("\n")
    .filter((line) => line !== "");
}

describe("git location variables in the test environment", () => {
  let repos: { fixture: string; victim: string } | undefined;

  afterEach(() => {
    if (repos) {
      rmSync(repos.fixture, { recursive: true, force: true });
      rmSync(repos.victim, { recursive: true, force: true });
      repos = undefined;
    }
  });

  // The wiring test. If `setupFiles` is dropped from `vitest.config.ts`, or a future config
  // rewrite replaces the array instead of appending to it, this is what goes red — and it goes
  // red in every venue, not only the one that happened to have `GIT_DIR` set.
  it.each(GIT_LOCATION_VARS)("is not in the worker's environment: %s", (name) => {
    expect(process.env[name]).toBeUndefined();
  });

  // Why the scrub has to exist at all: `cwd` is not what decides which repository a `git` child
  // writes to. This is the defect reproduced in miniature, and it stays here so nobody
  // "simplifies" the scrub away on the theory that `cwd` was already enough.
  it("lets an inherited GIT_DIR steal a fixture's commit", () => {
    repos = makeRepos();
    commitLikeAFixture(repos.fixture, { ...process.env, GIT_DIR: join(repos.victim, ".git") });

    expect(branchTips(repos.fixture)).toEqual([]);
    expect(branchTips(repos.victim)).toHaveLength(1);
  });

  it("keeps the commit in the fixture once the variables are scrubbed", () => {
    repos = makeRepos();
    const inherited = { ...process.env, GIT_DIR: join(repos.victim, ".git") };
    commitLikeAFixture(repos.fixture, scrubGitLocationVars(inherited));

    expect(branchTips(repos.fixture)).toHaveLength(1);
    expect(branchTips(repos.victim)).toEqual([]);
  });
});

/**
 * The same argument, one variable later. `TARGET_WORKSPACE` names *which checkout* a machine script
 * acts on, and every machine script reads it ambiently — so exported, it beats a script's own
 * location the way `GIT_DIR` beats a `cwd`.
 *
 * Lane 05 and the fixer both export it for the whole step the suite runs inside. That is how
 * `new-adr.test.ts` — which copies `bin/new-adr` into a scratch tree precisely so it cannot reach
 * the real corpus — wrote three fixture ADRs into the repository under test instead, and the
 * `corpus` check racing beside the suite refused the push (run 33698888723). Unset on a
 * workstation, so it is invisible until a runner splits the machine from the target.
 *
 * There is no decoy here to match `bin/gauntlet`'s git sandbox, and none is owed: nothing outside
 * this repository honours this name, so removing it from the worker removes it from every process a
 * fixture can spawn. The redirection itself is not reproduced here either — `new-adr.test.ts`'s
 * "drafts and lands into the target checkout … given TARGET_WORKSPACE" already drives it, on
 * purpose, from an explicit per-call value. That is the whole distinction this holds in place: set
 * on the call it is a seam, inherited from the worker it is a leak.
 */
describe("the machine's location variable in the test environment", () => {
  // The wiring test, and the only half of this that can speak for a test nobody has written yet.
  it.each(TARGET_LOCATION_VARS)("is not in the worker's environment: %s", (name) => {
    expect(process.env[name]).toBeUndefined();
  });
});
