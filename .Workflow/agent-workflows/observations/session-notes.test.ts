import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { readSessionRecord, writeSessionRecord } from "./session-notes";
import { sessionRecord } from "./session-record.fixture";

/**
 * A throwaway git repo for one test — trimmed from `notes.test.ts`'s
 * `makeRepo` to what this file needs (no `remove`, since a session record
 * carries no staleness self-drop).
 */
function makeRepo(): {
  dir: string;
  commit: (path: string, contents: string, message: string) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "session-notes-"));
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

describe("writeSessionRecord / readSessionRecord against a real repo", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reads a written record back byte-for-byte equal, and `git notes --ref=sessions list` shows the note", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");
    const record = sessionRecord({ head, base, sessionId: "session-abc", touchedPaths: ["a.ts"] });

    writeSessionRecord({ git: execGit, repoDir: dir, record });

    const result = readSessionRecord({ git: execGit, repoDir: dir, head });
    expect(result).toEqual(record);

    const listed = execFileSync("git", ["notes", "--ref=sessions", "list"], { cwd: dir, encoding: "utf8" });
    expect(listed.trim()).not.toBe("");
    expect(listed).toContain(head);
  });

  it("overwrites, rather than appends to, a note already on that commit", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const head = repo.commit("a.ts", "export const a = 1;\n", "seed");

    writeSessionRecord({ git: execGit, repoDir: dir, record: sessionRecord({ head, sessionId: "first-pass" }) });
    writeSessionRecord({ git: execGit, repoDir: dir, record: sessionRecord({ head, sessionId: "second-pass" }) });

    const result = readSessionRecord({ git: execGit, repoDir: dir, head });

    expect(result).toEqual(sessionRecord({ head, sessionId: "second-pass" }));
  });

  it("returns undefined for a commit with no session record", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const head = repo.commit("a.ts", "export const a = 1;\n", "seed");

    const result = readSessionRecord({ git: execGit, repoDir: dir, head });

    expect(result).toBeUndefined();
  });

  it("keys a read to the exact commit, not to any note reachable in its ancestry", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const base = repo.commit("a.ts", "export const a = 1;\n", "seed");
    writeSessionRecord({
      git: execGit,
      repoDir: dir,
      record: sessionRecord({ head: base, sessionId: "earlier-session" }),
    });
    const head = repo.commit("a.ts", "export const a = 2;\n", "a later commit with no record of its own");

    const result = readSessionRecord({ git: execGit, repoDir: dir, head });

    expect(result).toBeUndefined();
  });
});

describe("writeSessionRecord / readSessionRecord argv shape", () => {
  it("writes via `notes --ref=sessions add -f`, keyed to record.head", () => {
    const fake = createFakeGit(() => "");
    const record = sessionRecord({ head: "abc123" });

    writeSessionRecord({ git: fake.git, repoDir: "/some/repo", record });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv.slice(0, 6)).toEqual(["-C", "/some/repo", "notes", "--ref=sessions", "add", "-f"]);
    expect(argv[6]).toBe("-m");
    expect(JSON.parse(argv[7])).toEqual([record]);
    expect(argv[8]).toBe("abc123");
  });

  it("reads via `log <head> --notes=sessions`, threading repoDir as -C, with no base", () => {
    const fake = createFakeGit(() => "");

    readSessionRecord({ git: fake.git, repoDir: "/some/repo", head: "def" });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv[0]).toBe("-C");
    expect(argv[1]).toBe("/some/repo");
    expect(argv[2]).toBe("log");
    expect(argv[3]).toBe("def");
    expect(argv[4]).toBe("--notes=sessions");
  });
});
