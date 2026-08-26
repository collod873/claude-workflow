import type { z } from "zod";
import type { GitExec } from "./git.ts";

/**
 * The generic shape duplicated between `writeObservationNote`/`readObservations`
 * (`observations/notes.ts`) and `writeRatificationNote`/`readRatificationRecords`
 * (`observations/ratification.ts`): a JSON array written as one git note on a
 * ref of the caller's choosing, keyed to a commit, overwritten (never
 * appended to) on a second write to the same commit, and read back with
 * `git log <range> --notes=<ref>`, one array per commit that carries a note.
 *
 * Pulled out here rather than folded into either existing module — spec #63
 * ticket #65 generalizes the pattern for a third ref (`refs/notes/sessions`,
 * `observations/session-notes.ts`) without touching the two callers that
 * already have it inlined; a caller with a reason to diverge (the staleness
 * self-drop `readObservations` layers on top, the flattening
 * `readRatificationRecords` does) still can, without contorting this module
 * to also express the divergence.
 */

/** A record separator no JSON array payload can contain. */
const RECORD_SEP = "\x1e";
/** Separates a commit hash from its note text within one record. */
const FIELD_SEP = "\x1f";

export interface WriteNoteArrayOptions<T> {
  git: GitExec;
  /** The repo to write into, threaded as `-C <repoDir>` — never baked into `git`'s closure. */
  repoDir: string;
  /** The notes ref, unqualified so git resolves it under `refs/notes/<ref>`. */
  ref: string;
  /** The commit this note is keyed to. */
  commit: string;
  /** The array this note holds, validated against `schema` before it is written. */
  records: T[];
  /** The zod schema `records` must satisfy — the same schema `readNoteArray` validates a read back against. */
  schema: z.ZodType<T>;
}

/**
 * Writes `records` as one git note on `refs/notes/<ref>`, keyed to `commit`.
 * Overwrites (`-f`) whatever note already sits on that commit — the same
 * always-the-full-set contract `writeObservationNote` and
 * `writeRatificationNote` document on their own callers; this module has no
 * opinion on whether a caller's set is a delta or the whole thing, only that
 * whatever is handed in replaces whatever was there.
 */
export function writeNoteArray<T>(options: WriteNoteArrayOptions<T>): void {
  const { git, repoDir, ref, commit, records, schema } = options;
  const message = JSON.stringify(schema.array().parse(records));
  git(["-C", repoDir, "notes", `--ref=${ref}`, "add", "-f", "-m", message, commit]);
}

export interface ReadNoteArrayOptions<T> {
  git: GitExec;
  /** The repo to read from, threaded as `-C <repoDir>`. */
  repoDir: string;
  /** The notes ref, unqualified so git resolves it under `refs/notes/<ref>`. */
  ref: string;
  /** The commit the range starts after (exclusive). Omit to read from the repo's root. */
  base?: string;
  /** The last commit in the range. */
  head: string;
  /** The zod schema each commit's array is validated against. */
  schema: z.ZodType<T>;
}

/** One commit's note, as `readNoteArray` hands it back. */
export interface CommitNoteArray<T> {
  commit: string;
  records: T[];
}

/**
 * Reads every note in the range on `ref`, the equivalent of
 * `git log <range> --notes=<ref>`, keyed to the exact commit each note was
 * written on — newest commit first, git log's own order. A commit with no
 * note on `ref` is absent from the result rather than returned with an empty
 * array.
 *
 * This is `readObservations`'s own read, minus the staleness self-drop that
 * is specific to a finding's sites still existing at `head`; a caller that
 * needs that (or `readRatificationRecords`'s flattening across commits) does
 * it on top of this function's result rather than this function growing an
 * option to express every caller's own shape.
 */
export function readNoteArray<T>(options: ReadNoteArrayOptions<T>): CommitNoteArray<T>[] {
  const { git, repoDir, ref, base, head, schema } = options;
  const range = base ? `${base}..${head}` : head;
  const format = `%H${FIELD_SEP}%N${RECORD_SEP}`;
  const raw = git(["-C", repoDir, "log", range, `--notes=${ref}`, `--format=${format}`]);

  const results: CommitNoteArray<T>[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    if (!record.trim()) continue;

    const sepIndex = record.indexOf(FIELD_SEP);
    const commit = (sepIndex === -1 ? record : record.slice(0, sepIndex)).trim();
    const note = (sepIndex === -1 ? "" : record.slice(sepIndex + FIELD_SEP.length)).trim();
    if (!note) continue;

    results.push({ commit, records: schema.array().parse(JSON.parse(note)) });
  }
  return results;
}
