import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const BIN_TESTS_DIR = join(REPO_ROOT, "bin/tests");

const NO_BYTECODE_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };

describe("bin/tests/ runs under unittest", () => {
  it("python3 -m unittest discover bin/tests/ exits 0", () => {
    const run = spawnSync("python3", ["-m", "unittest", "discover", "-s", BIN_TESTS_DIR, "-p", "test_*.py"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: NO_BYTECODE_ENV,
    });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
