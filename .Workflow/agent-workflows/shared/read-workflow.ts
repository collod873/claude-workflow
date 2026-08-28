import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * The three-step read every test that inspects a workflow file was repeating on its own:
 * `readFileSync` the YAML off disk, `yaml.parse` it into a plain object, and resolve the path
 * with `fileURLToPath` rather than a hand-built `file://` template — the same landmine
 * `WORKER-PROMPT.md` names for an entrypoint guard (#139), which a workflow test resolving its own
 * module URL sits exactly as close to. One helper, so a workflow file that moves relative to
 * `.github/workflows/` moves for every reader at once rather than for however many of them someone
 * remembered to fix.
 */

/** Repo root, resolved from this module's own location rather than the caller's. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where every workflow file in this repo lives. */
export const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

/** One workflow file, read once: its resolved path, its raw source, and its parsed YAML. */
export interface ParsedWorkflow<T = unknown> {
  path: string;
  source: string;
  workflow: T;
}

/**
 * Reads and parses one workflow file by name (e.g. `"verify.yml"`), relative to
 * `.github/workflows/`. `T` is left to the caller to shape — this reads the YAML, not any one
 * workflow's schema.
 */
export function readWorkflow<T = unknown>(name: string): ParsedWorkflow<T> {
  const path = join(WORKFLOWS_DIR, name);
  const source = readFileSync(path, "utf8");
  return { path, source, workflow: parse(source) as T };
}
