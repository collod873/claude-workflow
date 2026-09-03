import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The file walk `wired.test.ts`'s export sweep runs over: every `.ts` under the lanes directory,
 * read as text, so the test itself parses ASTs and never touches the filesystem. One place owns
 * the repo-rooted read, the same way `shared/read-workflow.ts` owns the workflow directory's.
 *
 * @fixture Reached only from the suite, by design.
 */

/** This lane's own directory. */
export const OBSERVATIONS_DIR = dirname(fileURLToPath(import.meta.url));

/** Every lane, because a caller of an observations export may live in any of them. */
export const LANES_DIR = dirname(OBSERVATIONS_DIR);

export interface SourceFile {
  path: string;
  text: string;
}

/** Every `.ts` file under `dir`, recursively, with its contents. */
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
