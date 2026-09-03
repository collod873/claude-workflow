import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { execGit } from "../shared/git";
import { createFakeGit } from "../shared/git.fake";
import { scratchDir } from "../shared/scratch.fixture";
import { makeTempRepo, type TempRepo } from "../shared/temp-repo.fixture";
import { readSessionRecord, writeSessionRecord } from "./session-notes";
import { sessionRecord } from "./session-record.fixture";

/** A repo with `a.ts` seeded at `head` — the one commit most records below are keyed to. */
function seededRepo(): { repo: TempRepo; head: string } {
  const repo = makeTempRepo("session-notes");
  repo.write("a.ts", "export const a = 1;\n");
  return { repo, head: repo.commit("seed") };
}

/** Writes `record` to `repo`'s notes and reads it straight back at its own head — the round trip the hydration-free tests assert on. */
function roundTrip(repo: TempRepo, record: ReturnType<typeof sessionRecord>): ReturnType<typeof readSessionRecord> {
  writeSessionRecord({ git: execGit, repoDir: repo.dir, record });
  return readSessionRecord({ git: execGit, repoDir: repo.dir, head: record.head });
}

describe("writeSessionRecord / readSessionRecord against a real repo", () => {
  it("reads a written record back byte-for-byte equal, and `git notes --ref=sessions list` shows the note", () => {
    const { repo, head: base } = seededRepo();
    repo.write("a.ts", "export const a = 2;\n");
    const head = repo.commit("the session's own commit");
    const record = sessionRecord({ head, base, sessionId: "session-abc", touchedPaths: ["a.ts"] });

    expect(roundTrip(repo, record)).toEqual(record);

    const listed = repo.git("notes", "--ref=sessions", "list");
    expect(listed).not.toBe("");
    expect(listed).toContain(head);
  });

  it("overwrites, rather than appends to, a note already on that commit", () => {
    const { repo, head } = seededRepo();

    writeSessionRecord({ git: execGit, repoDir: repo.dir, record: sessionRecord({ head, sessionId: "first-pass" }) });
    writeSessionRecord({ git: execGit, repoDir: repo.dir, record: sessionRecord({ head, sessionId: "second-pass" }) });

    const result = readSessionRecord({ git: execGit, repoDir: repo.dir, head });

    expect(result).toEqual(sessionRecord({ head, sessionId: "second-pass" }));
  });

  it("returns undefined for a commit with no session record", () => {
    const { repo, head } = seededRepo();

    const result = readSessionRecord({ git: execGit, repoDir: repo.dir, head });

    expect(result).toBeUndefined();
  });

  it("keys a read to the exact commit, not to any note reachable in its ancestry", () => {
    const { repo, head: base } = seededRepo();
    writeSessionRecord({
      git: execGit,
      repoDir: repo.dir,
      record: sessionRecord({ head: base, sessionId: "earlier-session" }),
    });
    repo.write("a.ts", "export const a = 2;\n");
    const head = repo.commit("a later commit with no record of its own");

    const result = readSessionRecord({ git: execGit, repoDir: repo.dir, head });

    expect(result).toBeUndefined();
  });
});

describe("readSessionRecord's corpus hydration", () => {
  it("hydrates spine from the file corpusPath names, when the corpus directory holds it", () => {
    const { repo, head } = seededRepo();
    const corpusDir = scratchDir("session-notes-corpus");
    const record = sessionRecord({ head, corpusPath: "raw/sessions/2026-08-26-session-abc.md" });
    writeSessionRecord({ git: execGit, repoDir: repo.dir, record });

    const spineContents = "---\nsession_id: session-abc\n---\n\n## User Prompts\n- do the thing\n";
    mkdirSync(dirname(join(corpusDir, record.corpusPath)), { recursive: true });
    writeFileSync(join(corpusDir, record.corpusPath), spineContents, "utf8");

    const result = readSessionRecord({ git: execGit, repoDir: repo.dir, head, corpusDir });

    expect(result).toEqual({ ...record, spine: spineContents });
  });

  it("returns the record with no spine property when the corpus-directory option is omitted", () => {
    const { repo, head } = seededRepo();
    const record = sessionRecord({ head });

    const result = roundTrip(repo, record);

    expect(result).toEqual(record);
    expect(result).not.toHaveProperty("spine");
  });

  it("throws when corpusPath names a file absent from the supplied corpus directory", () => {
    const { repo, head } = seededRepo();
    const corpusDir = scratchDir("session-notes-corpus");
    const record = sessionRecord({ head, corpusPath: "raw/sessions/does-not-exist.md" });
    writeSessionRecord({ git: execGit, repoDir: repo.dir, record });

    expect(() => readSessionRecord({ git: execGit, repoDir: repo.dir, head, corpusDir })).toThrow();
  });
});

describe("writeSessionRecord / readSessionRecord argv shape", () => {
  it("writes via `notes --ref=sessions add -f`, keyed to record.head", () => {
    const fake = createFakeGit(() => "");
    const record = sessionRecord({ head: "abc123" });

    writeSessionRecord({ git: fake.git, repoDir: "/some/repo", record });

    expect(fake.calls).toHaveLength(1);
    const [argv] = fake.calls;
    expect(argv.slice(0, 7)).toEqual(["-C", "/some/repo", "notes", "--ref=sessions", "add", "-f", "-m"]);
    expect(JSON.parse(argv[7])).toEqual([record]);
    expect(argv[8]).toBe("abc123");
  });

  it("reads via `log <head> --notes=sessions`, threading repoDir as -C, with no base", () => {
    const fake = createFakeGit(() => "");

    readSessionRecord({ git: fake.git, repoDir: "/some/repo", head: "def" });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].slice(0, 5)).toEqual(["-C", "/some/repo", "log", "def", "--notes=sessions"]);
  });
});
