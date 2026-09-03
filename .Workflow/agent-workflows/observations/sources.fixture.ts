import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @fixture Reached only from the suite, by design.
 */

export const OBSERVATIONS_DIR = dirname(fileURLToPath(import.meta.url));

export const LANES_DIR = dirname(OBSERVATIONS_DIR);

export interface SourceFile {
  path: string;
  text: string;
}

export function readTsSources(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...readTsSources(full));
    } else if (entry.endsWith(".ts")) {
      out.push({ path: full, text: readFileSync(full, "utf8") });
    }
  }
  return out;
}
