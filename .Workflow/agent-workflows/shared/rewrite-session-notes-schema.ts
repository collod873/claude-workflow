import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SessionIdentity, SessionRecord } from "./session-record-schema";
import { execGit, type GitExec } from "./git";
import { reason } from "./reason";

const NOTES_REF = "sessions";

const CORPUS_SESSIONS_SUBDIR = join("raw", "sessions");

export const LegacySessionRecord = SessionIdentity.extend({
  spine: z.string(),
});
export type LegacySessionRecord = z.infer<typeof LegacySessionRecord>;

export function legacySessionRecord(
  overrides: Partial<LegacySessionRecord> & { head: string },
): LegacySessionRecord {
  return {
    sessionId: "session-123",
    base: "0000000000000000000000000000000000000000",
    touchedPaths: ["a.ts"],
    spine: "---\nsession_id: session-123\n---\n\n## User Prompts\n- do the thing\n",
    ...overrides,
  };
}

export const RewrittenSessionRecord = SessionRecord.partial({ corpusPath: true });
export type RewrittenSessionRecord = z.infer<typeof RewrittenSessionRecord>;

function findCorpusPath(corpusDir: string, sessionId: string): string | undefined {
  const sid8 = sessionId.slice(0, 8);
  let files: string[];
  try {
    files = readdirSync(join(corpusDir, CORPUS_SESSIONS_SUBDIR));
  } catch {
    return undefined;
  }
  const match = files.find((file) => file.endsWith(`-${sid8}.md`));
  return match ? join(CORPUS_SESSIONS_SUBDIR, match) : undefined;
}

export interface RewriteSessionNotesSchemaOptions {
  git: GitExec;
  repoDir: string;
  corpusDir: string;
  remote: string;
}

export interface RewrittenSession {
  commit: string;
  record: RewrittenSessionRecord;
}

export function rewriteSessionNotesSchema(options: RewriteSessionNotesSchemaOptions): RewrittenSession[] {
  const { git, repoDir, corpusDir, remote } = options;

  const listing = git(["-C", repoDir, "notes", `--ref=${NOTES_REF}`, "list"]);
  const commits = listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[1])
    .filter((commit): commit is string => Boolean(commit));

  const rewritten: RewrittenSession[] = [];

  for (const commit of commits) {
    const raw = git(["-C", repoDir, "notes", `--ref=${NOTES_REF}`, "show", commit]).trim();
    const legacyRecords = LegacySessionRecord.array().parse(JSON.parse(raw));

    const records = legacyRecords.map((record): RewrittenSessionRecord => {
      const { spine: _spine, ...rest } = record;
      const corpusPath = findCorpusPath(corpusDir, record.sessionId);
      return RewrittenSessionRecord.parse(corpusPath ? { ...rest, corpusPath } : rest);
    });

    git(["-C", repoDir, "notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", JSON.stringify(records), commit]);
    for (const record of records) rewritten.push({ commit, record });
  }

  git(["-C", repoDir, "push", "--force", remote, `refs/notes/${NOTES_REF}:refs/notes/${NOTES_REF}`]);

  return rewritten;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const [repoDir, corpusDir, remote] = process.argv.slice(2);
  if (!repoDir || !corpusDir || !remote) {
    console.error("usage: rewrite-session-notes-schema.ts <repoDir> <corpusDir> <remote>");
    process.exit(2);
  } else {
    try {
      const rewritten = rewriteSessionNotesSchema({ git: execGit, repoDir, corpusDir, remote });
      const backfilled = rewritten.filter((r) => r.record.corpusPath !== undefined).length;
      console.log(
        `rewrite-session-notes-schema: rewrote ${rewritten.length} record(s), ${backfilled} ` +
          `backfilled with corpusPath, force-pushed to ${remote}`,
      );
    } catch (err) {
      console.error(`rewrite-session-notes-schema: ${reason(err)}`);
      process.exit(1);
    }
  }
}
