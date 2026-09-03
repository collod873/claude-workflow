import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { affectedSlices, testsForCriteria, type ExistingTestCriterion } from "./affected-tests";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "affected-tests.fixtures");

const ALPHA = join(FIXTURES_DIR, "alpha.accept.ts");
const BETA = join(FIXTURES_DIR, "beta.accept.ts");
const GAMMA = join(FIXTURES_DIR, "nested", "gamma.accept.ts");
const DELTA = join(FIXTURES_DIR, "delta.accept.ts");

const WIDGET = "make test exits 0 with a widget that spins clockwise";
const GADGET = "make test exits 0 with a gadget that beeps twice on startup";
const DOOHICKEY = "make test exits 0 with a doohickey that hums in the key of D";
const REGEX_LOOKING = "make test exits 0 with a (widget) that spins clockwise*";
const NO_SUCH_CRITERION = "make test exits 0 with a criterion no fixture names";

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

describe("affectedSlices", () => {
  const EDITED_CRITERION = "make test exits 0 when the widget spins counterclockwise";
  const DELETED_CRITERION = "make test exits 0 with a gadget that beeps twice on startup";
  const UNCHANGED_CRITERION = "make test exits 0 with a doohickey that hums in the key of D";
  const ADDED_CRITERION = "make test exits 0 with a brand-new sprocket nobody has a test for yet";

  // Slice 101's test proves WIDGET, which the spec below no longer carries at all — edited to
  // different wording (EDITED_CRITERION). Slice 102's test proves DELETED_CRITERION, which the
  // spec below has simply dropped. Slice 103's test proves UNCHANGED_CRITERION, which the spec
  // still carries verbatim. ADDED_CRITERION is new in the spec and no existing test names it.
  const EXISTING_TESTS: ExistingTestCriterion[] = [
    { sliceNumber: 101, criterion: WIDGET },
    { sliceNumber: 102, criterion: DELETED_CRITERION },
    { sliceNumber: 103, criterion: UNCHANGED_CRITERION },
  ];

  const EDITED_SPEC_BODY = `## Acceptance criteria
- [ ] ${EDITED_CRITERION}
- [ ] ${UNCHANGED_CRITERION}
- [ ] ${ADDED_CRITERION}
`;

  it("returns only the slices whose test's verbatim criterion is missing from the new spec body, across edited, deleted and added-criterion fixtures", () => {
    const result = affectedSlices(EDITED_SPEC_BODY, EXISTING_TESTS);
    expect(result.map((slice) => slice.sliceNumber).sort((a, b) => a - b)).toEqual([101, 102]);
  });

  it("does not flag a slice whose test's criterion the spec still carries verbatim", () => {
    const result = affectedSlices(EDITED_SPEC_BODY, EXISTING_TESTS);
    expect(result.map((slice) => slice.sliceNumber)).not.toContain(103);
  });

  it("never lists a criterion added with no existing test naming it — that is a re-slice, not a re-entry", () => {
    // ADDED_CRITERION appears nowhere in EXISTING_TESTS, so nothing in the affected set can trace
    // to it — the only way it could appear is if this function looked at what's new in the spec
    // rather than what existing tests already prove.
    const result = affectedSlices(EDITED_SPEC_BODY, EXISTING_TESTS);
    const onlySlices = [101, 102, 103];
    expect(result.every((slice) => onlySlices.includes(slice.sliceNumber))).toBe(true);
  });

  it("returns nothing when the spec still carries every existing test's criterion verbatim", () => {
    const unchangedSpec = `## Acceptance criteria\n- [ ] ${WIDGET}\n- [ ] ${DELETED_CRITERION}\n- [ ] ${UNCHANGED_CRITERION}\n`;
    expect(affectedSlices(unchangedSpec, EXISTING_TESTS)).toEqual([]);
  });

  it("lists a slice once even when more than one of its criteria goes missing", () => {
    const bothMissing: ExistingTestCriterion[] = [
      { sliceNumber: 101, criterion: WIDGET },
      { sliceNumber: 101, criterion: DELETED_CRITERION },
    ];
    expect(affectedSlices("## Acceptance criteria\n- [ ] nothing here matches\n", bothMissing)).toEqual([
      { sliceNumber: 101 },
    ]);
  });

  it("returns an empty list for an empty existing-tests record", () => {
    expect(affectedSlices(EDITED_SPEC_BODY, [])).toEqual([]);
  });
});
