import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { listVitestFiles } from "./vitest-json";

export interface SuiteLayout {
  files: string[];
  roots: string[];
  suffixes: string[];
}

export type SuiteLister = (repoDir: string) => string[] | undefined;

const SKIPPED = new Set([".git", "node_modules", "worktrees"]);

const TEST_SUFFIX_RE = /\.(?:test|spec)\.[^.]+$/;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function walkTree(root: string, keep: (name: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      if (isDirectory(path)) {
        if (!SKIPPED.has(entry)) walk(path);
      } else if (keep(entry)) {
        files.push(path);
      }
    }
  };
  walk(root);
  return files;
}

export function suiteLayout(root: string, list: SuiteLister = listVitestFiles): SuiteLayout {
  const found = list(root) ?? walkTree(root, (name) => TEST_SUFFIX_RE.test(name));
  const files = found.map((file) => relative(root, file).split(sep).join("/")).sort();
  const roots = new Set<string>();
  const suffixes = new Set<string>();
  for (const path of files) {
    const segments = path.split("/");
    if (segments.length > 1 && segments[0] !== "" && segments[0] !== "..") roots.add(segments[0]);
    const suffix = TEST_SUFFIX_RE.exec(path);
    if (suffix) suffixes.add(suffix[0]);
  }
  return { files, roots: [...roots].sort(), suffixes: [...suffixes].sort() };
}
