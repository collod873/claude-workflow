import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, onTestFinished } from "vitest";

/**
 * Vitest `setupFiles` entry — runs once per test file, under vitest's default
 * per-file isolation, the same guarantee `scrub-git-env.setup.ts` leans on.
 *
 * `runStage` (`./stage.ts`) checkpoints to `CHECKPOINTS_DIR`, defaulting to a
 * path inside this checkout when the env var is unset. A test that exercises
 * a checkpointed stage without this would write real files into
 * `.Workflow/agent-workflows/checkpoints/` on every run, and — worse — leave
 * them there for the *next* test file to read as a stale, key-matching
 * checkpoint it never wrote. Pointing every test file at its own temp
 * directory removes both: nothing lands in the checkout, and nothing a test
 * writes outlives the file that wrote it.
 */
const dir = mkdtempSync(join(tmpdir(), "checkpoints-"));
process.env.CHECKPOINTS_DIR = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Points `CHECKPOINTS_DIR` at a fresh directory for the currently running
 * test, restoring the file-level value once that test finishes. For a test
 * file where several tests share a stage name *and* a substituted prompt —
 * `to-tickets.test.ts` and `audit-and-publish-cli.test.ts` both run every
 * test at `--issue 13` against the same real commit — this file's own
 * per-file isolation above only guarantees a fresh directory once per file,
 * not once per test, so two such tests could otherwise read each other's
 * checkpoint as a key-matching hit. Call once per file, from a top-level
 * `beforeEach`.
 */
export function isolateCheckpointsPerTest(): void {
  const dir = mkdtempSync(join(tmpdir(), "checkpoints-test-"));
  const original = process.env.CHECKPOINTS_DIR;
  process.env.CHECKPOINTS_DIR = dir;
  onTestFinished(() => {
    process.env.CHECKPOINTS_DIR = original;
    rmSync(dir, { recursive: true, force: true });
  });
}
