import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The grep ADR-0033 names, as code: an acceptance test names the criterion it proves **verbatim**
 * (lane 04's own rule), so "which tests does this slice's criteria list select" is a fixed-string
 * search over test source rather than a judgement call. Two callers share it rather than each
 * growing their own copy of the same grep: `verify.yml`'s "Restore and run acceptance" job, scoping
 * a run to one slice so a parallel pull request for a different slice is never reddened by tests
 * nobody has built yet, and lane 04's own re-entry trigger (ADR-0033), which fires acceptance
 * authoring again for exactly the slices whose tests still name a criterion the spec carries.
 *
 * The search is a literal substring match, not a regular expression — `String.prototype.includes`,
 * the `grep -F` of the two — because a criterion is prose lifted verbatim from an issue body and may
 * contain characters (parentheses, backticks, asterisks) that a regex would read as syntax rather
 * than text.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where lane 04 writes acceptance tests, and where a slice-scoped run reads them back from. */
export const ACCEPTANCE_DIR = join(REPO_ROOT, "tests/acceptance");

/**
 * Every regular file at or under `dir`, depth-first. Absent `dir` yields no files, not a throw —
 * a fresh checkout before lane 04 has ever run has no `tests/acceptance/` at all, and that is an
 * empty selection, not an error.
 *
 * No extension filter: what makes a file a candidate is that it lives in the acceptance
 * directory, a rule the immutable set (`shared/immutable-set.ts`) and ADR-0032's own-directory
 * import rule already enforce on that directory's contents. Restating an extension here would be
 * a second, narrower copy of that rule that could drift from it.
 */
function filesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...filesUnder(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

/**
 * The files under `dir` (default `ACCEPTANCE_DIR`) whose source names at least one of `criteria`
 * verbatim. A file with no acceptance test at all, or one naming only criteria absent from the
 * list, is not returned.
 */
export function testsForCriteria(criteria: string[], dir: string = ACCEPTANCE_DIR): string[] {
  return filesUnder(dir).filter((path) => {
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
 * names it. This is the record ADR-0033's re-entry trigger diffs a merged spec edit against —
 * built by a caller that already knows, for each slice, which of its own criteria a test in
 * `ACCEPTANCE_DIR` currently proves (`testsForCriteria` answers that one slice at a time).
 */
export interface ExistingTestCriterion {
  sliceNumber: number;
  criterion: string;
}

/**
 * Which slices ADR-0033's re-entry trigger must re-fire acceptance authoring for: every slice
 * that owns an existing test naming a criterion `specBody` — the spec, read *after* the merged
 * edit — no longer carries verbatim.
 *
 * This is a diff over `existingTests` only, never over `specBody` on its own — a criterion added
 * to the edited spec with no existing test naming it is a re-slice, not a re-entry (ADR-0079),
 * and this function has no way to even notice it: it only ever asks, of a criterion a test
 * already proves, whether the edited spec still contains it. The search is the same fixed-string
 * match `testsForCriteria` uses, for the reason given at the top of this file.
 *
 * A slice appears at most once in the result, in ascending slice-number order, however many of
 * its criteria went missing.
 */
export function affectedSlices(specBody: string, existingTests: ExistingTestCriterion[]): SliceRef[] {
  const affected = new Set<number>();
  for (const { sliceNumber, criterion } of existingTests) {
    if (!specBody.includes(criterion)) {
      affected.add(sliceNumber);
    }
  }
  return [...affected].sort((a, b) => a - b).map((sliceNumber) => ({ sliceNumber }));
}
