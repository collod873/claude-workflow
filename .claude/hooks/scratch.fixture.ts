import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * @fixture Reached only from the suite, by design.
 */
export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
