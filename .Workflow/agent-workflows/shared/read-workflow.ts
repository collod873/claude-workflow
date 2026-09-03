import { readdirSync, readFileSync } from "node:fs";
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
 *
 * The directory listing lives here too, for the same reason: a test may not `readdirSync` a
 * repo-rooted path itself (#360, rule 3), so the one walk over `.github/workflows` is this module's.
 */

/** Repo root, resolved from this module's own location rather than the caller's. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where every workflow file in this repo lives. */
export const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

/** The suffix that makes a workflow file a caller stub — `enrol/stub-set.ts`'s own convention. */
export const STUB_SUFFIX = "-caller.yml";

/** One workflow file, read once: its resolved path, its raw source, and its parsed YAML. */
export interface ParsedWorkflow<T = unknown> {
  path: string;
  source: string;
  workflow: T;
}

/** A workflow file listed by a directory walk: `ParsedWorkflow` plus the file name it was found under. */
export interface NamedWorkflow<T = unknown> extends ParsedWorkflow<T> {
  name: string;
}

const isWorkflowFile = (name: string) => name.endsWith(".yml") || name.endsWith(".yaml");

/** Every workflow file name in `dir` — this repo's `.github/workflows` unless a fixture tree's is passed. */
export function workflowNames(dir = WORKFLOWS_DIR): string[] {
  return readdirSync(dir).filter(isWorkflowFile);
}

/**
 * Reads and parses one workflow file by name (e.g. `"verify.yml"`), relative to
 * `.github/workflows/`. `T` is left to the caller to shape — this reads the YAML, not any one
 * workflow's schema.
 */
export function readWorkflow<T = unknown>(name: string, dir = WORKFLOWS_DIR): ParsedWorkflow<T> {
  const path = join(dir, name);
  const source = readFileSync(path, "utf8");
  return { path, source, workflow: parse(source) as T };
}

/** Every workflow file in `dir`, read and parsed — the estate a sweep iterates over. */
export function readWorkflows<T = unknown>(dir = WORKFLOWS_DIR): NamedWorkflow<T>[] {
  return workflowNames(dir).map((name) => ({ name, ...readWorkflow<T>(name, dir) }));
}

/** The lane ids the stub set derives: one per `*-caller.yml`, which is how `bin/canary` and `enrol.ts` count lanes too. */
export function laneIds(): string[] {
  return workflowNames()
    .filter((name) => name.endsWith(STUB_SUFFIX))
    .map((name) => name.slice(0, -STUB_SUFFIX.length));
}
