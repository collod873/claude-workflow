import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The grep ADR-0033 names, as code: an acceptance test names the criterion it proves **verbatim**
 * (the author's own rule), so "which tests does this slice's criteria list select" is a fixed-string
 * search over test source rather than a judgement call. Three callers share it: lane 07's
 * conformance reviewer (which criteria still have no test), lane 03's reconciler (has this slice
 * been authored yet), and lane 04's own re-entry trigger (ADR-0033).
 *
 * Since #360 an acceptance test lives beside its subject, so the search runs over the two trees the
 * suite collects (`vitest.config.ts`'s include) rather than a directory of its own. The search is a
 * literal substring match, not a regular expression — a criterion is prose lifted verbatim from an
 * issue body and may contain characters a regex would read as syntax.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The trees the suite collects tests from, relative to a checkout root. */
export const SUITE_ROOTS = [".Workflow", ".claude"] as const;

/** Directories under a suite root the suite never collects from. */
const SKIPPED = new Set(["node_modules", "worktrees"]);

/**
 * Every `*.test.ts` under `root`'s suite roots, depth-first. A root with no such tree yields no
 * files, not a throw — an enrolled repository may carry neither.
 */
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

/**
 * The test files under `root` whose source names at least one of `criteria` verbatim. A file
 * naming only criteria absent from the list is not returned.
 */
export function testsForCriteria(criteria: string[], root: string = REPO_ROOT): string[] {
  return suiteTestFiles(root).filter((path) => {
    const source = readFileSync(path, "utf8");
    return criteria.some((criterion) => source.includes(criterion));
  });
}

/** One slice this pipeline can re-fire acceptance authoring for. */
export interface SliceRef {
  sliceNumber: number;
}

/**
 * One criterion an existing acceptance test names verbatim, and the slice (ticket) whose test
 * names it — the record ADR-0033's re-entry trigger diffs a merged spec edit against.
 */
export interface ExistingTestCriterion {
  sliceNumber: number;
  criterion: string;
}

/**
 * Which slices ADR-0033's re-entry trigger must re-fire acceptance authoring for: every slice
 * that owns an existing test naming a criterion `specBody` — the spec, read *after* the merged
 * edit — no longer carries verbatim. A diff over `existingTests` only: a criterion added to the
 * edited spec with no existing test naming it is a re-slice, not a re-entry (ADR-0079).
 */
export function affectedSlices(specBody: string, existingTests: ExistingTestCriterion[]): SliceRef[] {
  const affected = new Set<number>();
  for (const { sliceNumber, criterion } of existingTests) {
    if (!specBody.includes(criterion)) affected.add(sliceNumber);
  }
  return [...affected].sort((a, b) => a - b).map((sliceNumber) => ({ sliceNumber }));
}
