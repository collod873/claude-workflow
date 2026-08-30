import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ISOLATE_CHECKPOINTS_SETUP, VITEST_CONFIG } from "./272-checkpoint.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * #272's seventh criterion, quoted verbatim in the test name below.
 *
 * Two things, in the order a reader would check them. First that the isolation exists and is wired
 * where it can run per test file: setupFiles is the one list vitest runs inside each worker, which
 * is why the config change and the setup file are both claimed by this ticket. Then the criterion's
 * own check command, run from the checkout root.
 *
 * The child's environment is stripped of the outer run's own markers so it starts a clean run
 * rather than believing it is already inside one, and of FAILURE_REASON_PATH so no probe of this
 * directory's leaks into it. `.Workflow .claude` are filters over the configured include, so the
 * nested run never collects this directory and cannot recurse.
 */

describe("the suite that already passes still passes", () => {
  it("The full pre-existing suite passes with checkpoint writes isolated per test file — check: `npx vitest run .Workflow .claude`", () => {
    expect(
      existsSync(ISOLATE_CHECKPOINTS_SETUP),
      "there is no isolate-checkpoints.setup.ts at " + ISOLATE_CHECKPOINTS_SETUP,
    ).toBe(true);

    const config = readFileSync(VITEST_CONFIG, "utf8");
    const at = config.indexOf("setupFiles");
    expect(at, "vitest.config.ts declares no setupFiles at all").toBeGreaterThan(-1);
    const close = config.indexOf("]", at);
    const declared = config.slice(at, close === -1 ? config.length : close);
    expect(
      declared,
      "the checkpoint isolation is not in setupFiles, so nothing runs it per test file",
    ).toContain("isolate-checkpoints.setup.ts");

    const env: NodeJS.ProcessEnv = { ...process.env, CI: "1" };
    delete env.VITEST;
    delete env.VITEST_WORKER_ID;
    delete env.VITEST_POOL_ID;
    delete env.VITEST_MODE;
    delete env.FAILURE_REASON_PATH;

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
  }, 1_800_000);
});
