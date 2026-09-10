import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const HOOKS_DIR = join(REPO_ROOT, ".claude/hooks");
const BIN_TESTS_DIR = join(REPO_ROOT, "bin/tests");

function testFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("test_") && name.endsWith(".py"))
    .sort();
}

const NO_BYTECODE_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };

describe("hooks/test_*.py run as standalone harnesses (agent-skills' own contract.json test slot)", () => {
  for (const name of testFiles(HOOKS_DIR)) {
    it(`${name} exits 0`, () => {
      const run = spawnSync("python3", [join(HOOKS_DIR, name)], { encoding: "utf8", env: NO_BYTECODE_ENV });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    });
  }
});

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
