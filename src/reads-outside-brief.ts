import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const STAGES = ["test-author", "build"];
const CARRIED = /^### (.+)$/gm;
const METER_LINE = /read (\d+) files? outside its brief/g;

interface Meter {
  stage: string;
  outside: string[];
}

function carriedPaths(brief: string): Set<string> {
  return new Set([...brief.matchAll(CARRIED)].map(([, path]) => path.trim()));
}

function readPaths(stream: string, top: string): string[] {
  const paths: string[] = [];
  for (const line of stream.split("\n")) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = (event as { message?: { content?: unknown[] } })?.message?.content;
    for (const block of content ?? []) {
      const { type, name, input } = (block ?? {}) as { type?: string; name?: string; input?: { file_path?: unknown } };
      const path = input?.file_path;
      if (type === "tool_use" && name === "Read" && typeof path === "string") paths.push(relative(top, path));
    }
  }
  return paths;
}

function metered(logs: string, top: string, ticket: string): Meter[] {
  const briefPath = join(logs, `brief-${ticket}.md`);
  const carried = carriedPaths(existsSync(briefPath) ? readFileSync(briefPath, "utf8") : "");
  return STAGES.map((stage) => {
    const streamPath = join(logs, `${stage}-${ticket}.jsonl`);
    const stream = existsSync(streamPath) ? readFileSync(streamPath, "utf8") : "";
    const outside = [...new Set(readPaths(stream, top))].filter((path) => !carried.has(path));
    return { stage, outside };
  });
}

function report(meters: Meter[]): string {
  return meters
    .map(({ stage, outside }) => {
      const files = outside.length === 1 ? "file" : "files";
      const named = outside.length === 0 ? "" : `: ${outside.join(", ")}`;
      return `${stage} read ${outside.length} ${files} outside its brief${named}`;
    })
    .join("\n");
}

export function totalOutside(text: string): number | undefined {
  const counts = [...text.matchAll(METER_LINE)].map(([, count]) => Number(count));
  return counts.length === 0 ? undefined : counts.reduce((sum, count) => sum + count, 0);
}

const HAND_BACK_THRESHOLD = 5;

function insideRepo(path: string): boolean {
  return path !== ".git" && !path.startsWith(".git/") && !path.startsWith("..");
}

function handBackLine(meters: Meter[]): string {
  const files = new Set<string>();
  for (const { outside } of meters) for (const path of outside) if (insideRepo(path)) files.add(path);
  if (files.size < HAND_BACK_THRESHOLD) return "reads back to the filer (meter): nothing to hand back";
  const word = files.size === 1 ? "file" : "files";
  return `reads back to the filer (meter): ${files.size} ${word} missing from the brief: ${[...files].sort().join(", ")}`;
}

if (import.meta.main) {
  const [logs, top, ticket] = process.argv.slice(2);
  const meters = metered(logs, top, ticket);
  process.stdout.write(`${report(meters)}\n${handBackLine(meters)}\n`);
}
