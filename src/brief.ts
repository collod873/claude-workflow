import { existsSync, readFileSync } from "node:fs";

export const onDisk = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

export function capped(text: string, limit: number): string {
  if (Buffer.byteLength(text) <= limit) return text;
  let kept = "";
  for (const char of text) {
    if (Buffer.byteLength(kept) + Buffer.byteLength(char) > limit) break;
    kept += char;
  }
  return kept;
}

export const DIFF_CAP = 32 * 1024;
export const TICKET_CAP = 8 * 1024;
export const LIST_CAP = 4 * 1024;
export const NO_EM_DASH = "^[^\\u2014]*$";

const FILE_START = /^(?=diff --git )/m;
const CHANGED_PATH = /^diff --git a\/.+? b\/(.+)$/m;
const changedPaths = (diff: string): string[] => diff.split(FILE_START).flatMap((text) => CHANGED_PATH.exec(text)?.slice(1) ?? []);

export function handedDiff(diff: string): string {
  const bytes = Buffer.byteLength(diff);
  if (bytes <= DIFF_CAP) return diff;
  return [
    `The diff is ${bytes} bytes, over ${DIFF_CAP}, so it is cut here; read any changed file in the repo.`,
    capped(diff, DIFF_CAP),
    "Every file changed:",
    capped(changedPaths(diff).map((path) => `- ${path}`).join("\n"), LIST_CAP),
  ].join("\n\n");
}
