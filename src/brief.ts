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
