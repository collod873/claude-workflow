import { describe, expect, it } from "vitest";
import { agentWorkflowFixtures, agentWorkflowTests, sharedModules } from "./sources.fixture.ts";

/**
 * Every seam that spawns a child process sets `maxBuffer`.
 *
 * Node's default is 1 MB, and a child whose output exceeds it dies on
 * `spawnSync <cmd> ENOBUFS` — an error naming neither the command, nor the
 * size, nor the call that asked for too much. It is a cliff rather than a
 * slope: the seam works for months and then one listing crosses a megabyte.
 *
 * `git.ts` was given a 10 MB buffer. `gh.ts` was not, and the run watchdog's
 * first working run died reading one page of run objects (#41). That is the
 * third time in this repo a fix has been made in one file and not in its
 * sibling — after the dispatch name (#107) and the runner's git identity
 * (#109) — so it gets the same answer those did: a guard that holds every
 * seam to it, rather than a second file brought level and left to drift again.
 *
 * Both sweeps read source as text, through `sources.fixture.ts` — a guard over files it does not
 * know the names of yet cannot import them.
 */

/** A seam is a shared module that spawns a child process synchronously. */
const SPAWNS = /execFileSync\(/;

const SETS_MAX_BUFFER = /maxBuffer:/;

/**
 * The source with its comments removed. `scrub-git-env.setup.ts` explains
 * the `execFileSync` shape the fixture tests use, in prose, and spawns
 * nothing itself — a guard that read that as a call would be asking a
 * comment to set a buffer.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const seams = sharedModules()
  .map(({ name, source }) => ({ name, source: code(source) }))
  .filter(({ source }) => SPAWNS.test(source));

describe("every exec seam sets maxBuffer", () => {
  it("finds the seams, so a passing suite is not an empty sweep", () => {
    expect(seams.map(({ name }) => name).sort()).toEqual(expect.arrayContaining(["gh.ts", "git.ts"]));
  });

  it.each(seams)("$name", ({ name, source }) => {
    expect(
      SETS_MAX_BUFFER.test(source),
      `${name} spawns a child without setting maxBuffer — Node's 1 MB default makes any output past ` +
        "it exit `ENOBUFS`, an error that names neither the command nor the size",
    ).toBe(true);
  });
});

/**
 * Every test that spawns an entrypoint with the ambient environment neutralises
 * `TARGET_WORKSPACE`.
 *
 * Every lane's runner exports it (ADR-0055) and every entrypoint reads it
 * *ahead* of `GITHUB_WORKSPACE` and `process.cwd()`. So a test that hands its
 * child `{ ...process.env, GITHUB_WORKSPACE: <the repo it just built> }` is
 * overridden by the runner's value and audits the lane's own target checkout
 * instead — green on a workstation, where nothing sets it, and red on every
 * runner. `observations/run-audit`'s test shipped that way and took lane 08
 * with it: three failures in the pre-push gauntlet meant no pull request could
 * be merged by the pipeline at all, for a week, while the same suite passed
 * locally.
 *
 * The same "one file fixed, its sibling left to drift" shape as the guard
 * above, so it gets the same answer.
 */

/**
 * Hands a child the caller's own environment *and* points it at a repo with
 * `GITHUB_WORKSPACE` — the exact pair that goes wrong. A spawn that sets no
 * workspace at all (`capture/`'s, which reads neither variable) is not this
 * bug, and a guard that flagged it would be asking for a line that changes
 * nothing.
 */
const INHERITS_ENV = /env:\s*(?:cliEnv\(process\.env|\{[\s\S]{0,400}?\.\.\.process\.env)/;
const POINTS_AT_A_REPO = /GITHUB_WORKSPACE/;

/**
 * Names `TARGET_WORKSPACE` in *code* — a prose explanation of the hazard, in a
 * comment, is what a file that has the bug and knows it would also carry.
 */
const NEUTRALISES = /TARGET_WORKSPACE/;

const spawningTests = agentWorkflowTests().filter(
  ({ source }) => SPAWNS.test(code(source)) && INHERITS_ENV.test(code(source)) && POINTS_AT_A_REPO.test(code(source)),
);

describe("a test spawning an entrypoint with the ambient environment neutralises TARGET_WORKSPACE", () => {
  it("finds the tests that spawn, so a passing suite is not an empty sweep", () => {
    // The run-audit suite, under either of the names it has carried — a `.proc.test.ts` still
    // ends in `.test.ts`, and is still the sentinel this sweep has to find.
    expect(spawningTests.map(({ name }) => name)).toContainEqual(
      expect.stringMatching(/^agent-workflows\/observations\/run-audit(\.proc)?\.test\.ts$/),
    );
  });

  it.each(spawningTests)("$name", ({ name, source }) => {
    expect(
      NEUTRALISES.test(code(source)),
      `${name} spawns an entrypoint with the ambient environment and never mentions TARGET_WORKSPACE — ` +
        "every runner exports it and every entrypoint reads it ahead of GITHUB_WORKSPACE, so the child " +
        "will read the lane's target checkout rather than the repo this test built. Pass it explicitly, " +
        'or clear it with `TARGET_WORKSPACE: ""`',
    ).toBe(true);
  });
});

/**
 * Every test-side spawner passes `stdio`.
 *
 * `execFileSync` does not merely capture the child's stderr — it *also* echoes it to the parent's
 * own fd 2. So a test that exercises a failure path on purpose prints the failure it was written
 * to assert on, straight into the verify log, and not even through the vitest worker: the runner
 * never sees the bytes, so it cannot label them `stderr | <test name>` the way it labels a
 * `console.error` from inside a test. The reader gets 190 lines of what looks like a broken suite
 * above `2203 passed`, with no test name attached to any of it.
 *
 * The echo is the whole of the cost. `err.stderr` is populated either way and the child's stderr
 * is folded into the thrown `Error`'s message either way, so `["pipe", "pipe", "pipe"]` — the
 * default in every respect except the echo — loses no diagnostic and changes no assertion.
 *
 * This is the same shape as the two guards above, and it arrived the same way: `rule-trial.ts` and
 * `reason.proc.test.ts` had already been given an explicit `stdio`, and the eleven other spawners
 * had not. So it gets the same answer — a rule over every spawner, rather than two files brought
 * level and the rest left to drift.
 *
 * The sweep is over tests and fixtures only, though `git.ts` was piped for the same reason and by
 * the same argument — it was the loudest single source left, and git reports routine progress on
 * stderr. The remaining production seams are simply not ruled on yet, so the sweep does not hold
 * them to something nobody has decided; it is not that they are exempt.
 */
const SETS_STDIO = /stdio:/;

const testSideSpawners = [...agentWorkflowTests(), ...agentWorkflowFixtures()].filter(({ source }) =>
  SPAWNS.test(code(source)),
);

describe("every test-side spawner passes stdio", () => {
  it("finds the spawners, so a passing suite is not an empty sweep", () => {
    expect(testSideSpawners.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining([
        "agent-workflows/shared/temp-repo.fixture.ts",
        "agent-workflows/to-tickets/stage-cli.fixture.ts",
      ]),
    );
  });

  it.each(testSideSpawners)("$name", ({ name, source }) => {
    expect(
      SETS_STDIO.test(code(source)),
      `${name} spawns a child without passing stdio — execFileSync echoes the child's stderr to this ` +
        "process's stderr on top of capturing it, so a test exercising a failure path prints that failure " +
        "into the verify log, unlabelled and indistinguishable from a real one. Pass " +
        '`stdio: ["pipe", "pipe", "pipe"]`, which is the default minus the echo',
    ).toBe(true);
  });
});
