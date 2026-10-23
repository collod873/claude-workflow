import { existsSync, readFileSync } from "node:fs";

export const onDisk = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

function cutTo(text: string, limit: number): string {
  let kept = "";
  for (const char of text) {
    if (Buffer.byteLength(kept) + Buffer.byteLength(char) > limit) break;
    kept += char;
  }
  return kept;
}

export function capped(text: string, limit: number): string {
  if (Buffer.byteLength(text) <= limit) return text;
  const cut = `\n\n[cut here, at its cap of ${limit} bytes]`;
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
const changedPaths = (diff: string): string[] => diff.split(FILE_START).flatMap((text) => CHANGED_PATH.exec(text)?.slice(1) ?? []);

export function handedDiff(diff: string, stat: string): string {
  const bytes = Buffer.byteLength(diff);
  if (bytes <= DIFF_CAP) return diff;
  return [
    `The diff is ${bytes} bytes, over ${DIFF_CAP}, so only its \`git diff --stat\` and its files are handed; read in the repo what you need of it.`,
    capped(stat, LIST_CAP),
    "Every file changed:",
    capped(changedPaths(diff).map((path) => `- ${path}`).join("\n"), LIST_CAP),
  ].join("\n\n");
}

export const sameFiles = (alongside: string | undefined) =>
  alongside === undefined || alongside === "" ? [] : ["## Open tickets on the same files", "Each names a file this ticket names, and may already ask for part of its fix:", capped(alongside, LIST_CAP)];
