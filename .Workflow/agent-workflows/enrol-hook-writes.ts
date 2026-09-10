import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENROL_DIR = join(dirname(fileURLToPath(import.meta.url)), "enrol");

const HOOK_FILE = /_hook\.(mjs|sh)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

export function hookFilesTheEnrolLaneWritesIntoATarget(): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(ENROL_DIR)) {
    for (const match of readFileSync(file, "utf8").matchAll(HOOK_FILE)) names.add(match[0]);
  }
  return [...names].sort();
}
