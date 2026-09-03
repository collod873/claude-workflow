import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scratchDir } from "./scratch.fixture";
import { affectedSlices, SUITE_ROOTS, suiteTestFiles, testsForCriteria, type ExistingTestCriterion } from "./affected-tests";

const WIDGET = "make test exits 0 with a widget that spins clockwise";
const GADGET = "make test exits 0 with a gadget that beeps twice on startup";
const DOOHICKEY = "make test exits 0 with a doohickey that hums in the key of D";
const REGEX_LOOKING = "make test exits 0 with a (widget) that spins clockwise*";
const NO_SUCH_CRITERION = "make test exits 0 with a criterion no fixture names";

const ALPHA = ".Workflow/agent-workflows/shared/alpha.test.ts";
const BETA = ".claude/hooks/beta.test.ts";
const GAMMA = ".Workflow/agent-workflows/deep/nested/gamma.test.ts";
const DELTA = ".Workflow/delta.test.ts";

/**
 * A throwaway checkout carrying the suite's two trees, with one file per entry. Since #360 an
 * acceptance test lives beside its subject, so the search is over `SUITE_ROOTS` under a root,
 * never over a directory of its own — and a fixture that lived under this repo's `.Workflow/`
 * would be collected by the real suite as well.
 */
function checkoutWith(files: Record<string, string>): string {
  const root = scratchDir("affected-tests");
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents, "utf8");
  }
  return root;
}

function fixtureCheckout(): string {
  return checkoutWith({
    [ALPHA]: `// ${WIDGET}\n`,
    [BETA]: `// ${GADGET}\n`,
    [GAMMA]: `// ${DOOHICKEY}\n`,
    [DELTA]: `// ${REGEX_LOOKING}\n`,
    ".Workflow/unrelated.txt": `${WIDGET}\n`,
    ".Workflow/not-a-test.ts": `// ${WIDGET}\n`,
    ".Workflow/node_modules/dep/dep.test.ts": `// ${WIDGET}\n`,
    ".claude/worktrees/other/.Workflow/copy.test.ts": `// ${WIDGET}\n`,
    "tests/acceptance/old.test.ts": `// ${WIDGET}\n`,
  });
}

describe("SUITE_ROOTS", () => {
  it("names the two trees the suite collects, and nothing else", () => {
    expect(SUITE_ROOTS).toEqual([".Workflow", ".claude"]);
  });
});

describe("suiteTestFiles", () => {
  it("walks every *.test.ts under both suite roots, however deep", () => {
    const root = fixtureCheckout();
    expect(suiteTestFiles(root).sort()).toEqual([ALPHA, BETA, GAMMA, DELTA].map((path) => join(root, path)).sort());
  });

  it("skips node_modules and .claude/worktrees, the same way vitest's config does", () => {
    const root = fixtureCheckout();
    const found = suiteTestFiles(root);
    expect(found.some((path) => path.includes("node_modules"))).toBe(false);
    expect(found.some((path) => path.includes("worktrees"))).toBe(false);
  });

  it("does not return a test outside the suite roots — it would never run", () => {
    const root = fixtureCheckout();
    expect(suiteTestFiles(root).some((path) => path.includes("tests/acceptance"))).toBe(false);
  });

  it("yields nothing, not a throw, for a root carrying neither tree", () => {
    expect(suiteTestFiles(scratchDir("affected-tests-empty"))).toEqual([]);
    expect(suiteTestFiles(join(scratchDir("affected-tests-missing"), "no-such-directory"))).toEqual([]);
  });

  it("defaults to this checkout — the file you are reading is one of its results", () => {
    expect(suiteTestFiles()).toContain(fileURLToPath(import.meta.url));
  });
});

describe("testsForCriteria", () => {
  it("returns only the file whose recorded criterion matches a single-criterion list", () => {
    const root = fixtureCheckout();
    expect(testsForCriteria([WIDGET], root)).toEqual([join(root, ALPHA)]);
  });

  it("returns every file whose recorded criterion matches a multi-criterion list, and nothing else", () => {
    const root = fixtureCheckout();
    const result = testsForCriteria([WIDGET, DOOHICKEY], root);
    expect(result.sort()).toEqual([join(root, ALPHA), join(root, GAMMA)].sort());
    expect(result).not.toContain(join(root, BETA));
  });

  it("finds a match in either suite root", () => {
    const root = fixtureCheckout();
    expect(testsForCriteria([GADGET], root)).toEqual([join(root, BETA)]);
  });

  it("returns nothing when no criterion in the list matches any file", () => {
    expect(testsForCriteria([NO_SUCH_CRITERION], fixtureCheckout())).toEqual([]);
  });

  it("returns nothing for an empty criteria list", () => {
    expect(testsForCriteria([], fixtureCheckout())).toEqual([]);
  });

  it("does not select a file naming the criterion that is not a *.test.ts", () => {
    const root = fixtureCheckout();
    const result = testsForCriteria([WIDGET], root);
    expect(result).not.toContain(join(root, ".Workflow/unrelated.txt"));
    expect(result).not.toContain(join(root, ".Workflow/not-a-test.ts"));
  });

  it("matches a criterion containing regex-special characters as literal text, not a pattern", () => {
    // `(widget)` and a trailing `*` are regex metacharacters. A search that compiled the criterion
    // as a pattern instead of comparing it as text would either throw or match the wrong thing.
    const root = fixtureCheckout();
    expect(testsForCriteria([REGEX_LOOKING], root)).toEqual([join(root, DELTA)]);
  });

  it("returns no files at all for a checkout with no suite", () => {
    expect(testsForCriteria([WIDGET], scratchDir("affected-tests-bare"))).toEqual([]);
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
    expect(result.map((slice) => slice.sliceNumber)).toEqual([101, 102]);
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

  it("lists a slice once even when more than one of its criteria goes missing, sorted ascending", () => {
    const bothMissing: ExistingTestCriterion[] = [
      { sliceNumber: 102, criterion: WIDGET },
      { sliceNumber: 101, criterion: DELETED_CRITERION },
      { sliceNumber: 101, criterion: WIDGET },
    ];
    expect(affectedSlices("## Acceptance criteria\n- [ ] nothing here matches\n", bothMissing)).toEqual([
      { sliceNumber: 101 },
      { sliceNumber: 102 },
    ]);
  });

  it("returns an empty list for an empty existing-tests record", () => {
    expect(affectedSlices(EDITED_SPEC_BODY, [])).toEqual([]);
  });
});
