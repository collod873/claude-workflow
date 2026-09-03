import { z } from "zod";
import { Sheet } from "./sheet-schema";

const SHEET_OPEN = "<!-- decision-sheet:v1 ";
const SHEET_CLOSE = " -->";

export const REFUSAL_MARKER = "<!-- shape-refused:v1 -->";

export const ACCEPTED_MARKER = "<!-- shape-accepted:v1";
const ACCEPTED_OPEN = `${ACCEPTED_MARKER} `;
const ACCEPTED_CLOSE = " -->";

export const AcceptedPayload = z.object({
  adrPaths: z.array(z.string()),
  coinedTerms: z.array(z.string()),
  route: z.enum(["short", "long"]),
});

export type AcceptedPayload = z.infer<typeof AcceptedPayload>;

export function sheetMarker(sheet: Sheet): string {
  return `${SHEET_OPEN}${JSON.stringify(sheet).replaceAll(">", "\\u003e")}${SHEET_CLOSE}`;
}

export function acceptedMarker(payload: AcceptedPayload): string {
  return `${ACCEPTED_OPEN}${JSON.stringify(payload).replaceAll(">", "\\u003e")}${ACCEPTED_CLOSE}`;
}

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

export function isRefusal(body: string): boolean {
  return body.includes(REFUSAL_MARKER);
}

export function isAccepted(body: string): boolean {
  return body.includes(ACCEPTED_MARKER);
}
