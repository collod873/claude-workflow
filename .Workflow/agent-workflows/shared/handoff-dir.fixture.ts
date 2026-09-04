import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * @fixture Hands the suite a throwaway handoff dir and restores the env after; a lane uses the real one.
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
