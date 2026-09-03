import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * A throwaway directory for one test, removed when the test finishes — pass or fail — so the
 * caller keeps no `afterEach` of its own. `prefix` names the directory, so a stray one says which
 * test left it.
 *
 * It exists because the same six lines (a list, an `afterEach` draining it, a `mkdtempSync` that
 * pushes to it) had been retyped in a dozen test files by the time the clone gate lost its
 * baseline (#360). `onTestFinished` rather than `afterEach` because it binds to the test that
 * called it: a fixture created inside a nested `describe` is torn down at the right moment
 * without the file having to keep its own book.
 *
 * @fixture Reached only from the suite, by design.
 */
export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
