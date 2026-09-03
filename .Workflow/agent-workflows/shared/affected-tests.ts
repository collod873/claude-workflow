import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const SUITE_ROOTS = [".Workflow", ".claude"] as const;

const SKIPPED = new Set(["node_modules", "worktrees"]);

export function suiteTestFiles(root: string = REPO_ROOT): string[] {
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
      if (statSync(path).isDirectory()) {
        if (!SKIPPED.has(entry)) walk(path);
      } else if (entry.endsWith(".test.ts")) {
        files.push(path);
      }
    }
  };
  for (const suiteRoot of SUITE_ROOTS) walk(join(root, suiteRoot));
  return files;
}

export function testsForCriteria(criteria: string[], root: string = REPO_ROOT): string[] {
  return suiteTestFiles(root).filter((path) => {
    const source = readFileSync(path, "utf8");
    return criteria.some((criterion) => source.includes(criterion));
  });
}

export interface SliceRef {
  sliceNumber: number;
}

export interface ExistingTestCriterion {
  sliceNumber: number;
  criterion: string;
}

export function affectedSlices(specBody: string, existingTests: ExistingTestCriterion[]): SliceRef[] {
  const affected = new Set<number>();
  for (const { sliceNumber, criterion } of existingTests) {
    if (!specBody.includes(criterion)) affected.add(sliceNumber);
  }
  return [...affected].sort((a, b) => a - b).map((sliceNumber) => ({ sliceNumber }));
}
