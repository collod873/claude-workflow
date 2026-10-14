import { text } from "node:stream/consumers";

export const dedashed = (written: string): string =>
  written
    .replaceAll(/(?<=\d)\u2014(?=\d)/g, "-")
    .replaceAll(/(?<=\w)[ \t]*\u2014[ \t]*(?=\w)/g, ", ")
    .replaceAll("\u2014", "-");

function emDashLines(written: string): number[] {
  return written.split("\n").flatMap((line, index) => (line.includes("\u2014") ? [index + 1] : []));
}

if (import.meta.main) process.exit(emDashLines(await text(process.stdin)).length > 0 ? 1 : 0);
