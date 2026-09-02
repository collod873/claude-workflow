import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Matches `./git.ts`'s, and for the same reason: Node's 1 MB default exits `ENOBUFS` naming neither command nor size. */
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * A throwaway git repo for one test — the unit every seam that reads real git
 * rather than an argv-recording fake is built from.
 *
 * It exists because the same twenty lines had been retyped in four test files
 * by the time the clone gate caught the fourth, each copy trimmed slightly
 * differently. `write` and `commit` are separate so a test can stage several
 * files, a deletion, or nothing at all into one commit — the shape a copy that
 * only took `(path, contents, message)` could not express.
 *
 * `main` is named explicitly rather than left to `init.defaultBranch`, so a
 * test that fetches trunk by name does not depend on the runner's git config.
 */
export interface TempRepo {
  /** The repo's directory, for the caller's own `rmSync` in `afterEach`. */
  dir: string;
  /** Writes one file, creating parent directories. Nothing is staged until `commit`. */
  write: (path: string, contents: string) => void;
  /** Commits everything in the tree, including deletions, and returns the new commit's SHA. */
  commit: (message: string) => string;
}

/** Creates a `TempRepo`. `prefix` names the temp directory, so a stray one says which test left it. */
export function makeTempRepo(prefix: string): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, maxBuffer: MAX_BUFFER });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir, maxBuffer: MAX_BUFFER });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, maxBuffer: MAX_BUFFER });

  return {
    dir,
    write(path, contents) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), contents, "utf8");
    },
    commit(message) {
      execFileSync("git", ["add", "-A"], { cwd: dir, maxBuffer: MAX_BUFFER });
      execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir, maxBuffer: MAX_BUFFER });
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", maxBuffer: MAX_BUFFER }).trim();
    },
  };
}
