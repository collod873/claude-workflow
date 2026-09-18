import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitExec } from "./git.ts";
import { readNoteArray, writeNoteArray } from "./notes-store.ts";
import { reason } from "./reason.ts";
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
