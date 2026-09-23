import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_LIMIT, agedLogs, checkRepo, git, inRepo, script, stubTool } from "./scenarios.ts";

const TYPE_ERROR = "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n".repeat(40).trim();
const TEST_FAILURE = ` FAIL  a.test.ts > adds\n${"AssertionError: expected 1 to be 2\n".repeat(40)} ❯ a.test.ts:4:34`;

function saidOneLine(stdout: string): { line: string; log: string } {
  const lines = stdout.split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  const log = /; log (\S.*\.log)$/.exec(lines[0])?.[1];
  expect(log, lines[0]).toBeDefined();
  return { line: lines[0], log: log ?? "" };
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
