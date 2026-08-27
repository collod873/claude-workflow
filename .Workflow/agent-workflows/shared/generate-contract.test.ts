import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_RELATIVE_PATH,
  diffContract,
  generateContract,
  serializeContract,
} from "./generate-contract";
import { checkContractFixture } from "./check-contract";

/**
 * #121: the generator (`regenerate`) and `bin/gauntlet push`'s wiring of it (`&& diff`) — the
 * standing check ADR-0056 calls for in place of `CLAUDE.md`'s retired same-commit rule. The first
 * describe block below is that rule's replacement, made concrete: this repository's own committed
 * `.claude/contract.json` either agrees with a fresh probe of this tree, or `npm test` is red about
 * it — nobody has to remember to regenerate it by hand again.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/**
 * A cold `bin/gauntlet push` drives the real `tsc`, `eslint` and `vitest` — there is no other way
 * to exercise `regenerate && diff` against this repo's real contract, since a match is only a match
 * when every field, including `typecheck`/`lint`/`test`'s real commands, is the genuine article.
 * Mirrors `.claude/hooks/gauntlet.test.ts`'s `REAL_TOOLCHAIN`: a cold CI runner is slower than this
 * workstation, and vitest's 5s default would turn that gap into an environment flake.
 */
const REAL_TOOLCHAIN = 120_000;

describe("generateContract", () => {
  it("matches this repository's own committed .claude/contract.json byte-for-byte", () => {
    const committed = readFileSync(join(REPO_ROOT, CONTRACT_RELATIVE_PATH), "utf8");

    expect(generateContract(REPO_ROOT)).toBe(committed);
  });
});

describe("serializeContract", () => {
  it("two-space indents and ends with exactly one trailing newline", () => {
    const contract = checkContractFixture({ test: { cmd: "npm test", why: "declared" } });

    const text = serializeContract(contract);

    expect(text).toBe(`${JSON.stringify(contract, null, 2)}\n`);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("diffContract", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function writeCopy(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), "generate-contract-diff-"));
    dirs.push(dir);
    const path = join(dir, "contract.json");
    writeFileSync(path, text);
    return path;
  }

  it("reports nothing when the committed text already matches a fresh probe", () => {
    const path = writeCopy(generateContract(REPO_ROOT));

    expect(diffContract(REPO_ROOT, path)).toBeUndefined();
  });

  it("reports the mismatched field when the committed text has drifted", () => {
    const fresh = JSON.parse(generateContract(REPO_ROOT));
    fresh.test.why = `${fresh.test.why} (stale)`;
    const path = writeCopy(`${JSON.stringify(fresh, null, 2)}\n`);

    const mismatch = diffContract(REPO_ROOT, path);

    expect(mismatch).toContain("test.why");
    expect(mismatch).toContain("stale");
  });
});

// This repo's `test` slot is `npm test` — the whole suite, this file included — so a push spawned
// for real from inside this file would, on a matching contract, spawn another push from inside
// itself, unbounded. `NO_RESPAWN` is set on the child's environment and checked here: the nested
// run still executes the real, whole suite (proving push's real behaviour, not a stub of it), it
// just does not spawn a *third* push from inside a *second* one. Depth is bounded at one.
const NO_RESPAWN = "GENERATE_CONTRACT_TEST_NO_RESPAWN";

describe.skipIf(process.env[NO_RESPAWN] === "1")("bin/gauntlet push's regenerate && diff", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function writeCopy(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), "gauntlet-push-contract-"));
    dirs.push(dir);
    const path = join(dir, "contract.json");
    writeFileSync(path, text);
    return path;
  }

  function runPush(contractPath: string): { status: number | null; stdout: string } {
    const run = spawnSync(join(REPO_ROOT, "bin/gauntlet"), ["push"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { ...process.env, GAUNTLET_CONTRACT: contractPath, [NO_RESPAWN]: "1" },
    });
    return { status: run.status, stdout: run.stdout };
  }

  it(
    "exits 1 against a contract that disagrees with a fresh probe, then 0 once it matches again",
    () => {
      const fresh = generateContract(REPO_ROOT);
      // Mutate `why` only — `cmd` is untouched, so typecheck/lint/test still run this repo's real,
      // passing commands underneath, and the only thing this push run can go red on is the new
      // contract check itself.
      const mutated = JSON.parse(fresh);
      mutated.test.why = `${mutated.test.why} (mutated for a test)`;
      const mutatedPath = writeCopy(`${JSON.stringify(mutated, null, 2)}\n`);

      const mismatched = runPush(mutatedPath);
      expect(mismatched.status).toBe(1);
      expect(mismatched.stdout).toContain("--- contract ---");

      const matchingPath = writeCopy(fresh);
      const matching = runPush(matchingPath);
      expect(matching.status).toBe(0);
    },
    REAL_TOOLCHAIN,
  );
});

describe("CLAUDE.md", () => {
  it("no longer states the same-commit contract-move obligation the generator retires", () => {
    const claudeMd = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");

    expect(claudeMd).not.toContain(
      "A change that moves the definition of green moves `.claude/contract.json` in the **same commit**.",
    );
  });
});
