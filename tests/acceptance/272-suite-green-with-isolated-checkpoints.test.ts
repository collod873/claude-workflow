import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKOUT_CHECKPOINTS_DIR, ISOLATE_CHECKPOINTS_SETUP } from "./272-checkpoint.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * #272's seventh criterion, quoted verbatim in the test name below.
 *
 * Two claims, and the second is the one with teeth. The criterion is not "the suite is green" - it
 * was already green before this ticket, and it stays green even with the isolation removed, because
 * a stage that writes its checkpoint into the checkout still returns the right answer to the test
 * that called it. What breaks without isolation is the *next* run: nine checkpoint files are left
 * behind in `.Workflow/agent-workflows/checkpoints/`, gitignored and so invisible to `git status`,
 * waiting for a later test file to read one as a stale key-matching hit it never wrote. So this
 * asserts the suite is green *and* that it left nothing in the checkout - the observable difference
 * between isolated and not.
 *
 * It deliberately does not read `vitest.config.ts`. That file is in IMMUTABLE_SET, so no pull request
 * may touch it, and an earlier version of this test required it to change - a criterion no
 * implementer could satisfy and lane 06 would refuse regardless. How the isolation is wired is the
 * implementer's to choose; that it holds is this test's to check. (#278)
 *
 * The child's environment is stripped of the outer run's own markers so it starts a clean run rather
 * than believing it is already inside one, of FAILURE_REASON_PATH so no probe of this directory's
 * leaks into it, and of CHECKPOINTS_DIR - without that last one the child would inherit whatever
 * temp directory isolated *this* file and could not write to the checkout even unisolated, which
 * would make the assertion below vacuous. `.Workflow .claude` are filters over the configured
 * include, so the nested run never collects this directory and cannot recurse.
 */

describe("the suite that already passes still passes", () => {
  it("The full pre-existing suite passes with checkpoint writes isolated per test file — check: `npx vitest run .Workflow .claude`", () => {
    expect(
      existsSync(ISOLATE_CHECKPOINTS_SETUP),
      "there is no isolate-checkpoints.setup.ts at " + ISOLATE_CHECKPOINTS_SETUP,
    ).toBe(true);

    // Cleared first so what is found afterwards is what this run wrote, not what a previous one did.
    // Safe to delete: the directory is regenerated per run and gitignored, never source.
    rmSync(CHECKOUT_CHECKPOINTS_DIR, { recursive: true, force: true });

    const env: NodeJS.ProcessEnv = { ...process.env, CI: "1" };
    delete env.VITEST;
    delete env.VITEST_WORKER_ID;
    delete env.VITEST_POOL_ID;
    delete env.VITEST_MODE;
    delete env.FAILURE_REASON_PATH;
    delete env.CHECKPOINTS_DIR;

    const run = spawnSync("npx", ["vitest", "run", ".Workflow", ".claude"], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
      timeout: 1_500_000,
      maxBuffer: 256 * 1024 * 1024,
    });

    expect(
      run.status,
      "`npx vitest run .Workflow .claude` is red | stdout: " +
        (run.stdout ?? "") +
        " | stderr: " +
        (run.stderr ?? ""),
    ).toBe(0);

    const leaked = existsSync(CHECKOUT_CHECKPOINTS_DIR)
      ? readdirSync(CHECKOUT_CHECKPOINTS_DIR)
      : [];
    expect(
      leaked,
      "the suite wrote checkpoints into the checkout at " +
        CHECKOUT_CHECKPOINTS_DIR +
        ", so they are not isolated per test file and the next run will read them as its own",
    ).toEqual([]);
  }, 1_800_000);
});
