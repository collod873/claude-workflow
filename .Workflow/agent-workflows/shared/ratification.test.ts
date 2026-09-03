import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execGit } from "./git";
import { createFakeGit } from "./git.fake";
import { observation } from "./observation.fixture";
import { ratificationRecord } from "./ratification.fixture";
import {
  filterByRatificationMemory,
  readRatificationRecords,
  writeRatificationNote,
} from "./ratification";

describe("filterByRatificationMemory", () => {
  it("drops a declined finding from the release-eligible set when this run's sites haven't grown", () => {
    const declined = ratificationRecord({ finding: "duplicated validation logic", sites: ["a.ts:1", "b.ts:2"] });
    const thisRun = observation({ finding: "duplicated validation logic", sites: ["a.ts:1", "b.ts:2"] });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [declined] });

    expect(result).toEqual([]);
  });

  it("carries a declined finding forward as release-eligible once a run shows a site the decision didn't name", () => {
    const declined = ratificationRecord({ finding: "duplicated validation logic", sites: ["a.ts:1", "b.ts:2"] });
    const thisRun = observation({
      finding: "duplicated validation logic",
      sites: ["a.ts:1", "b.ts:2", "c.ts:3"],
    });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [declined] });

    expect(result).toEqual([thisRun]);
  });

  it("passes a finding through untouched when it has no ratification record at all", () => {
    const thisRun = observation({ finding: "never ratified" });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [] });

    expect(result).toEqual([thisRun]);
  });

  it("passes a finding through untouched when its recorded decision was ratified, not declined", () => {
    const ratified = ratificationRecord({
      finding: "duplicated validation logic",
      decision: "ratified",
      sites: ["a.ts:1"],
      reason: "landed as a lint rule",
    });
    const thisRun = observation({ finding: "duplicated validation logic", sites: ["a.ts:1"] });

    const result = filterByRatificationMemory({ observations: [thisRun], priorRatifications: [ratified] });

    expect(result).toEqual([thisRun]);
  });

  it("only reconsiders the declined finding, leaving an unrelated finding in the run alone", () => {
    const declined = ratificationRecord({ finding: "declined one", sites: ["a.ts:1"] });
    const stillDeclined = observation({ finding: "declined one", sites: ["a.ts:1"] });
    const unrelated = observation({ finding: "unrelated finding", sites: ["z.ts:9"] });

    const result = filterByRatificationMemory({
      observations: [stillDeclined, unrelated],
      priorRatifications: [declined],
    });

    expect(result).toEqual([unrelated]);
  });
});

describe("writeRatificationNote / readRatificationRecords argv shape", () => {
  it("writes via `notes --ref=ratifications add -f`, keyed to the given commit", () => {
    const fake = createFakeGit(() => "");
    const record = ratificationRecord({ finding: "f" });

    writeRatificationNote({ git: fake.git, repoDir: "/some/repo", commit: "abc123", records: [record] });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv.slice(0, 6)).toEqual(["-C", "/some/repo", "notes", "--ref=ratifications", "add", "-f"]);
    expect(argv[6]).toBe("-m");
    expect(JSON.parse(argv[7])).toEqual([record]);
    expect(argv[8]).toBe("abc123");
  });

  it("reads via `log <range> --notes=ratifications`, threading repoDir as -C", () => {
    const fake = createFakeGit(() => "");

    readRatificationRecords({ git: fake.git, repoDir: "/some/repo", base: "abc", head: "def" });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv[0]).toBe("-C");
    expect(argv[1]).toBe("/some/repo");
    expect(argv[2]).toBe("log");
    expect(argv[3]).toBe("abc..def");
    expect(argv[4]).toBe("--notes=ratifications");
  });

  it("reads the unbounded ref alone, not a range, when base is omitted", () => {
    const fake = createFakeGit(() => "");

    readRatificationRecords({ git: fake.git, repoDir: "/some/repo", head: "def" });

    const [argv] = fake.calls;
    expect(argv[3]).toBe("def");
  });
});

/**
 * A throwaway git repo for one test — trimmed from `notes.test.ts`'s
 * `makeRepo` to what this file needs (no `remove`, since ratification
 * records carry no staleness self-drop).
 */
function makeRepo(): {
  dir: string;
  commit: (path: string, contents: string, message: string) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "ratification-notes-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  function commit(path: string, contents: string, message: string): string {
    writeFileSync(join(dir, path), contents, "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  return { dir, commit };
}

describe("writeRatificationNote / readRatificationRecords against a real repo", () => {
  it("reads a written note back as a flat list, and overwrites rather than appends on a second write", () => {
    const repo = makeRepo();
    try {
      const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
      const head = repo.commit("a.ts", "export const a = 2;\n", "the release commit");

      writeRatificationNote({
        git: execGit,
        repoDir: repo.dir,
        commit: head,
        records: [ratificationRecord({ finding: "first pass" })],
      });
      writeRatificationNote({
        git: execGit,
        repoDir: repo.dir,
        commit: head,
        records: [ratificationRecord({ finding: "merged, second pass" })],
      });

      const result = readRatificationRecords({ git: execGit, repoDir: repo.dir, base, head });

      expect(result).toEqual([ratificationRecord({ finding: "merged, second pass" })]);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});
