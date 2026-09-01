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
    // Reaches the push venue, rather than being it. `all` is the full green gate, and the clone
    // gate is scheduled beside `bin/gauntlet` rather than inside it — the gauntlet runs the same
    // `test` slot at `stop` and `push`, and rule 6 of docs/agents/clone-gate.md keeps a
    // two-second token scan out of the turn-end venue.
    expect(scripts[scriptName!]).toContain("bin/gauntlet push");
  });

  /**
   * The clone gate's half of the same slot (docs/agents/clone-gate.md rule 6: "It runs in `test`
   * and `all`, and in CI. Never in `stop`."). Asserted on the committed contract for the same
   * reason as the line above: a reader outside this repo acts on the `why`, and a gate that has
   * quietly fallen out of the aggregate script would still leave a `why` claiming it is there.
   */
  it("runs the clone gate from both the `test` and the `all` slot, and from neither `stop`", () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;
    const reaches = (cmd: string) =>
      /^npm (?:run )?(.+)$/.exec(cmd)?.[1] !== undefined &&
      scripts[/^npm (?:run )?(.+)$/.exec(cmd)![1]].includes("clone:check");

    expect(reaches(committed.test.cmd)).toBe(true);
    expect(reaches(committed.all.cmd)).toBe(true);
    expect(committed.stop.cmd).not.toContain("clone");
  });

  /**
   * #130, and the reason it is checked here rather than left to the byte-identity test above: a
   * `stop: null` that a fresh probe reproduces exactly is what `regenerate && diff` shipped green
   * for a day. Byte-identity proves the file was generated; it cannot prove the generator was
   * looking in the right place. These ask the repo directly instead.
   */
  it("publishes a non-null `stop`, because this repo runs a turn-end check every turn", () => {
    expect(committed.stop.cmd).not.toBeNull();
  });

  it("names a `stop` that is on disk and executable", () => {
    const script = join(REPO_ROOT, committed.stop.cmd.split(" ")[0]);

    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).not.toBe(0);
  });

  /**
   * #186. On disk and executable was the whole bar the test here used to set, and the hook entry
   * point `.claude/settings.json` wires clears it — while exiting 0 in 0.02s to any reader who runs
   * it, because Claude Code hands a hook its payload on stdin and a plain command line does not.
   * 255 turn-end runs reported `clean` that way. A hook is never the slot's answer.
   */
  it("names a `stop` that is not one of the hook entry points settings.json wires", () => {
    const settings = JSON.parse(readFileSync(join(REPO_ROOT, ".claude/settings.json"), "utf8"));
    const wired: string[] = Object.values(
      settings.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>,
    )
      .flat()
      .flatMap((group) => group.hooks ?? [])
      .map((hook) => hook.command ?? "");

    expect(wired.length).toBeGreaterThan(0);
    expect(wired.some((command) => command.endsWith(committed.stop.cmd))).toBe(false);
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
 * The modules `bin/gauntlet` loads by path off its own repo root, relative to that root.
 * `check-contract.ts` is imported by the one `node` call that resolves the contract's slots;
 * `generate-contract.ts` is spawned as `diff` for the push venue's contract check;
 * `generate-corpus-fixture.ts` (#140) is spawned the same way for the push venue's corpus check;
 * `wiring-baseline.ts` (#183) for the push venue's wiring check; `workflow-lint.ts` (ADR-0105) and
 * the `reason.ts` it imports for the workflow check — each present here so a push against this
 * fixture root does not fail to find it. The fixture root has no `knip.config.ts`, so the wiring
 * check opts out of it rather than reporting a fixture as unwired code, and no
 * `.github/workflows/`, so the workflow check has nothing to lint and starts no container.
 */
const GAUNTLET_MODULES = [
  ".Workflow/agent-workflows/shared/check-contract.ts",
  ".Workflow/agent-workflows/shared/generate-contract.ts",
  ".Workflow/agent-workflows/shared/generate-corpus-fixture.ts",
  ".Workflow/agent-workflows/shared/wiring-baseline.ts",
  ".Workflow/agent-workflows/shared/workflow-lint.ts",
  ".Workflow/agent-workflows/shared/trailer-form.ts",
  ".Workflow/agent-workflows/shared/reason.ts",
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

/**
 * #186's acceptance test, and the one the byte-identity and on-disk tests above could never be:
 * whether the command this repo *publishes* as its turn-end check can go red at all.
 *
 * Every question asked of `stop.cmd` before this one was answered `yes` by a hook entry point that
 * checked nothing — present, executable, wired in `settings.json`, reproduced exactly by a fresh
 * probe. So this one runs it. A tree whose checks fail, the published command run in it verbatim,
 * and a non-zero exit demanded; then the same tree with the checks passing, to prove the red came
 * from the tree rather than from the command being broken.
 */
describe("the published stop.cmd", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const PUBLISHED_STOP: string = JSON.parse(
    readFileSync(join(REPO_ROOT, CONTRACT_RELATIVE_PATH), "utf8"),
  ).stop.cmd;

  const FAILS = 'node -e "process.exit(1)"';
  const PASSES = 'node -e ""';

  /**
   * The same trick as the push fixture above — the real `bin/gauntlet` run *as* a cheap tree rather
   * than *in* this one, by giving that tree a `bin/`. Only `check-contract.ts` is copied because
   * the `stop` venue loads only that; the generator, corpus and wiring modules are `push`'s.
   *
   * The contract is written by hand rather than probed, and its commands are `node -e` one-liners
   * rather than `npm run`: what is under test is the command this repo published, not what some
   * fixture's `test` slot happens to run, and three npm spawns per case would be most of this
   * suite's runtime for no assertion.
   */
  function treeWhereChecksExit(code: typeof FAILS | typeof PASSES): string {
    const root = mkdtempSync(join(tmpdir(), "published-stop-"));
    dirs.push(root);

    symlinkSync(join(REPO_ROOT, "bin"), join(root, "bin"), "dir");
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
    const module = ".Workflow/agent-workflows/shared/check-contract.ts";
    mkdirSync(join(root, dirname(module)), { recursive: true });
    copyFileSync(join(REPO_ROOT, module), join(root, module));

    mkdirSync(join(root, dirname(CONTRACT_RELATIVE_PATH)), { recursive: true });
    writeFileSync(
      join(root, CONTRACT_RELATIVE_PATH),
      serializeContract(
        checkContractFixture({
          typecheck: { cmd: code, why: "the fixture's own" },
          lint: { cmd: code, why: "the fixture's own" },
          test: { cmd: code, why: "the fixture's own" },
        }),
      ),
    );

    return root;
  }

  function runPublishedStop(root: string): number | null {
    return spawnSync("bash", ["-c", PUBLISHED_STOP], { cwd: root, encoding: "utf8", env: process.env })
      .status;
  }

  // 1, not merely non-zero: `bin/gauntlet`'s third code, 2, is "the checks could not run", and a
  // published command that is simply broken would satisfy a non-zero assertion while checking as
  // little as the hook did.
  it("exits 1 — a real finding — against a tree whose checks fail", () => {
    expect(runPublishedStop(treeWhereChecksExit(FAILS))).toBe(1);
  });

  it("exits 0 against the same tree with its checks passing", () => {
    expect(runPublishedStop(treeWhereChecksExit(PASSES))).toBe(0);
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
