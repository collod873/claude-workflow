import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitExec } from "../shared/git.ts";
import { readNoteArray, writeNoteArray } from "../shared/notes-store.ts";
import { reason } from "../shared/reason.ts";
import { SessionRecord } from "./session-record-schema.ts";

const NOTES_REF = "sessions";

export interface WriteSessionRecordOptions {
  git: GitExec;
  repoDir: string;
  record: SessionRecord;
}

export function writeSessionRecord(options: WriteSessionRecordOptions): void {
  const { git, repoDir, record } = options;
  writeNoteArray({
    git,
    repoDir,
    ref: NOTES_REF,
    commit: record.head,
    records: [record],
    schema: SessionRecord,
  });
}

export interface ReadSessionRecordOptions {
  git: GitExec;
  repoDir: string;
  head: string;
}

export type HydratedSessionRecord = SessionRecord & { spine: string };

export function readSessionRecord(
  options: ReadSessionRecordOptions & { corpusDir: string },
): HydratedSessionRecord | undefined;
export function readSessionRecord(
  options: ReadSessionRecordOptions & { corpusDir?: undefined },
): SessionRecord | undefined;
export function readSessionRecord(
  options: ReadSessionRecordOptions & { corpusDir?: string },
): SessionRecord | HydratedSessionRecord | undefined {
  const { git, repoDir, head, corpusDir } = options;
  const results = readNoteArray({ git, repoDir, ref: NOTES_REF, head, schema: SessionRecord });
  const record = results.find((result) => result.commit === head)?.records[0];
  if (!record) return undefined;
  if (corpusDir === undefined) return record;

  const spinePath = join(corpusDir, record.corpusPath);
  try {
    const spine = readFileSync(spinePath, "utf8");
    return { ...record, spine };
  } catch (err) {
    throw new Error(
      `session ${record.sessionId}'s corpusPath "${record.corpusPath}" not found under corpus directory "${corpusDir}": ${reason(err)}`,
    );
  }
}
