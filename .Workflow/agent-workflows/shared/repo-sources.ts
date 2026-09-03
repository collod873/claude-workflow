import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { WORKFLOWS_DIR } from "./read-workflow";

/**
 * The one home for a test's read of this repository's own source files.
 *
 * Several estate-wide sweeps (`lane-invariants`, `lane-identity`, `runner-committer`,
 * `workflow-permissions`) derive their rule from what the lanes *do* — which entrypoint a workflow
 * runs, what that entrypoint reaches, which wire names a module declares — and each one used to
 * carry its own walk over `.Workflow/agent-workflows` and `bin/`. A `*.test.ts` may no longer
 * `readFileSync` a repo-rooted path itself (#360, rule 3): the walk and the read live here, once,
 * and a sweep asks for the files it wants by what they are rather than by where they sit.
 *
 * @fixture Reached only from the suites, by design — no lane reads its own source tree.
 */

/** Repo root, derived from `WORKFLOWS_DIR` so read-workflow.ts's resolution is the only one. */
export const REPO_ROOT = resolve(WORKFLOWS_DIR, "../..");

const AGENT_WORKFLOWS_DIR = join(REPO_ROOT, ".Workflow/agent-workflows");
const BIN_DIR = join(REPO_ROOT, "bin");
const HOOKS_DIR = join(REPO_ROOT, ".claude/hooks");

/** One file under the repo: its absolute path, its repo-relative path, and its text. */
export interface RepoFile {
  path: string;
  relative: string;
  source: string;
}

/** A directory a walk skips outright — build output, dependencies, or a fixture tree carrying its own unrelated `.github/workflows`. */
function skipDir(name: string): boolean {
  return name === "node_modules" || name === "__pycache__" || name.endsWith(".fixtures") || name === ".git";
}

/** Every regular file under `dir`, recursively, skipping the directories `skipDir` names. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!skipDir(entry)) out.push(...walk(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

const walked = new Map<string, RepoFile[]>();

/** Every file under `dir`, read once per process — a sweep re-asking costs nothing. */
function filesUnder(dir: string): RepoFile[] {
  let files = walked.get(dir);
  if (files === undefined) {
    files = walk(dir).map((path) => ({ path, relative: relative(REPO_ROOT, path), source: readFileSync(path, "utf8") }));
    walked.set(dir, files);
  }
  return files;
}

const isTest = (file: RepoFile) => file.path.endsWith(".test.ts");

/** Every non-test file under `.Workflow/agent-workflows` — a lane's code, prompts and fixtures, never its suites. */
export function laneSources(): RepoFile[] {
  return filesUnder(AGENT_WORKFLOWS_DIR).filter((file) => !isTest(file));
}

/** Everything under `bin/` — the scripts a human or the gauntlet runs by hand. */
export function binSources(): RepoFile[] {
  return filesUnder(BIN_DIR);
}

/** Every non-test file under `.claude/hooks` — what fires inside a session. */
export function hookSources(): RepoFile[] {
  return filesUnder(HOOKS_DIR).filter((file) => !isTest(file));
}

/** The text of one file by absolute path — for a walk that follows imports out from an entrypoint. */
export function readRepoText(path: string): string {
  return readFileSync(path, "utf8");
}

/** Whether a repo-relative path names a file that exists. */
export function repoFileExists(relativePath: string): boolean {
  return existsSync(join(REPO_ROOT, relativePath));
}

/** Every TypeScript entrypoint a workflow hands to `npx tsx`, repo-relative as the workflow spells it. */
export function entrypointsOf(workflowSource: string): string[] {
  return [...workflowSource.matchAll(/npx tsx (\S+\.ts)\b/g)].map((match) => match[1]);
}

/** Every `process.env.NAME` the entrypoint file at `relativePath` itself reads — its own contract with the workflow that runs it. */
export function envReadsOf(relativePath: string): string[] {
  const source = readRepoText(join(REPO_ROOT, relativePath));
  return [...new Set([...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]))];
}
