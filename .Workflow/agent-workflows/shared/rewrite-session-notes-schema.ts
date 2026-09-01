import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SessionRecord } from "./session-record-schema";
import { execGit, type GitExec } from "./git";
import { reason } from "./reason";

/**
 * The one-time migration #134's "The deletion, and the rewrite" section calls for (ticket #142):
 * every record already published on `refs/notes/sessions` is rewritten from the pre-#134 wire
 * format — `sessionId`, `base`, `head`, `touchedPaths`, `spine` — to the shape
 * `session-record-schema.ts`'s `SessionRecord` now describes: `spine` dropped, `corpusPath`
 * backfilled from a Knowledge-Base checkout when that checkout holds the session's capture file.
 *
 * "A record whose session is absent from the corpus keeps its range and loses its spine; the range
 * is still auditable and the spine is not recoverable from a public place" (spec #134, "The
 * deletion, and the rewrite") — backfilling `corpusPath` for those is explicitly out of scope, so
 * `RewrittenSessionRecord` below makes `corpusPath` optional rather than widening `SessionRecord`
 * itself, which every other reader and writer in this tree still treats as required (the recorder
 * always has the path it just wrote; only this one-time backfill can come up empty).
 *
 * Never run against the real Knowledge-Base checkout or the real `origin` from a test — `git` and
 * `corpusDir` are both threaded in by the caller for exactly that reason.
 */

const NOTES_REF = "sessions";

/** Where a session's capture file lives under a Knowledge-Base checkout root (ADR-0020). */
const CORPUS_SESSIONS_SUBDIR = join("raw", "sessions");

/**
 * The wire shape every note on `refs/notes/sessions` carried before #134: what `SessionRecord`
 * describes today, minus `corpusPath`, plus the `spine` field #134 removes. Parsing each note
 * against this first means a note that is already in the new shape (a second run of this script,
 * or a note this migration already rewrote) fails loudly instead of quietly losing its
 * `corpusPath`.
 */
export const LegacySessionRecord = z.object({
  sessionId: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
  touchedPaths: z.array(z.string().min(1)),
  spine: z.string(),
});
export type LegacySessionRecord = z.infer<typeof LegacySessionRecord>;

/**
 * The one builder for a `LegacySessionRecord` fixture — see CODING_STANDARDS.md, "A test builds a
 * schema-typed fixture through one exported builder". `head` has no default for the same reason
 * `session-record.fixture.ts`'s own `sessionRecord` gives: a real test keys a written note to an
 * actual commit SHA from its own fixture repo.
 */
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

/**
 * `SessionRecord` with `corpusPath` optional — see the module header for why this migration, and
 * only this migration, needs a record shape `SessionRecord` itself does not allow.
 */
export const RewrittenSessionRecord = SessionRecord.partial({ corpusPath: true });
export type RewrittenSessionRecord = z.infer<typeof RewrittenSessionRecord>;

/**
 * The path `sessionId`'s capture file would sit at under `corpusDir`, repo-relative to
 * `corpusDir` itself — or `undefined` when the corpus never captured this session, or when
 * `corpusDir` holds no `raw/sessions` directory at all (indistinguishable from "nothing captured"
 * from here, and both mean the same thing to a caller: no pointer to write).
 *
 * Matches a file by its `-<sessionId[:8]>.md` suffix, the same convention
 * `capture/backfill.ts`'s own `sessionSuffixesOf` and the live recorder
 * (`.claude/hooks/session-capture.test.ts`'s `corpusPath` assertion) already write capture files
 * by — not re-derived here, since the writer's own filename is exactly what a reader has to match
 * against, never a second, independently-invented convention.
 */
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
  /** The repo whose `refs/notes/sessions` this rewrites, threaded as `-C <repoDir>`. */
  repoDir: string;
  /** The Knowledge-Base checkout a session's `corpusPath` is backfilled against. */
  corpusDir: string;
  /**
   * Where the rewritten ref is force-pushed. Always supplied by the caller, never defaulted to
   * `"origin"` the way `notes-sync.ts`'s `syncNotesRef` does — a one-time history rewrite is exactly
   * the kind of call a default makes too easy to point at the wrong place by omission.
   */
  remote: string;
}

/** One rewritten note, keyed to the commit it was published against. */
export interface RewrittenSession {
  commit: string;
  record: RewrittenSessionRecord;
}

/**
 * Rewrites every note on `options.repoDir`'s `refs/notes/sessions` from the pre-#134 shape to the
 * current `SessionRecord` schema, then force-pushes the rewritten ref to `options.remote`.
 *
 * Enumerates every noted commit with `git notes --ref=sessions list` rather than walking
 * `git log` from a chosen head (`notes-store.ts`'s `readNoteArray` does the latter): a one-time
 * backfill over already-published notes has no natural "head" to walk from, and a note keyed to a
 * commit outside whatever branch happens to be checked out must still be rewritten.
 *
 * Each note's one-element array is parsed against `LegacySessionRecord` — a note already in the
 * new shape throws rather than being silently accepted, since running this twice over the same ref
 * would otherwise drop a `corpusPath` the first pass already backfilled (there is no `spine` left
 * for the second pass to find `corpusPath` reachable from).
 */
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

// --- CLI -------------------------------------------------------------------------------------
//
// `node rewrite-session-notes-schema.ts <repoDir> <corpusDir> <remote>` runs the rewrite above and
// force-pushes to `<remote>`. Exits 2 on a usage error; re-throws (and so exits non-zero with a
// stack trace) anything else, since nothing past this file knows how to recover a partial rewrite.
//
// Guarded with `pathToFileURL(process.argv[1])`, never a hand-built `file://${argv[1]}` — see
// WORKER-PROMPT.md #139 and scrub-corpus-history.ts's own guard, which this one copies: a raw
// template loses percent-encoding on a path with a space, which is this repo's own real checkout
// path, and would make this guard silently never fire there.
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
