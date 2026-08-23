import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * A fresh temp dir for one test, plus whatever `FAILURE_REASON_PATH` handling
 * that test needs — a stage writes its handoff there, so the two lifecycles
 * are one thing, not two coincidentally adjacent ones.
 *
 * Saves the current `FAILURE_REASON_PATH` (a test is free to point it inside
 * the returned dir) and restores it, and removes the dir, once the test
 * finishes — pass or fail. Returns the dir.
 */
export function withHandoffDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "handoff-dir-"));
  const originalEnv = process.env.FAILURE_REASON_PATH;

  onTestFinished(() => {
    if (originalEnv === undefined) {
      delete process.env.FAILURE_REASON_PATH;
    } else {
      process.env.FAILURE_REASON_PATH = originalEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  return dir;
}
