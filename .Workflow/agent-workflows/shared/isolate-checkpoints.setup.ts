import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach } from "vitest";

/**
 * @fixture vitest loads this through `setupFiles`, so no import edge reaches it and no lane should.
 */

const root = mkdtempSync(join(tmpdir(), "checkpoints-"));
let nth = 0;

beforeEach(() => {
  process.env.CHECKPOINTS_DIR = join(root, String(nth++));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
