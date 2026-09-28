import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_LIMIT, agedLogs, checkRepo, git, inRepo, plant, script, stubTool } from "./scenarios.ts";

const TYPE_ERROR = "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n".repeat(40).trim();
const TEST_FAILURE = ` FAIL  a.test.ts > adds\n${"AssertionError: expected 1 to be 2\n".repeat(40)} ❯ a.test.ts:4:34`;

function saidOneLine(stdout: string): { line: string; log: string } {
  const lines = stdout.split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  const [line] = lines;
  if (line === undefined) throw new Error("no line on stdout");
  const log = /; log (\S.*\.log)$/.exec(line)?.[1];
  if (log === undefined) throw new Error(`no log path in ${line}`);
  return { line, log };
}

describe("bin/check says one line and keeps each failing tool's full output in a log it names (#683)", () => {
  it("names only the failed tools, where each one points, and a log holding each one's full output", () => {
    const { repo, run } = checkRepo({ tsc: TYPE_ERROR, vitest: TEST_FAILURE });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const { line, log } = saidOneLine(result.stdout);
    expect(line).toMatch(/^bin\/check: FAILED typecheck src\/a\.ts:3, test a\.test\.ts:4; log /);
    const kept = readFileSync(inRepo(repo, log), "utf8");
    expect(kept).toContain(TYPE_ERROR);
    expect(kept).toContain(TEST_FAILURE);
    expect(kept).not.toMatch(/lint|unused|clones/);
  });

  it("drops the locations before the line would pass 200 characters, keeping every failed tool's name", () => {
    const deep = `src/${"a-rather-deep-folder/".repeat(6)}file.ts(12,1): error\n`;
    const { run } = checkRepo({ tsc: deep, eslint: deep, knip: deep, jscpd: deep, vitest: deep });

    const { line } = saidOneLine(run().stdout);

    expect(line.length).toBeLessThanOrEqual(LINE_LIMIT);
    expect(line).toMatch(/^bin\/check: FAILED typecheck lint unused clones test; log /);
  });

  it("says passed on a clean run and leaves no log behind from an earlier failure", () => {
    const { repo, run } = checkRepo({ knip: "Unused files (1)\nsrc/orphan.ts" });
    const { log } = saidOneLine(run().stdout);
    expect(existsSync(inRepo(repo, log))).toBe(true);

    stubTool(repo, "knip");
    const result = run();

    expect(result).toEqual({ status: 0, stdout: "bin/check: passed\n", stderr: "" });
    expect(existsSync(inRepo(repo, log))).toBe(false);
  });

  it("keeps a separate log for each worktree checking the same commit", () => {
    const { repo, run } = checkRepo({ tsc: TYPE_ERROR });
    const other = join(repo, "..", "other");
    git(repo, "worktree", "add", "--quiet", "--detach", other);

    const here = inRepo(repo, saidOneLine(run(repo).stdout).log);
    const there = inRepo(other, saidOneLine(run(other).stdout).log);

    expect(here).not.toBe(there);
    expect(readFileSync(here, "utf8")).toContain(TYPE_ERROR);
    expect(readFileSync(there, "utf8")).toContain(TYPE_ERROR);
  });
});

describe("bin/check deletes its logs older than 7 days whenever it runs (#693)", () => {
  it("deletes a log dated 8 days ago, keeps one dated today, and says nothing about either", () => {
    const { repo, run } = checkRepo();
    const { stale, fresh } = agedLogs(join(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"), "machine-logs"), "check");

    const result = run();

    expect(result).toEqual({ status: 0, stdout: "bin/check: passed\n", stderr: "" });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe("bin/check static runs the gates a stage can meet while it works, never the whole suite (#783)", () => {
  it("runs typecheck, lint, unused, clones and the style tests, and leaves the suite, prompts and links alone", () => {
    const { repo, run } = checkRepo({ tsc: TYPE_ERROR, node: "src/prompt-bytes.ts: over its ceiling" });
    script(join(repo, "node_modules", ".bin", "vitest"), '[ "$*" = "run --config vitest.config.ts prose em-dash" ] && exit 0\necho "the whole suite ran"\nexit 1\n');

    const result = run(repo, ["static"]);

    expect(result.status).toBe(1);
    expect(saidOneLine(result.stdout).line).toMatch(/^bin\/check: FAILED typecheck src\/a\.ts:3; log /);
  });

  it("refuses any other argument before it runs a gate", () => {
    const { run } = checkRepo({ tsc: TYPE_ERROR });

    expect(run(undefined, ["everything"])).toEqual({ status: 2, stdout: "", stderr: "bin/check: usage: bin/check [static]\n" });
  });
});

describe("the check a session runs mid-work holds the gates a push refuses on, so bin/land never first learns of them (#874)", () => {
  it("the contract's stop slot runs bin/check static, which runs the clone and unused gates", () => {
    const REPO = join(import.meta.dirname, "..");
    const contract = JSON.parse(readFileSync(join(REPO, ".claude", "contract.json"), "utf8")) as { stop?: string };
    const staticGates = /^static_gates="([^"]*)"$/m.exec(readFileSync(join(REPO, "bin", "check"), "utf8"))?.[1] ?? "";

    expect(contract.stop).toBe("bin/check static");
    expect(staticGates.split(" ")).toEqual(expect.arrayContaining(["typecheck", "lint", "unused", "clones", "test"]));
  });
});

const HOOKS_ON = { AGENT_HOOKS_SETTINGS: "/runner/agent-hooks.json" };

function countedSuite(repo: string, red = false): () => number {
  const counted = join(git(repo, "rev-parse", "--absolute-git-dir"), "suite-ran");
  const verdict = red ? "exit 1\n" : "printf '      Tests  305 passed (305)\\n'\n";
  script(join(repo, "node_modules", ".bin", "vitest"), `printf x >>'${counted}'\n${verdict}`);
  git(repo, "commit", "--quiet", "-am", "count the suite's runs");
  return () => (existsSync(counted) ? readFileSync(counted, "utf8").length : 0);
}

describe("bin/check takes its own pass on the commit in hand, so the machine's check after a builder's repeats no suite (#954)", () => {
  it("names the test count on a pass, then passes at once on the same clean commit with the same hooks", () => {
    const { repo, run } = checkRepo();
    const ran = countedSuite(repo);

    expect(run(repo, [], HOOKS_ON)).toEqual({ status: 0, stdout: "bin/check: passed, 305 tests\n", stderr: "" });
    const again = run(repo, [], HOOKS_ON);

    expect(again.status).toBe(0);
    expect(again.stdout).toBe(`bin/check: passed, already at ${git(repo, "rev-parse", "--short", "HEAD")}\n`);
    expect(ran()).toBe(1);
  });

  it("runs the suite again under other hooks, where #965's builder turned its hooks off to pass", () => {
    const { repo, run } = checkRepo();
    const ran = countedSuite(repo);

    run(repo, [], { AGENT_HOOKS_SETTINGS: "" });
    run(repo, [], HOOKS_ON);

    expect(ran()).toBe(2);
  });

  it("runs the suite again on uncommitted work, then takes a pass on it at once and after it is committed unchanged", () => {
    const { repo, run } = checkRepo();
    const ran = countedSuite(repo);
    run(repo, [], HOOKS_ON);

    plant(repo, "src/a.ts", "export const a = 1;\n");
    run(repo, [], HOOKS_ON);
    run(repo, [], HOOKS_ON);
    expect(ran()).toBe(2);

    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "commit the work");
    run(repo, [], HOOKS_ON);
    expect(ran()).toBe(2);
  });

  it("takes no pass from a red run", () => {
    const { repo, run } = checkRepo();
    const ran = countedSuite(repo, true);

    run(repo, [], HOOKS_ON);
    run(repo, [], HOOKS_ON);

    expect(ran()).toBe(2);
  });

  it("neither leaves nor takes a pass on a static run, which runs only the style tests", () => {
    const { repo, run } = checkRepo();
    const ran = countedSuite(repo);

    run(repo, ["static"], HOOKS_ON);
    run(repo, [], HOOKS_ON);
    run(repo, ["static"], HOOKS_ON);

    expect(ran()).toBe(3);
  });

  it("takes a pass on uncommitted work once exactly those files are committed", () => {
    const { repo, run } = checkRepo();
    const ran = countedSuite(repo);

    plant(repo, "src/a.ts", "export const a = 1;\n");
    expect(run(repo, [], HOOKS_ON).status).toBe(0);
    expect(ran()).toBe(1);

    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "commit exactly the checked files");

    const result = run(repo, [], HOOKS_ON);
    expect(result).toEqual({ status: 0, stdout: `bin/check: passed, already at ${git(repo, "rev-parse", "--short", "HEAD")}\n`, stderr: "" });
    expect(ran()).toBe(1);
  });

  it("takes a pass on the same uncommitted files, never on changed ones", () => {
    const { repo, run } = checkRepo();
    const ran = countedSuite(repo);

    plant(repo, "src/a.ts", "export const a = 1;\n");
    run(repo, [], HOOKS_ON);
    expect(ran()).toBe(1);

    expect(run(repo, [], HOOKS_ON).status).toBe(0);
    expect(ran()).toBe(1);

    plant(repo, "src/a.ts", "export const a = 2;\n");
    run(repo, [], HOOKS_ON);
    expect(ran()).toBe(2);

    plant(repo, "src/b.ts", "export const b = 1;\n");
    run(repo, [], HOOKS_ON);
    expect(ran()).toBe(3);

    rmSync(join(repo, "src", "b.ts"));
    run(repo, [], HOOKS_ON);
    expect(ran()).toBe(4);
  });
});
