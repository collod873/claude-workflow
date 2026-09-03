import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "./git";
import { createFakeGit } from "./git.fake";
import { observation } from "./observation.fixture";
import { readObservations, writeObservationNote } from "./notes";

/**
 * A throwaway git repo for one test, with helpers to commit and delete a
 * file and hand back the new commit's SHA — mirrors `diff.test.ts`'s
 * `makeRepo`, extended with `remove` since the staleness self-drop needs a
 * commit that deletes a file.
 */
function makeRepo(): {
  dir: string;
  commit: (path: string, contents: string, message: string) => string;
  remove: (path: string, message: string) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "observation-notes-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  function commit(path: string, contents: string, message: string): string {
    writeFileSync(join(dir, path), contents, "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  function remove(path: string, message: string): string {
    unlinkSync(join(dir, path));
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  return { dir, commit, remove };
}

describe("writeObservationNote / readObservations", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reads a written note back keyed to the exact commit the finding is about", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");

    const finding = observation({ finding: "duplicated validation logic", sites: ["a.ts:1"] });
    writeObservationNote({ git: execGit, repoDir: dir, commit: head, observations: [finding] });

    const result = readObservations({ git: execGit, repoDir: dir, base, head });

    expect(result).toEqual([{ commit: head, observations: [finding] }]);
  });

  it("drops a finding about a file the repo later deletes from a read scoped after the deletion", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const withFinding = repo.commit("a.ts", "export const a = 2;\n", "the finding's commit");
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: withFinding,
      observations: [observation({ finding: "duplicated validation logic", sites: ["a.ts:1"] })],
    });
    const afterDeletion = repo.remove("a.ts", "deletes a.ts");

    const result = readObservations({ git: execGit, repoDir: dir, base, head: afterDeletion });

    expect(result).toEqual([]);
  });

  it("keeps a finding whose file survives, dropping only the one whose file is gone, on the same commit", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed a");
    repo.commit("b.ts", "export const b = 1;\n", "seed b");
    const withFindings = repo.commit("a.ts", "export const a = 2;\n", "touches a again");
    const surviving = observation({ finding: "still here", sites: ["a.ts:1"] });
    const stale = observation({ finding: "about to go stale", sites: ["b.ts:1"] });
    writeObservationNote({ git: execGit, repoDir: dir, commit: withFindings, observations: [surviving, stale] });

    const afterDeletingB = repo.remove("b.ts", "deletes b.ts");

    const result = readObservations({ git: execGit, repoDir: dir, base, head: afterDeletingB });

    expect(result).toEqual([{ commit: withFindings, observations: [surviving] }]);
  });

  it("keeps a finding alive when at least one of its several sites still exists", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed a");
    repo.commit("b.ts", "export const b = 1;\n", "seed b");
    const head = repo.commit("a.ts", "export const a = 2;\n", "touches a again");
    const finding = observation({ finding: "seen twice", sites: ["a.ts:1", "b.ts:1"], released: true });
    writeObservationNote({ git: execGit, repoDir: dir, commit: head, observations: [finding] });

    const afterDeletingB = repo.remove("b.ts", "deletes b.ts");

    const result = readObservations({ git: execGit, repoDir: dir, base, head: afterDeletingB });

    expect(result).toEqual([{ commit: head, observations: [finding] }]);
  });

  it("keeps a finding whose site names a real file behind prose, as the first real audit's four do", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");

    // Verbatim from run 32996383308 — the shape the PROPOSED lens actually emits (#108).
    const finding = observation({
      finding: "scratch-project detection duplicated",
      sites: ["a.ts:212 (isScratchProject)", "a.ts (main(), summary console.log)"],
      released: true,
    });
    writeObservationNote({ git: execGit, repoDir: dir, commit: head, observations: [finding] });

    const result = readObservations({ git: execGit, repoDir: dir, base, head, log: () => {} });

    expect(result).toEqual([{ commit: head, observations: [finding] }]);
  });

  it("names the finding and the file when it drops one whose file is gone", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed a");
    repo.commit("b.ts", "export const b = 1;\n", "seed b");
    const withFinding = repo.commit("a.ts", "export const a = 2;\n", "touches a again");
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: withFinding,
      observations: [observation({ finding: "about to go stale", sites: ["b.ts:1"] })],
    });
    const afterDeletion = repo.remove("b.ts", "deletes b.ts");

    const lines: string[] = [];
    readObservations({ git: execGit, repoDir: dir, base, head: afterDeletion, log: (line) => lines.push(line) });

    const dropped = lines.filter((line) => line.startsWith("dropped "));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain("about to go stale");
    expect(dropped[0]).toContain(`b.ts does not exist at ${afterDeletion}`);
    expect(dropped[0]).not.toContain("is not a path");
  });

  it("distinguishes a site that was never a path from one whose file is gone", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: head,
      observations: [observation({ finding: "site is prose", sites: ["gone.ts (some function)"] })],
    });

    const lines: string[] = [];
    readObservations({ git: execGit, repoDir: dir, base, head, log: (line) => lines.push(line) });

    expect(lines.some((line) => line.startsWith("note:") && line.includes("is not a path"))).toBe(true);
    const dropped = lines.find((line) => line.startsWith("dropped "));
    expect(dropped).toContain("is not a path");
    expect(dropped).toContain("gone.ts does not exist");
  });

  it("says a surviving finding's site is not a path, since nothing else would ever report it", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: head,
      observations: [observation({ finding: "survives anyway", sites: ["a.ts:1 (theFunction)"] })],
    });

    const lines: string[] = [];
    const result = readObservations({ git: execGit, repoDir: dir, base, head, log: (line) => lines.push(line) });

    expect(result).toHaveLength(1);
    expect(lines.some((line) => line.startsWith("note:") && line.includes("survives anyway"))).toBe(true);
    expect(lines.some((line) => line.startsWith("dropped "))).toBe(false);
  });

  it("excludes commits outside the range, same as sessionRangeDiff's own bound", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: base, // base itself is excluded by `base..head`
      observations: [observation({ finding: "outside the range" })],
    });
    const head = repo.commit("a.ts", "export const a = 2;\n", "inside the range");
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: head,
      observations: [observation({ finding: "inside the range" })],
    });

    const result = readObservations({ git: execGit, repoDir: dir, base, head });

    expect(result).toEqual([{ commit: head, observations: [observation({ finding: "inside the range" })] }]);
  });

  it("reads from the repo's root when base is omitted", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const root = repo.commit("a.ts", "export const a = 1;\n", "seed");
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: root,
      observations: [observation({ finding: "from the root" })],
    });

    const result = readObservations({ git: execGit, repoDir: dir, head: root });

    expect(result).toEqual([{ commit: root, observations: [observation({ finding: "from the root" })] }]);
  });

  it("overwrites, rather than appends to, a note already on that commit", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");

    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: head,
      observations: [observation({ finding: "first pass" })],
    });
    writeObservationNote({
      git: execGit,
      repoDir: dir,
      commit: head,
      observations: [observation({ finding: "merged, second pass" })],
    });

    const result = readObservations({ git: execGit, repoDir: dir, base, head });

    expect(result).toEqual([{ commit: head, observations: [observation({ finding: "merged, second pass" })] }]);
  });
});

describe("writeObservationNote argv shape", () => {
  it("writes via `notes --ref=observations add -f`, keyed to the given commit", () => {
    const fake = createFakeGit(() => "");

    writeObservationNote({
      git: fake.git,
      repoDir: "/some/repo",
      commit: "abc123",
      observations: [observation({ finding: "f" })],
    });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv.slice(0, 6)).toEqual(["-C", "/some/repo", "notes", "--ref=observations", "add", "-f"]);
    expect(argv[6]).toBe("-m");
    expect(JSON.parse(argv[7])).toEqual([observation({ finding: "f" })]);
    expect(argv[8]).toBe("abc123");
  });
});

describe("readObservations argv shape", () => {
  it("reads via `log <range> --notes=observations`, threading repoDir as -C", () => {
    const fake = createFakeGit(() => "");

    readObservations({ git: fake.git, repoDir: "/some/repo", base: "abc", head: "def" });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv[0]).toBe("-C");
    expect(argv[1]).toBe("/some/repo");
    expect(argv[2]).toBe("log");
    expect(argv[3]).toBe("abc..def");
    expect(argv[4]).toBe("--notes=observations");
  });

  it("reads the unbounded ref alone, not a range, when base is omitted", () => {
    const fake = createFakeGit(() => "");

    readObservations({ git: fake.git, repoDir: "/some/repo", head: "def" });

    const [argv] = fake.calls;
    expect(argv[3]).toBe("def");
  });
});
