import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { WORKFLOWS_DIR } from "./read-workflow";

/**
 * @fixture Reached only from the suites, by design — no lane reads its own source tree.
 */

export const REPO_ROOT = resolve(WORKFLOWS_DIR, "../..");

const AGENT_WORKFLOWS_DIR = join(REPO_ROOT, ".Workflow/agent-workflows");
const BIN_DIR = join(REPO_ROOT, "bin");
const HOOKS_DIR = join(REPO_ROOT, ".claude/hooks");

export interface RepoFile {
  path: string;
  relative: string;
  source: string;
}

function skipDir(name: string): boolean {
  return name === "node_modules" || name === "__pycache__" || name.endsWith(".fixtures") || name === ".git";
}

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

function filesUnder(dir: string): RepoFile[] {
  let files = walked.get(dir);
  if (files === undefined) {
    files = walk(dir).map((path) => ({ path, relative: relative(REPO_ROOT, path), source: readFileSync(path, "utf8") }));
    walked.set(dir, files);
  }
  return files;
}

const isTest = (file: RepoFile) => file.path.endsWith(".test.ts");

export function laneSources(): RepoFile[] {
  return filesUnder(AGENT_WORKFLOWS_DIR).filter((file) => !isTest(file));
}

export function binSources(): RepoFile[] {
  return filesUnder(BIN_DIR);
}

export function hookSources(): RepoFile[] {
  return filesUnder(HOOKS_DIR).filter((file) => !isTest(file));
}

export function readRepoText(path: string): string {
  return readFileSync(path, "utf8");
}

export function repoFileExists(relativePath: string): boolean {
  return existsSync(join(REPO_ROOT, relativePath));
}

export function entrypointsOf(workflowSource: string): string[] {
  return [...workflowSource.matchAll(/npx tsx (\S+\.ts)\b/g)].map((match) => match[1]);
}

export function envReadsOf(relativePath: string): string[] {
  const source = readRepoText(join(REPO_ROOT, relativePath));
  return [...new Set([...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]))];
}
