import type { SessionRecord } from "./session-record-schema";

export function sessionRecord(overrides: Partial<SessionRecord> & { head: string }): SessionRecord {
  return {
    sessionId: "session-123",
    base: "0000000000000000000000000000000000000000",
    touchedPaths: ["a.ts"],
    corpusPath: "raw/sessions/2026-08-26-session-123.md",
    ...overrides,
  };
}
