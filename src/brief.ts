import { existsSync, readFileSync } from "node:fs";

export const onDisk = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

const cutTo = (text: string, limit: number): string => Buffer.from(text).subarray(0, limit).toString("utf8").replace(/\uFFFD+$/, "");

export const cutMark = (limit: number) => `[cut here, at its cap of ${limit} bytes]`;

export function capped(text: string, limit: number): string {
  if (Buffer.byteLength(text) <= limit) return text;
  const cut = `\n\n${cutMark(limit)}`;
  const room = limit - Buffer.byteLength(cut);
  return room < 0 ? cutTo(text, limit) : `${cutTo(text, room)}${cut}`;
}

export function tailOf(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  return bytes.length <= limit ? text : bytes.subarray(bytes.length - limit).toString("utf8").replace(/^\uFFFD+/, "");
}

export const DIFF_CAP = 32 * 1024;
export const TICKET_CAP = 8 * 1024;
export const LIST_CAP = 4 * 1024;
export const TAIL_CAP = 8 * 1024;
export const NO_EM_DASH = "^[^\\u2014]*$";

const FILE_START = /^(?=diff --git )/m;
const CHANGED_PATH = /^diff --git a\/.+? b\/(.+)$/m;
const changedPaths = (diff: string): string[] => [...new Set(diff.split(FILE_START).flatMap((text) => CHANGED_PATH.exec(text)?.slice(1) ?? []))];

export function diffOverCap(diff: string, stat: string): { bytes: number; stat: string; files: string } | undefined {
  const bytes = Buffer.byteLength(diff);
  if (bytes <= DIFF_CAP) return undefined;
  return { bytes, stat: capped(stat, LIST_CAP), files: capped(changedPaths(diff).map((path) => `- ${path}`).join("\n"), LIST_CAP) };
}
