import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionRecord } from "./session-record-schema";
import { execGit } from "./git";
import { legacySessionRecord, rewriteSessionNotesSchema } from "./rewrite-session-notes-schema";
import { scratchDir } from "./scratch.fixture";
import { cloneRepo, makeBareRepo, noteOnRemote, type TempRepo } from "./temp-repo.fixture";

function commitAndPush(repo: TempRepo, path: string, contents: string, message: string): string {
  repo.write(path, contents);
  const sha = repo.commit(message);
  repo.git("push", "-q", "origin", "HEAD:refs/heads/main");
  return sha;
}

function readNoteFromRemote(bareDir: string, sha: string): unknown[] {
  return JSON.parse(noteOnRemote(bareDir, "sessions", sha));
}

describe("rewriteSessionNotesSchema", () => {
  it(
    "drops spine from every note, backfills corpusPath for a session the corpus captured, and " +
      "leaves an uncaptured session's range untouched, then force-pushes the rewrite",
    () => {
      const bareDir = makeBareRepo("rewrite-session-notes-bare");
      const repo = cloneRepo(bareDir, "rewrite-session-notes-clone");
      const repoDir = repo.dir;

      const capturedHead = commitAndPush(repo, "a.ts", "export const a = 1;\n", "captured session");
      const uncapturedHead = commitAndPush(repo, "a.ts", "export const a = 2;\n", "uncaptured session");

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

      const corpusDir = scratchDir("rewrite-session-notes-corpus");
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
      expect(SessionRecord.parse(captured)).toEqual(captured);

      const uncaptured = rewritten.find((r) => r.commit === uncapturedHead)?.record;
      expect(uncaptured).not.toHaveProperty("corpusPath");
      expect(uncaptured?.sessionId).toBe(uncapturedRecord.sessionId);
      expect(uncaptured?.base).toBe(uncapturedRecord.base);
      expect(uncaptured?.head).toBe(uncapturedRecord.head);
      expect(uncaptured?.touchedPaths).toEqual(uncapturedRecord.touchedPaths);

      expect(readNoteFromRemote(bareDir, capturedHead)).toEqual([captured]);
      expect(readNoteFromRemote(bareDir, uncapturedHead)).toEqual([uncaptured]);
    },
  );
});
