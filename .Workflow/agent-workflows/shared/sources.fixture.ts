import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * This repository's own TypeScript, read as text, for the one suite that sweeps source rather
 * than importing it: `exec-seams.test.ts` holds every spawning module to a `maxBuffer` and every
 * spawning test to a `TARGET_WORKSPACE`, and a sweep has to read the files it does not know the
 * names of yet. That read lives here so no `*.test.ts` walks the repository itself.
 *
 * @fixture Reached only from the suite, by design.
 */

const SHARED_DIR = import.meta.dirname;
const WORKFLOW_ROOT = resolve(SHARED_DIR, "../..");

export interface SourceFile {
  /** The path, relative to `.Workflow/` for a test and bare for a shared module. */
  name: string;
  source: string;
}

/** Every module in `shared/` that is neither a test nor a fake — the seams and their fixtures. */
export function sharedModules(): SourceFile[] {
  return readdirSync(SHARED_DIR)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test.") && !name.includes(".fake."))
    .map((name) => ({ name, source: readFileSync(join(SHARED_DIR, name), "utf8") }));
}

function testFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testFilesUnder(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Every `*.test.ts` under `agent-workflows/`, named relative to `.Workflow/`. */
export function agentWorkflowTests(): SourceFile[] {
  return testFilesUnder(join(WORKFLOW_ROOT, "agent-workflows")).map((path) => ({
    name: path.slice(WORKFLOW_ROOT.length + 1),
    source: readFileSync(path, "utf8"),
  }));
}
