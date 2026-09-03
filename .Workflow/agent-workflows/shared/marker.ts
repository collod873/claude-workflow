import { z } from "zod";
import { Sheet } from "./sheet-schema";

/**
 * The machine-readable trailer every comment this lane posts carries.
 *
 * §01 forbids editing a sheet in place — *a re-run posts a new comment, the
 * latest is live* — because ADR-0006 stakes a prediction on this lane that is
 * only computable if the earlier rounds survive to be compared against what
 * the owner actually did. That makes the issue's comment list this lane's
 * whole memory, and it is read by three separate things: the round counter,
 * the accept, and the refuter's probation count. Each of them would otherwise
 * be parsing rendered markdown to recover what the shaper already knew.
 *
 * So the sheet travels twice in one comment: once as prose the owner reads,
 * and once as JSON in an HTML comment nobody sees. Nothing re-derives a sheet
 * from its own rendering.
 *
 * **On the escaping.** An HTML comment ends at the first `-->`, and a
 * shaper's prose is free to contain one. Every `>` in a JSON document is
 * inside a string — the structural characters are `{}[]:,"` and nothing else
 * — so escaping them all as `>` after `JSON.stringify` cannot corrupt
 * the document, and `JSON.parse` puts them back. That is why this does not
 * base64 the payload: the marker stays readable in the GitHub UI's source,
 * which is where anyone debugging this lane will be looking.
 */

const SHEET_OPEN = "<!-- decision-sheet:v1 ";
const SHEET_CLOSE = " -->";

/**
 * The trailer a refusal comment carries. It holds no payload — the only
 * question anything asks of it is *did this lane already speak on this
 * issue*, which `rounds.ts` needs so a refused idea's clearing comment is
 * counted as a round rather than as the first one.
 */
export const REFUSAL_MARKER = "<!-- shape-refused:v1 -->";

/**
 * The trailer an accept's comment carries, which is what makes `approved`
 * idempotent — and, since ADR-0058, what carries the payload lane 02's sheet
 * collector reads.
 *
 * A label can be removed and re-applied, and each application is a fresh
 * `issues.labeled` event — so without this, a second `approved` files every
 * ruling on the sheet a second time, under new ADR numbers, and pushes them.
 * The check cannot key off the `idea` label instead: `parked` and `killed`
 * drop that too, and an owner who parks an idea and then changes his mind
 * should get an accept rather than silence.
 *
 * **Why a payload.** §01 requires lane 02 to *cite* the rulings an accept
 * filed rather than restate them, and the ADR numbers `bin/new-adr` assigns
 * are decided at accept time — they appear nowhere on the sheet itself.
 * Without a payload here, the sheet collector would have to parse the accept
 * comment's rendered markdown for those paths, which is the exact failure
 * this file exists to prevent, arriving one comment later (ADR-0058).
 * `ACCEPTED_MARKER` stays exported as the substring both the old bare form
 * and the payload-carrying form share, so `isAccepted` keeps recognising
 * either.
 */
export const ACCEPTED_MARKER = "<!-- shape-accepted:v1";
const ACCEPTED_OPEN = `${ACCEPTED_MARKER} `;
const ACCEPTED_CLOSE = " -->";

/** The payload `ACCEPTED_MARKER` carries: what `accept.ts` filed, and where. */
export const AcceptedPayload = z.object({
  /** The landed paths of every ADR this accept filed. */
  adrPaths: z.array(z.string()),
  /** The terms this accept coined into `CONTEXT.md`. */
  coinedTerms: z.array(z.string()),
  /** The route this accept recorded — the sheet's, unless overridden. */
  route: z.enum(["short", "long"]),
});

export type AcceptedPayload = z.infer<typeof AcceptedPayload>;

/** The sheet's trailer, for the end of the comment body. */
export function sheetMarker(sheet: Sheet): string {
  return `${SHEET_OPEN}${JSON.stringify(sheet).replaceAll(">", "\\u003e")}${SHEET_CLOSE}`;
}

/** The accept's trailer, mirroring `sheetMarker`'s escaping (see `marker.ts`'s header comment). */
export function acceptedMarker(payload: AcceptedPayload): string {
  return `${ACCEPTED_OPEN}${JSON.stringify(payload).replaceAll(">", "\\u003e")}${ACCEPTED_CLOSE}`;
}

/**
 * The accept payload carried by one comment body, or `undefined` when that
 * comment carries no payload — including a comment carrying the old bare
 * `ACCEPTED_MARKER`, which is unreadable rather than absent, and reads the
 * same way as a comment that isn't an accept at all: as nothing to fall back
 * to prose for (ADR-0058).
 */
export function readAcceptedMarker(body: string): AcceptedPayload | undefined {
  const open = body.lastIndexOf(ACCEPTED_OPEN);
  if (open === -1) return undefined;

  const close = body.indexOf(ACCEPTED_CLOSE, open + ACCEPTED_OPEN.length);
  if (close === -1) return undefined;

  const json = body.slice(open + ACCEPTED_OPEN.length, close);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  const result = AcceptedPayload.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/**
 * The sheet carried by one comment body, or `undefined` when that comment is
 * not a sheet.
 *
 * A marker that is present but unreadable returns `undefined` too, rather
 * than throwing. This is read across every comment on an issue, most of which
 * are prose; a single malformed trailer — from a hand-edited comment, or a
 * version of this file that no longer exists — must not take out the round
 * count and strand the issue. What it costs is that such a sheet stops being
 * counted, which is visible on the issue itself.
 */
export function readSheetMarker(body: string): Sheet | undefined {
  const open = body.lastIndexOf(SHEET_OPEN);
  if (open === -1) return undefined;

  const close = body.indexOf(SHEET_CLOSE, open + SHEET_OPEN.length);
  if (close === -1) return undefined;

  const json = body.slice(open + SHEET_OPEN.length, close);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  const result = Sheet.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** Whether one comment body is this lane's refusal. */
export function isRefusal(body: string): boolean {
  return body.includes(REFUSAL_MARKER);
}

/** Whether one comment body is this lane's accept. */
export function isAccepted(body: string): boolean {
  return body.includes(ACCEPTED_MARKER);
}
