import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The repo-relative fallback for `handoffPath()` — used for a local run,
 * where the runner's `FAILURE_REASON_PATH` env var is never set.
 */
const DEFAULT_HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

/**
 * Where a dying stage's failure reason lands. Resolved live, not fixed at
 * import time, so both venues a pipeline runs in agree on the same file
 * rather than two paths that can drift apart: the runner sets
 * `FAILURE_REASON_PATH` to `${{ runner.temp }}/failure_reason.txt`, which the
 * workflow's `if: failure()` reporter reads; a local debug run has no such
 * env var, so it falls back to a repo-relative path instead.
 *
 * **What this is no longer for.** It used to also be where a stage's
 * *accepted* output landed, read back by the next stage as its own input —
 * one path serving both a handoff and a failure surface. A successful stage
 * now checkpoints instead (`../shared/stage.ts`'s `runStage`), so this file
 * carries a failure reason or nothing at all.
 */
export function handoffPath(): string {
  return process.env.FAILURE_REASON_PATH || DEFAULT_HANDOFF_PATH;
}

/**
 * Writes a stage's failure reason to the handoff path. Overwrites whatever
 * was there — on failure there is nothing downstream left to read a stale
 * success from.
 */
export function writeFailure(stage: string, reason: string): void {
  const path = handoffPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stage}: ${reason}\n`, "utf8");
}
