import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { claims } from "./ticket-shape.ts";

export const CAP = 64 * 1024;

export const onDisk = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

const AUTHORED = /\.test\.(m|c)?[jt]s$/;

type Read = (path: string) => string | undefined;

interface Asked {
  ticket: string;
  body: string;
  tests: string[];
  read: Read;
}

function importedBy(path: string, text: string): string[] {
  const found = ts.preProcessFile(text, true, true).importedFiles.map(({ fileName }) => fileName);
  return found.filter((target) => target.startsWith(".")).map((target) => normalize(join(dirname(path), target)));
}

function firstSight(paths: string[], seen: Set<string>): string[] {
  const fresh: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    fresh.push(path);
  }
  return fresh;
}

function numbered(text: string): string {
  const lines = text.replace(/\n+$/, "").split("\n");
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width)}  ${line}`).join("\n");
}

function inlined(paths: string[], read: Read): string {
  if (paths.length === 0) return "(none)";
  return paths
    .map((path) => {
      const text = read(path);
      return `### ${path}\n\n${text === undefined ? "(not written yet)" : numbered(text)}`;
    })
    .join("\n\n");
}

function filled(paths: string[], read: Read): string[] {
  return paths
    .map((path) => ({ path, bytes: Buffer.byteLength(read(path) ?? "") }))
    .sort((one, other) => other.bytes - one.bytes)
    .map(({ path, bytes }) => `${path} inlines ${bytes} bytes`);
}

export function brief({ ticket, body, tests, read }: Asked): { text: string; refusals: string[] } {
  const seen = new Set<string>();
  const authored = firstSight(tests, seen);
  const claimed = firstSight(claims(body), seen);
  const widened = firstSight(
    [...authored, ...claimed].flatMap((path) => importedBy(path, read(path) ?? "")).filter((path) => read(path) !== undefined),
    seen,
  );
  const text = [
    `# Brief for ticket ${ticket}`,
    "## The ticket",
    body.trim(),
    "## The acceptance test",
    inlined(authored, read),
    "## Files claimed, as they stand",
    inlined(claimed, read),
    "## What the claim imports",
    inlined(widened, read),
    "",
  ].join("\n\n");
  const bytes = Buffer.byteLength(text);
  if (bytes <= CAP) return { text, refusals: [] };
  return {
    text: "",
    refusals: [`the brief for ticket ${ticket} is ${bytes} bytes, over ${CAP}`, ...filled([...authored, ...claimed, ...widened], read)],
  };
}

function authoredTests(): string[] {
  const changed = spawnSync("git", ["diff", "--name-only", "origin/main...HEAD"], { encoding: "utf8" });
  return changed.status === 0 ? changed.stdout.split("\n").filter((path) => AUTHORED.test(path)) : [];
}

if (import.meta.main) {
  const ticket = process.argv[2];
  const asked = spawnSync("gh", ["issue", "view", ticket, "--json", "body", "--jq", ".body"], { encoding: "utf8" });
  const { text, refusals } =
    asked.status === 0
      ? brief({
          ticket,
          body: asked.stdout,
          tests: authoredTests(),
          read: onDisk,
        })
      : { text: "", refusals: [`ticket ${ticket} could not be read, so nothing was briefed`] };
  for (const refusal of refusals) console.error(refusal);
  if (text !== "") process.stdout.write(text);
  process.exit(refusals.length > 0 ? 1 : 0);
}
