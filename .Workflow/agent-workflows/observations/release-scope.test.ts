import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { observation } from "./observation.fixture";
import {
  DEFAULT_RELEASE_THRESHOLD,
  computeReleaseScope,
  countReleasedObservations,
  evaluateReleaseTrigger,
  isMachineryCommit,
  releaseCommitRange,
} from "./release-scope";

/**
 * A throwaway git repo for one test, with a helper to commit a file (an
 * ordinary commit, or one carrying the machinery trailer) and hand back the
 * new commit's SHA — mirrors `diff.test.ts` / `notes.test.ts`'s `makeRepo`.
 */
function makeRepo(): {
  dir: string;
  commit: (path: string, contents: string, message: string) => string;
  machineryCommit: (path: string, contents: string, message: string) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "release-scope-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  function commit(path: string, contents: string, message: string): string {
    writeFileSync(join(dir, path), contents, "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  function machineryCommit(path: string, contents: string, message: string): string {
    return commit(path, contents, `${message}\n\nMachinery-Commit: true`);
  }

  return { dir, commit, machineryCommit };
}

describe("countReleasedObservations / evaluateReleaseTrigger", () => {
  it("does not fire at 19 released observations", () => {
    const observations = Array.from({ length: 19 }, (_, i) => observation({ finding: `f${i}`, released: true }));

    expect(countReleasedObservations(observations)).toBe(19);
    expect(evaluateReleaseTrigger({ releasedCount: 19, prdClosed: false }).shouldRelease).toBe(false);
  });

  it("fires once released observations cross the default threshold of 20", () => {
    const observations = Array.from({ length: 20 }, (_, i) => observation({ finding: `f${i}`, released: true }));

    expect(countReleasedObservations(observations)).toBe(20);
    expect(evaluateReleaseTrigger({ releasedCount: 20, prdClosed: false }).shouldRelease).toBe(true);
  });

  it("only counts observations that cleared the two-site gate", () => {
    const observations = [
      ...Array.from({ length: 20 }, (_, i) => observation({ finding: `gated-${i}`, released: false })),
      observation({ finding: "cleared", released: true }),
    ];

    expect(countReleasedObservations(observations)).toBe(1);
  });

  it("fires on a PRD-close event regardless of count", () => {
    expect(evaluateReleaseTrigger({ releasedCount: 0, prdClosed: true }).shouldRelease).toBe(true);
  });

  it("respects an overridden threshold", () => {
    expect(evaluateReleaseTrigger({ releasedCount: 5, prdClosed: false, threshold: 5 }).shouldRelease).toBe(true);
    expect(evaluateReleaseTrigger({ releasedCount: 4, prdClosed: false, threshold: 5 }).shouldRelease).toBe(false);
  });

  it("exposes the default threshold as 20, spec #36's starting N", () => {
    expect(DEFAULT_RELEASE_THRESHOLD).toBe(20);
  });
});

describe("isMachineryCommit", () => {
  it("recognizes the Machinery-Commit trailer, case-insensitively, anywhere in the body", () => {
    expect(isMachineryCommit({ sha: "a", author: "x", subject: "s", body: "Machinery-Commit: true" })).toBe(true);
    expect(
      isMachineryCommit({ sha: "a", author: "x", subject: "s", body: "Part of #1\n\nmachinery-commit: TRUE" }),
    ).toBe(true);
  });

  it("does not flag an ordinary commit with no trailer", () => {
    expect(isMachineryCommit({ sha: "a", author: "x", subject: "s", body: "Part of #1" })).toBe(false);
    expect(isMachineryCommit({ sha: "a", author: "x", subject: "s", body: "" })).toBe(false);
  });
});

describe("releaseCommitRange", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("excludes commits tagged as the machinery's own while keeping other commits in the same range", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const real1 = repo.commit("a.ts", "export const a = 2;\n", "real work, first");
    const machinery = repo.machineryCommit("ledger.md", "entry\n", "the pipeline's own ratify commit");
    const real2 = repo.commit("a.ts", "export const a = 3;\n", "real work, second");
    const head = real2;

    const range = releaseCommitRange({ git: execGit, repoDir: dir, base, head });

    expect(range.commits).toEqual([real1, real2]);
    expect(range.commits).not.toContain(machinery);
  });

  it("excludes commits outside base..head, same bound as sessionRangeDiff/readObservations", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "inside the range");
    repo.commit("a.ts", "export const a = 3;\n", "after head, outside the range");

    const range = releaseCommitRange({ git: execGit, repoDir: dir, base, head });

    expect(range.commits).toEqual([head]);
  });

  it("accepts an injected predicate in place of the default trailer check", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const kept = repo.commit("a.ts", "export const a = 2;\n", "keep me");
    const dropped = repo.commit("a.ts", "export const a = 3;\n", "drop me");

    const range = releaseCommitRange({
      git: execGit,
      repoDir: dir,
      base,
      head: dropped,
      isMachineryCommit: (commit) => commit.subject.includes("drop"),
    });

    expect(range.commits).toEqual([kept]);
  });

  it("threads the repo dir through argv as -C, never through the git executor's own closure", () => {
    const fake = createFakeGit(() => "");

    releaseCommitRange({ git: fake.git, repoDir: "/some/repo", base: "abc", head: "def" });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0][0]).toBe("-C");
    expect(fake.calls[0][1]).toBe("/some/repo");
    expect(fake.calls[0]).toContain("abc..def");
  });
});

describe("computeReleaseScope", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("does not compute a range when the trigger doesn't fire", () => {
    const fake = createFakeGit((args) => {
      if (args.includes("log") && args.some((a) => a.startsWith("--notes"))) return "";
      throw new Error(`unexpected call: ${JSON.stringify(args)}`);
    });

    const scope = computeReleaseScope({ git: fake.git, repoDir: "/some/repo", head: "def", prdClosed: false });

    expect(scope.shouldRelease).toBe(false);
    expect(scope.range).toBeUndefined();
  });

  it("fires on PRD-close with zero observations and returns the full commit range, machinery excluded", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const real = repo.commit("a.ts", "export const a = 2;\n", "real work");
    const machinery = repo.machineryCommit("ledger.md", "entry\n", "pipeline commit");
    const head = machinery;

    const scope = computeReleaseScope({ git: execGit, repoDir: dir, base, head, prdClosed: true });

    expect(scope.shouldRelease).toBe(true);
    expect(scope.range?.commits).toEqual([real]);
  });

  it("fires once the notes in range carry 20 released observations", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");

    execFileSync(
      "git",
      [
        "notes",
        "--ref=observations",
        "add",
        "-f",
        "-m",
        JSON.stringify(Array.from({ length: 20 }, (_, i) => observation({ finding: `f${i}`, released: true }))),
        head,
      ],
      { cwd: dir },
    );

    const scope = computeReleaseScope({ git: execGit, repoDir: dir, base, head, prdClosed: false });

    expect(scope.shouldRelease).toBe(true);
    expect(scope.releasedCount).toBe(20);
  });
});
