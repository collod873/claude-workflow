import type { GitExec } from "../shared/git";
import { readNoteArray, writeNoteArray } from "../shared/notes-store";
import { SessionRecord } from "./session-record-schema";

/**
 * The notes ref this module's read/write pair uses, unqualified so git
 * resolves it under `refs/notes/sessions` (git.ts's `-C <dir>` convention).
 * A third fact alongside `observations` (./notes.ts) and `ratifications`
 * (./ratification.ts), each on its own ref for the reason ratification.ts's
 * own `NOTES_REF` comment gives: different facts, different lifetimes.
 */
const NOTES_REF = "sessions";

export interface WriteSessionRecordOptions {
  git: GitExec;
  /** The repo to write into, threaded as `-C <repoDir>` — never baked into `git`'s closure. */
  repoDir: string;
  record: SessionRecord;
}

/**
 * Writes `record` as one git note on `refs/notes/sessions`, keyed to
 * `record.head` — built on `notes-store.ts`'s generic pair, wrapping the one
 * record as the single-element array that pair's wire format carries.
 * Overwrites (`-f`) whatever note already sits on that commit, the same
 * overwrite semantics `writeObservationNote` and `writeRatificationNote`
 * use; in practice a session's own head commit never gets a second record,
 * since a session runs once.
 */
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
  /** The repo to read from, threaded as `-C <repoDir>`. */
  repoDir: string;
  /** The commit whose session record this reads — the same commit it was written under. */
  head: string;
}

/**
 * Reads the session record written at exactly `head`, or `undefined` when
 * no note sits on that commit. Unlike `readObservations` and
 * `readRatificationRecords`, this is never a range read: a session record is
 * one fact about one commit, not evidence that accumulates across a span, so
 * there is nothing to fold across `base..head` here — `readNoteArray` is
 * called with `base` omitted (an unbounded walk from `head`) and the result
 * is filtered down to the one entry keyed to `head` itself, which git log
 * always yields first.
 */
export function readSessionRecord(options: ReadSessionRecordOptions): SessionRecord | undefined {
  const { git, repoDir, head } = options;
  const results = readNoteArray({ git, repoDir, ref: NOTES_REF, head, schema: SessionRecord });
  return results.find((result) => result.commit === head)?.records[0];
}
