import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionRecord } from "../observations/session-record-schema";
import { execGit } from "./git";
import { legacySessionRecord, rewriteSessionNotesSchema } from "./rewrite-session-notes-schema";

// A fixture bare repo stands in for a remote throughout this file — never the real
// Knowledge-Base checkout or the real `origin` (spec #134 §Testing Decisions, "No test may touch
// the real Knowledge-Base or the real origin"). Prior art for the shape is
// `notes-sync.test.ts`'s `makeRemoteAndClones` and `.claude/hooks/session-capture.test.ts`'s
// `makeBareRemote`/`cloneRepo`, trimmed to what this file needs.

let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A bare git repo standing in for the remote this rewrite force-pushes to. */
function makeBareRemote(): string {
  const dir = tmp("rewrite-session-notes-bare-");
  execFileSync("git", ["init", "-q", "--bare", dir]);
  return dir;
}

/** Clones `bareDir`, with a committer identity configured so the clone can make its own commits. */
function cloneRepo(bareDir: string): string {
  const dir = tmp("rewrite-session-notes-clone-");
  execFileSync("git", ["clone", "-q", bareDir, "."], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

/** Commits one file in `dir` and pushes it to the bare remote's `main`. */
function commitAndPush(dir: string, path: string, contents: string, message: string): string {
  writeFileSync(join(dir, path), contents, "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], { cwd: dir });
  return sha;
}

/** Reads back the one-element session-notes array a fresh clone of `bareDir` sees for `sha`. */
function readNoteFromRemote(bareDir: string, sha: string): unknown[] {
  const dir = tmp("rewrite-session-notes-verify-");
  execFileSync("git", ["clone", "-q", bareDir, "."], { cwd: dir });
  execFileSync("git", ["-C", dir, "fetch", "-q", "origin", "+refs/notes/sessions:refs/notes/sessions"]);
  const raw = execFileSync("git", ["-C", dir, "notes", "--ref=sessions", "show", sha], {
    encoding: "utf8",
  }).trim();
  return JSON.parse(raw);
}

describe("rewriteSessionNotesSchema", () => {
  it(
    "drops spine from every note, backfills corpusPath for a session the corpus captured, and " +
      "leaves an uncaptured session's range untouched — then force-pushes the rewrite",
    () => {
      const bareDir = makeBareRemote();
      const repoDir = cloneRepo(bareDir);

      const capturedHead = commitAndPush(repoDir, "a.ts", "export const a = 1;\n", "captured session");
      const uncapturedHead = commitAndPush(repoDir, "a.ts", "export const a = 2;\n", "uncaptured session");

      // First 8 characters deliberately distinct — that prefix is the whole match key
      // `findCorpusPath` uses, so two ids sharing one would make this test pass by accident.
      const capturedRecord = legacySessionRecord({
        head: capturedHead,
        sessionId: "captured-session-abc123",
        touchedPaths: ["a.ts"],
      });
      const uncapturedRecord = legacySessionRecord({
        head: uncapturedHead,
        sessionId: "uncaptur-session-xyz999",
        touchedPaths: ["a.ts"],
      });

      // Seed refs/notes/sessions with pre-migration records — the shape #134 is rewriting away
      // from — and publish them to the bare remote, exactly like the 29 records this migration
      // targets in the real repo.
      execGit([
        "-C",
        repoDir,
        "notes",
        "--ref=sessions",
        "add",
        "-f",
        "-m",
        JSON.stringify([capturedRecord]),
        capturedHead,
      ]);
      execGit([
        "-C",
        repoDir,
        "notes",
        "--ref=sessions",
        "add",
        "-f",
        "-m",
        JSON.stringify([uncapturedRecord]),
        uncapturedHead,
      ]);
      execGit(["-C", repoDir, "push", "origin", "refs/notes/sessions:refs/notes/sessions"]);

      // A fixture Knowledge-Base checkout holding the captured session's capture file — and
      // nothing for the uncaptured one, so the corpus genuinely never saw it.
      const corpusDir = tmp("rewrite-session-notes-corpus-");
      const sessionsDir = join(corpusDir, "raw", "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const captureFileName = `2026-08-20-${capturedRecord.sessionId.slice(0, 8)}.md`;
      writeFileSync(join(sessionsDir, captureFileName), "---\nsession spine\n", "utf8");

      const rewritten = rewriteSessionNotesSchema({ git: execGit, repoDir, corpusDir, remote: "origin" });

      expect(rewritten).toHaveLength(2);
      for (const { record } of rewritten) expect(record).not.toHaveProperty("spine");

      const captured = rewritten.find((r) => r.commit === capturedHead)?.record;
      expect(captured?.corpusPath).toBe(join("raw", "sessions", captureFileName));
      expect(captured?.sessionId).toBe(capturedRecord.sessionId);
      expect(captured?.base).toBe(capturedRecord.base);
      expect(captured?.touchedPaths).toEqual(capturedRecord.touchedPaths);
      // Once corpusPath is backfilled, the record is a genuine SessionRecord — the schema every
      // other reader and writer in this tree already requires.
      expect(SessionRecord.parse(captured)).toEqual(captured);

      const uncaptured = rewritten.find((r) => r.commit === uncapturedHead)?.record;
      expect(uncaptured).not.toHaveProperty("corpusPath");
      expect(uncaptured?.sessionId).toBe(uncapturedRecord.sessionId);
      expect(uncaptured?.base).toBe(uncapturedRecord.base);
      expect(uncaptured?.head).toBe(uncapturedRecord.head);
      expect(uncaptured?.touchedPaths).toEqual(uncapturedRecord.touchedPaths);

      // The rewrite reached the remote it was given, not just the local clone.
      expect(readNoteFromRemote(bareDir, capturedHead)).toEqual([captured]);
      expect(readNoteFromRemote(bareDir, uncapturedHead)).toEqual([uncaptured]);
    },
  );
});
