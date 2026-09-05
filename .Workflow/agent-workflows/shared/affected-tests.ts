import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { suiteLayout, walkTree } from "./suite-layout";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function walkSuiteRoots(root: string, keep: (name: string) => boolean): string[] {
  return suiteLayout(root).roots.flatMap((suiteRoot) => walkTree(join(root, suiteRoot), keep));
}

export function suiteTestFiles(root: string = REPO_ROOT): string[] {
  return suiteLayout(root).files.map((file) => join(root, file));
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
