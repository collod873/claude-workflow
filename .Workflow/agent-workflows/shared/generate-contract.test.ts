import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_RELATIVE_PATH,
  diffContract,
  generateContract,
  serializeContract,
} from "./generate-contract";
import { CORPUS_RELATIVE_PATH, generateCorpusFixture } from "./generate-corpus-fixture";
import { checkContractFixture } from "./check-contract";

/**
 * #121: the generator (`regenerate`) and `bin/gauntlet push`'s wiring of it (`&& diff`) — the
 * standing check ADR-0056 calls for in place of `CLAUDE.md`'s retired same-commit rule. The first
 * describe block below is that rule's replacement, made concrete: this repository's own committed
 * `.claude/contract.json` either agrees with a fresh probe of this tree, or `npm test` is red about
 * it — nobody has to remember to regenerate it by hand again.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("generateContract", () => {
  it("matches this repository's own committed .claude/contract.json byte-for-byte", () => {
    const committed = readFileSync(join(REPO_ROOT, CONTRACT_RELATIVE_PATH), "utf8");

    expect(generateContract(REPO_ROOT)).toBe(committed);
  });
});

/**
 * The `all` slot is the one a reader outside this repo acts on: `drain`'s step-1 table reads a
 * present contract with `all: null` as a repo that has *deliberately* declared it has no gate, and
 * merges every ticket unverified while reporting green (drain defect #142). So a `null` here is not
 * a quiet gap the way a missing `test_one` would be — it is an instruction to skip the gate. This
 * repo has a gate, `bin/gauntlet push`, and the contract must be able to say so: the probe reads
 * `package.json#scripts.{check,verify,ci}`, so the gate has to be reachable by name from there.
 *
 * Checked against the committed file rather than a fresh probe, because the committed file is what
 * a reader loads — the byte-identity test above is what keeps the two the same.
 */
describe("this repository's committed contract", () => {
  const committed = JSON.parse(readFileSync(join(REPO_ROOT, CONTRACT_RELATIVE_PATH), "utf8"));

  it("publishes a non-null `all`, so no reader takes this repo for ungated", () => {
    expect(committed.all.cmd).not.toBeNull();
  });

  it("names an `all` that is a real package.json script running the push venue", () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;
    const scriptName = /^npm run (.+)$/.exec(committed.all.cmd)?.[1];

    expect(scriptName).toBeDefined();
    expect(scripts[scriptName!]).toBe("bin/gauntlet push");
  });

  /**
   * #130, and the reason it is checked here rather than left to the byte-identity test above: a
   * `stop: null` that a fresh probe reproduces exactly is what `regenerate && diff` shipped green
   * for a day. Byte-identity proves the file was generated; it cannot prove the generator was
   * looking in the right place. These two ask the repo directly instead — the hook this repo runs
   * every turn has to be on disk, executable, and the same one `settings.json` wires up.
   */
  it("publishes a non-null `stop`, because this repo runs a turn-end check every turn", () => {
    expect(committed.stop.cmd).not.toBeNull();
  });

  it("names a `stop` that is this repo's live Stop hook, on disk and executable", () => {
    const settings = JSON.parse(readFileSync(join(REPO_ROOT, ".claude/settings.json"), "utf8"));
    const wired: string[] = (settings.hooks?.Stop ?? [])
      .flatMap((group: { hooks?: Array<{ command?: string }> }) => group.hooks ?? [])
      .map((hook: { command?: string }) => hook.command ?? "");

    expect(wired.some((command) => command.endsWith(committed.stop.cmd))).toBe(true);

    const script = join(REPO_ROOT, committed.stop.cmd.split(" ")[0]);
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).not.toBe(0);
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

/**
 * The three modules `bin/gauntlet` loads by path off its own repo root, relative to that root.
 * `check-contract.ts` is imported by the one `node` call that resolves the contract's slots;
 * `generate-contract.ts` is spawned as `diff` for the push venue's contract check;
 * `generate-corpus-fixture.ts` (#140) is spawned the same way for the push venue's corpus check —
 * present here so a push against this fixture root does not fail to find it.
 */
const GAUNTLET_MODULES = [
  ".Workflow/agent-workflows/shared/check-contract.ts",
  ".Workflow/agent-workflows/shared/generate-contract.ts",
  ".Workflow/agent-workflows/shared/generate-corpus-fixture.ts",
];

/** What the fixture root below declares for each slot the push venue runs. Deliberately nothing. */
const DOES_NOTHING = 'node -e ""';

describe("bin/gauntlet push's regenerate && diff", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  /**
   * A throwaway tree the real `bin/gauntlet` is run *as*, rather than *in*.
   *
   * #133: this used to spawn a real push against **this** repo, twice. This repo's `test` slot is
   * `npm test` — the whole suite — so proving `regenerate && diff` cost two entire suites, 149s
   * each on a GitHub runner against a 120s budget, and the test had never once passed in CI. The
   * assertion was never the expensive part; the root it pointed at was.
   *
   * `bin/gauntlet` takes its repo root from its own location (`$here/..`), so the way to aim a real
   * push at a cheap tree is to give that tree a `bin/`, not to give the gauntlet a flag. Everything
   * under test is the genuine article — the same gauntlet, the same probe, the same generator, a
   * real contract at the real default path, real exit codes. Only the three commands the contract
   * names are the fixture's own, and they do nothing, because what this test is about is the
   * contract check and not what `test` happens to run underneath it.
   *
   * Built here rather than committed under `check-contract.fixtures/`: it needs links back into
   * this repo, and a committed tree carrying those would be a second copy of the repo that `tsc`,
   * `eslint` and `vitest` all walk into.
   *
   * `bin` and `node_modules` are symlinked; the modules are **copied**, because Node resolves a
   * symlinked entry point to its real path — `generate-contract.ts`'s `import.meta.url === argv[1]`
   * main-guard would then silently never fire, and the contract check would pass by not running.
   *
   * Carries a real, matching corpus fixture (#140's corpus check also runs on `push`) so this
   * describe block's assertions stay about the contract check alone — the corpus check is a
   * silent pass here, not a second thing this test has to account for.
   */
  function fixtureRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-push-fixture-"));
    dirs.push(root);

    symlinkSync(join(REPO_ROOT, "bin"), join(root, "bin"), "dir");
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
    for (const module of GAUNTLET_MODULES) {
      mkdirSync(join(root, dirname(module)), { recursive: true });
      copyFileSync(join(REPO_ROOT, module), join(root, module));
    }

    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "gauntlet-push-fixture",
          private: true,
          type: "module",
          scripts: {
            test: DOES_NOTHING,
            typecheck: DOES_NOTHING,
            lint: DOES_NOTHING,
            check: "bin/gauntlet push",
          },
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(root, dirname(CONTRACT_RELATIVE_PATH)), { recursive: true });

    mkdirSync(join(root, "docs/adr"), { recursive: true });
    mkdirSync(join(root, "docs/research"), { recursive: true });
    writeFileSync(
      join(root, "docs/adr/0001-a-decision.md"),
      "# A decision\n\nRecorded 2026-08-20.\n",
    );
    writeFileSync(
      join(root, "docs/research/topic-2026-08.md"),
      "**Resolves:** [x](https://example/1)\n\n## Section\n\nBody.\n",
    );
    mkdirSync(join(root, dirname(CORPUS_RELATIVE_PATH)), { recursive: true });
    writeFileSync(join(root, CORPUS_RELATIVE_PATH), generateCorpusFixture(root));

    return root;
  }

  function runPush(root: string): { status: number | null; stdout: string } {
    const run = spawnSync(join(root, "bin/gauntlet"), ["push"], {
      encoding: "utf8",
      cwd: root,
      env: process.env,
    });
    return { status: run.status, stdout: run.stdout };
  }

  it("exits 1 against a contract that disagrees with a fresh probe, then 0 once it matches again", () => {
    const root = fixtureRoot();
    const contractPath = join(root, CONTRACT_RELATIVE_PATH);
    const fresh = generateContract(root);

    // Mutate `why` only — every `cmd` stays the fixture's real, passing command, so the contract
    // check is the only thing this push run can go red on.
    const mutated = JSON.parse(fresh);
    mutated.test.why = `${mutated.test.why} (mutated for a test)`;
    writeFileSync(contractPath, `${JSON.stringify(mutated, null, 2)}\n`);

    const mismatched = runPush(root);
    expect(mismatched.status).toBe(1);
    expect(mismatched.stdout).toContain("--- contract ---");

    writeFileSync(contractPath, fresh);
    expect(runPush(root).status).toBe(0);
  });
});

describe("CLAUDE.md", () => {
  it("no longer states the same-commit contract-move obligation the generator retires", () => {
    const claudeMd = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");

    expect(claudeMd).not.toContain(
      "A change that moves the definition of green moves `.claude/contract.json` in the **same commit**.",
    );
  });
});
