import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeStage } from "../shared/stage.fake";
import { readObservations } from "./notes";
import { runObservations } from "./run-observations";

/** Mirrors `notes.test.ts`'s `makeRepo` — a throwaway git repo for one test. */
function makeRepo(): { dir: string; commit: (path: string, contents: string, message: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "run-observations-"));
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

describe("runObservations", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("runs the PROPOSED auditor and writes its findings as a note on head, tagged with the PROPOSED lens", async () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");
    const fakeStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:1\n");

    const result = await runObservations({
      git: execGit,
      exec: fakeStage.exec,
      repoDir: dir,
      base,
      head,
      touchedPaths: ["a.ts"],
      spine: "the session's own spine",
    });

    expect(result).toEqual([
      { finding: "duplicated validation logic", lens: "PROPOSED", sites: ["a.ts:1"], released: false },
    ]);

    const stored = readObservations({ git: execGit, repoDir: dir, base, head });
    expect(stored).toEqual([{ commit: head, observations: result }]);
  });

  it("folds the prior note's findings in, releasing a finding once a second run names a second site", async () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const firstHead = repo.commit("a.ts", "export const a = 2;\n", "first session");
    const firstStage = createFakeStage("Finding: duplicated validation logic\nSite: a.ts:1\n");
    const firstRun = await runObservations({
      git: execGit,
      exec: firstStage.exec,
      repoDir: dir,
      base,
      head: firstHead,
      spine: "first session's spine",
    });
    expect(firstRun[0].released).toBe(false);

    writeFileSync(join(dir, "b.ts"), "export const b = 1;\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "second session"], { cwd: dir });
    const secondHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const secondStage = createFakeStage("Finding: duplicated validation logic\nSite: b.ts:1\n");

    const secondRun = await runObservations({
      git: execGit,
      exec: secondStage.exec,
      repoDir: dir,
      base: firstHead,
      head: secondHead,
      spine: "second session's spine",
    });

    expect(secondRun).toEqual([
      {
        finding: "duplicated validation logic",
        lens: "PROPOSED",
        sites: ["a.ts:1", "b.ts:1"],
        released: true,
      },
    ]);
  });
});
