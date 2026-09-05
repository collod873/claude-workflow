import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const SUITE_ROOTS = [".Workflow", ".claude"] as const;

const SKIPPED = new Set(["node_modules", "worktrees"]);

export function walkSuiteRoots(root: string, keep: (name: string) => boolean): string[] {
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
      } else if (keep(entry)) {
        files.push(path);
      }
    }
  };
  for (const suiteRoot of SUITE_ROOTS) walk(join(root, suiteRoot));
  return files;
}

export function suiteTestFiles(root: string = REPO_ROOT): string[] {
  return walkSuiteRoots(root, (name) => name.endsWith(".test.ts"));
}

const STILL_RED = "\\.fails";
const RED_OR_TURNED_ON = "(?:\\.fails)?";

function titleRe(fails: string, issue: number, index: string): RegExp {
  return new RegExp(`\\b(?:test|it)${fails}\\(\\s*["'\`]#${issue}${index}:`);
}

function ticketTitleRe(issue: number): RegExp {
  return titleRe(RED_OR_TURNED_ON, issue, "(?:\\.\\d+)?");
}

function criterionTitleRe(issue: number, index: number): RegExp {
  return titleRe(RED_OR_TURNED_ON, issue, `\\.${index}`);
}

export function authoredCriterionTitleRe(issue: number, index: number): RegExp {
  return titleRe(STILL_RED, issue, `\\.${index}`);
}

export function testsForTicket(issue: number, root: string = REPO_ROOT): string[] {
  const matcher = ticketTitleRe(issue);
  return suiteTestFiles(root).filter((path) => matcher.test(readFileSync(path, "utf8")));
}

export function testsForCriterion(issue: number, index: number, root: string = REPO_ROOT): string[] {
  const matcher = criterionTitleRe(issue, index);
  return suiteTestFiles(root).filter((path) => matcher.test(readFileSync(path, "utf8")));
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
