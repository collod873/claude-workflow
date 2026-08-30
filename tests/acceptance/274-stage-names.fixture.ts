import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The child-process reader #274's two acceptance tests share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one.
 *
 * Both of this ticket's criteria close on a `npx vitest run <paths>` of their own, and they differ
 * only in which paths they name: one runs the new `lane-stage-names.test.ts` alone, the other runs
 * the whole `.Workflow .claude` suite. Written into each test file that is two copies of one
 * spawn-and-report, which is the divergence this directory's fixture convention exists to prevent
 * and which `bin/clone-gate` reports on push.
 *
 * **Why a child process at all.** CI restores `tests/acceptance/` from trunk before running it, and
 * restores only that directory — so nothing here may import the subject. A criterion whose own check
 * is a shell command is reached the way a shell reaches it: spawn it from the checkout root and read
 * what it did.
 *
 * The child's environment is stripped of the runner's own markers so it starts a clean run rather
 * than believing it is already inside one — the same reason `261-spec-sweep.fixture.ts` strips them.
 */

/** The check file #274's first criterion names, repo-relative, exactly as the criterion spells it. */
export const LANE_STAGE_NAMES_TEST = ".Workflow/agent-workflows/shared/lane-stage-names.test.ts";

/** A repo-relative path, resolved against this checkout. */
export function absolute(relative: string): string {
  return path.join(repoRoot, relative);
}

export interface VitestRun {
  /** `null` when the child was killed — a timeout, or a signal. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Both streams together, tail-truncated, so a failure message carries the reason without the world. */
  output: string;
}

/** The command a criterion names, spelled back the way the ticket spells it. */
export function commandLine(args: string[]): string {
  return `npx vitest run ${args.join(" ")}`;
}

function tail(text: string, limit = 12_000): string {
  return text.length <= limit ? text : `…\n${text.slice(text.length - limit)}`;
}

/** Runs `npx vitest run <args>` from the checkout root and reports what it did. */
export function runVitest(args: string[], timeoutMs = 900_000): VitestRun {
  const env: Record<string, string | undefined> = { ...process.env, CI: "1" };
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_MODE;

  const run = spawnSync("npx", ["vitest", "run", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: env as NodeJS.ProcessEnv,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  });

  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  return { status: run.status, stdout, stderr, output: tail(`${stdout}\n${stderr}`) };
}
