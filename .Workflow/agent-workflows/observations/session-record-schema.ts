import { z } from "zod";

/**
 * One session's own facts, as capture derives them and the audit reads them
 * back (spec #63 §Solution 1, "Capture stamps the range and publishes a
 * session record"): the commit range the session made, the paths it
 * touched, and a pointer to its captured conversation spine. Written as a
 * single-element git note on `refs/notes/sessions`, keyed to `head` — a
 * third kind of fact alongside `Observation` (./observation-schema.ts) and
 * `RatificationRecord` (./ratification-schema.ts), each on its own ref
 * (ADR-0016) because each has a different lifetime. A session record is
 * written once, at the end of the session it describes, and never revised.
 *
 * The spine itself does not travel on this wire (spec #134, "the public
 * repository carries the argument, the private repository carries the
 * evidence"): `refs/notes/sessions` is pushed to the public `origin`, and a
 * verbatim conversation spine has no business there. `corpusPath` is what a
 * reader hydrates the spine from instead — see `session-notes.ts`'s
 * `readSessionRecord`, the one seam that turns this pointer back into text.
 */
export const SessionRecord = z.object({
  /** The session's own id — the transcript's own identity, unrelated to any commit. */
  sessionId: z.string().min(1),
  /** The commit the session's own range starts after (exclusive) — `sessionRangeDiff`'s `base`. */
  base: z.string().min(1),
  /** The last commit in the session's own range — also this note's key. */
  head: z.string().min(1),
  /**
   * Paths the session edited or wrote, not read — spec #63 §Implementation
   * Decisions, "`touchedPaths` is the edited and written files only", since
   * spine extraction already keeps the three apart (`ParsedSpine.filesRead`
   * is dropped here on purpose).
   */
  touchedPaths: z.array(z.string().min(1)),
  /**
   * The capture file holding this session's spine, relative to the
   * Knowledge-Base repository root the recorder just wrote it under (e.g.
   * `raw/sessions/2026-08-26-0c0cf08a.md`, ADR-0020) — the path the recorder
   * already has at write time, not one a reader re-derives by globbing.
   */
  corpusPath: z.string().min(1),
});

export type SessionRecord = z.infer<typeof SessionRecord>;
