import { text } from "node:stream/consumers";

export function emDashLines(written: string): number[] {
  return written.split("\n").flatMap((line, index) => (line.includes("\u2014") ? [index + 1] : []));
}

if (import.meta.main) process.exit(emDashLines(await text(process.stdin)).length > 0 ? 1 : 0);
