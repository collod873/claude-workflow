/**
 * Re-exports `shared/session-record-schema.ts`. The type moved there in #305: `shared` needs it
 * (`shared/rewrite-session-notes-schema.ts` reads a session's own wire shape to rewrite it) and a
 * lane isn't allowed to be `shared`'s door, so the schema now lives on the side that both `shared`
 * and this lane may import. This file exists only so `observations/`'s own imports (`./session-record-schema`)
 * don't all have to be rewritten to `../shared/session-record-schema` — delete it once nothing
 * still spells the old path.
 */
export { SessionRecord } from "../shared/session-record-schema.ts";
