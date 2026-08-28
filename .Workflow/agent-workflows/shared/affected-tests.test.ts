import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testsForCriteria } from "./affected-tests";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "affected-tests.fixtures");

const ALPHA = join(FIXTURES_DIR, "alpha.accept.ts");
const BETA = join(FIXTURES_DIR, "beta.accept.ts");
const GAMMA = join(FIXTURES_DIR, "nested", "gamma.accept.ts");
const DELTA = join(FIXTURES_DIR, "delta.accept.ts");

const WIDGET = "npm test exits 0 with a widget that spins clockwise";
const GADGET = "npm test exits 0 with a gadget that beeps twice on startup";
const DOOHICKEY = "npm test exits 0 with a doohickey that hums in the key of D";
const REGEX_LOOKING = "npm test exits 0 with a (widget) that spins clockwise*";
const NO_SUCH_CRITERION = "npm test exits 0 with a criterion no fixture names";

describe("testsForCriteria", () => {
  it("returns only the file whose recorded criterion matches a single-criterion list", () => {
    expect(testsForCriteria([WIDGET], FIXTURES_DIR)).toEqual([ALPHA]);
  });

  it("returns every file whose recorded criterion matches a multi-criterion list, and nothing else", () => {
    const result = testsForCriteria([WIDGET, DOOHICKEY], FIXTURES_DIR);
    expect(result.sort()).toEqual([ALPHA, GAMMA].sort());
    expect(result).not.toContain(BETA);
  });

  it("finds a match nested below the top level of the directory", () => {
    expect(testsForCriteria([DOOHICKEY], FIXTURES_DIR)).toEqual([GAMMA]);
  });

  it("returns nothing when no criterion in the list matches any fixture", () => {
    expect(testsForCriteria([NO_SUCH_CRITERION], FIXTURES_DIR)).toEqual([]);
  });

  it("returns nothing for an empty criteria list", () => {
    expect(testsForCriteria([], FIXTURES_DIR)).toEqual([]);
  });

  it("does not select a file that merely sits in the directory naming no criterion", () => {
    const result = testsForCriteria([WIDGET, GADGET, DOOHICKEY], FIXTURES_DIR);
    expect(result).not.toContain(join(FIXTURES_DIR, "unrelated.txt"));
  });

  it("matches a criterion containing regex-special characters as literal text, not a pattern", () => {
    // `(widget)` and a trailing `*` are regex metacharacters. A search that compiled the criterion
    // as a pattern instead of comparing it as text would either throw or match the wrong thing.
    expect(testsForCriteria([REGEX_LOOKING], FIXTURES_DIR)).toEqual([DELTA]);
  });

  it("returns no files at all for a directory that does not exist", () => {
    expect(testsForCriteria([WIDGET], join(FIXTURES_DIR, "no-such-directory"))).toEqual([]);
  });

  it("defaults to tests/acceptance/ when no directory is given", () => {
    expect(testsForCriteria([WIDGET])).toEqual([]);
  });
});
