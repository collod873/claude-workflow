import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach } from "vitest";

/**
 * Vitest `setupFiles` entry — imported once per test file, in the worker that
 * is about to run it, so the `beforeEach` below is registered for every test
 * in the suite whether or not that test file knows checkpoints exist.
 *
 * `runStage` (`./stage.ts`) consults a real on-disk checkpoint before it
 * spawns: `<stage>.json` under `CHECKPOINTS_DIR`, keyed on
 * `sha256(HEAD + "\0" + the substituted prompt)`. On a key hit it returns the
 * stored response through `output.parse` and never calls `exec` — so a test
 * that shares a commit and a prompt with any earlier writer gets that
 * writer's canned answer instead of its own, with every in-memory
 * collaborator it injected sitting untouched. `CHECKPOINTS_DIR` defaults to a
 * path inside this checkout, which makes the sharing suite-wide and
 * run-to-run: one `ratifier.json`, one key, and the last writer wins until
 * the next commit changes every key at once.
 *
 * That is #299 — `ratifier.test.ts:173` read `:197`'s verdict, one run after
 * `:197` wrote it, and the suite went green again on the next commit for no
 * reason anybody could see.
 *
 * **Why per test rather than per file.** Per-file isolation stops a file from
 * reading another file's checkpoint and stops anything landing in the
 * checkout, but #299's two tests are in one file — and two tests in one file
 * sharing a prompt is the *common* case here, because a test file drives one
 * lane against one set of fixtures. Only a fresh directory per test makes the
 * bleed impossible.
 *
 * **Why here rather than a helper each test file calls.** It was a helper
 * each test file called, in eighteen files, each with its own paragraph
 * explaining the same hazard — and `ratify/` did not call it, which is the
 * whole ticket. A convention that eighteen files remember and the nineteenth
 * forgets is not a mechanism. `setupFiles` is the only venue that covers the
 * test file nobody has written yet, which is the same argument
 * `scrub-git-env.setup.ts` beside it makes for `GIT_DIR`.
 * See ADR-0125.
 */

/**
 * One temp root per test file, holding a numbered directory per test. The
 * root is made eagerly and the per-test directories are not: everything that
 * writes a checkpoint — `runStage`'s `writeCheckpoint`, `claude-cli.stub.ts`,
 * `to-tickets.test.ts`'s `seedCheckpoint` — `mkdirSync`es the parent itself,
 * and everything that reads one fails open when it is absent. So a test that
 * never touches a stage costs a string join.
 */
const root = mkdtempSync(join(tmpdir(), "checkpoints-"));
let nth = 0;

beforeEach(() => {
  process.env.CHECKPOINTS_DIR = join(root, String(nth++));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
