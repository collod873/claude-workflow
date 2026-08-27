import type { SessionRecord } from "./session-record-schema";

/**
 * The one builder for a `SessionRecord` fixture. Everything but `head` is
 * derived from it, so a test names only the field it is actually about —
 * see CODING_STANDARDS.md, "A test builds a schema-typed fixture through one
 * exported builder". `head` has no sensible default because every real test
 * keys a write/read pair to an actual commit SHA from its own fixture repo.
 */
export function sessionRecord(overrides: Partial<SessionRecord> & { head: string }): SessionRecord {
  return {
    sessionId: "session-123",
    base: "0000000000000000000000000000000000000000",
    touchedPaths: ["a.ts"],
    corpusPath: "raw/sessions/2026-08-26-session-123.md",
    ...overrides,
  };
}
