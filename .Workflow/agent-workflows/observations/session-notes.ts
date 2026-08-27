import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitExec } from "../shared/git.ts";
import { readNoteArray, writeNoteArray } from "../shared/notes-store.ts";
import { reason } from "../shared/reason.ts";
import { SessionRecord } from "./session-record-schema.ts";

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

/** A `SessionRecord` with its `corpusPath` hydrated into a spine — what a caller gets back when it supplies `corpusDir`. */
export type HydratedSessionRecord = SessionRecord & { spine: string };

/**
 * Reads the session record written at exactly `head`, or `undefined` when no
 * note sits on that commit. Unlike `readObservations` and
 * `readRatificationRecords`, this is never a range read: a session record is
 * one fact about one commit, not evidence that accumulates across a span, so
 * there is nothing to fold across `base..head` here — `readNoteArray` is
 * called with `base` omitted (an unbounded walk from `head`) and the result
 * is filtered down to the one entry keyed to `head` itself, which git log
 * always yields first.
 *
 * `corpusPath` never travels further than this function unresolved: passing
 * `corpusDir` reads `<corpusDir>/<record.corpusPath>` and returns the record
 * with `spine` hydrated from that file's contents, throwing when the named
 * file is absent — a broken join should refuse the run, not audit an empty
 * spine (spec #134 §Implementation Decisions). Omitting `corpusDir` returns
 * the record as written, with no `spine` — the shape a caller that only
 * wants the range (e.g. a future backfill) can use without a corpus at all.
 * The two overloads below are why `runAudit` doesn't typecheck by accident:
 * passing a `corpusDir` is what makes `record.spine` a `string` rather than
 * absent, and `runObservations` requires exactly that.
 */
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
