import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scratchDir } from "./scratch.fixture";
import {
  affectedSlices,
  authoredCriterionTitleRe,
  SUITE_ROOTS,
  suiteTestFiles,
  testsForCriterion,
  testsForTicket,
  type ExistingTestCriterion,
} from "./affected-tests";

const WIDGET = "make test exits 0 with a widget that spins clockwise";
const GADGET = "make test exits 0 with a gadget that beeps twice on startup";
const DOOHICKEY = "make test exits 0 with a doohickey that hums in the key of D";
const REGEX_LOOKING = "make test exits 0 with a (widget) that spins clockwise*";
const NO_SUCH_CRITERION = "make test exits 0 with a criterion no fixture names";

const ALPHA = ".Workflow/agent-workflows/shared/alpha.test.ts";
const BETA = ".claude/hooks/beta.test.ts";
const GAMMA = ".Workflow/agent-workflows/deep/nested/gamma.test.ts";
const DELTA = ".Workflow/delta.test.ts";

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

function titledCheckout(): string {
  return checkoutWith({
    [ALPHA]: 'test.fails("#101: widget spins clockwise", () => {});\n',
    [BETA]: 'it.fails("#102: gadget beeps twice", () => {});\n',
    [GAMMA]: 'test.fails("#101.2: doohickey hums in D", () => {});\n',
    [DELTA]: 'test("#101: widget turned on", () => {});\n',
    ".Workflow/unrelated.txt": 'test.fails("#101: widget spins clockwise", () => {});\n',
    ".Workflow/not-a-test.ts": 'test.fails("#101: widget spins clockwise", () => {});\n',
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

  it("does not return a test outside the suite roots, since it would never run", () => {
    const root = fixtureCheckout();
    expect(suiteTestFiles(root).some((path) => path.includes("tests/acceptance"))).toBe(false);
  });

  it("yields nothing, not a throw, for a root carrying neither tree", () => {
    expect(suiteTestFiles(scratchDir("affected-tests-empty"))).toEqual([]);
    expect(suiteTestFiles(join(scratchDir("affected-tests-missing"), "no-such-directory"))).toEqual([]);
  });

  it("defaults to this checkout, so the file you are reading is one of its results", () => {
    expect(suiteTestFiles()).toContain(fileURLToPath(import.meta.url));
  });
});

describe("testsForTicket", () => {
  it("finds a test titled with the ticket number and no index", () => {
    const root = titledCheckout();
    expect(testsForTicket(101, root)).toEqual(
      expect.arrayContaining([join(root, ALPHA), join(root, GAMMA), join(root, DELTA)]),
    );
  });

  it("finds a test in either suite root", () => {
    const root = titledCheckout();
    expect(testsForTicket(102, root)).toEqual([join(root, BETA)]);
  });

  it("matches a title with no .fails, since a turned-on test still proves the criterion", () => {
    const root = titledCheckout();
    expect(testsForTicket(101, root)).toContain(join(root, DELTA));
  });

  it("returns nothing when no title names the ticket", () => {
    expect(testsForTicket(999, titledCheckout())).toEqual([]);
  });

  it("does not select a file naming the ticket that is not a *.test.ts", () => {
    const root = titledCheckout();
    const result = testsForTicket(101, root);
    expect(result).not.toContain(join(root, ".Workflow/unrelated.txt"));
    expect(result).not.toContain(join(root, ".Workflow/not-a-test.ts"));
  });

  it("does not match a longer ticket number sharing the same prefix", () => {
    expect(testsForTicket(10, titledCheckout())).toEqual([]);
  });

  it("returns no files at all for a checkout with no suite", () => {
    expect(testsForTicket(101, scratchDir("affected-tests-bare"))).toEqual([]);
  });
});

describe("testsForCriterion", () => {
  it("returns only the file titled with that ticket's criterion index", () => {
    const root = titledCheckout();
    expect(testsForCriterion(101, 2, root)).toEqual([join(root, GAMMA)]);
  });

  it("does not match the ticket-level title of the same ticket", () => {
    const root = titledCheckout();
    expect(testsForCriterion(101, 1, root)).toEqual([]);
  });

  it("returns nothing when no title names that criterion", () => {
    expect(testsForCriterion(101, 9, titledCheckout())).toEqual([]);
  });
});

describe("authoredCriterionTitleRe", () => {
  it("matches the title the author is required to write", () => {
    expect(authoredCriterionTitleRe(101, 2).test('test.fails("#101.2: doohickey hums in D", () => {});')).toBe(true);
    expect(authoredCriterionTitleRe(101, 2).test('it.fails("#101.2: doohickey hums in D", () => {});')).toBe(true);
  });

  it("refuses a title with no .fails, which testsForCriterion still selects once an implementer turns it on", () => {
    const turnedOn = 'test("#101.2: doohickey hums in D", () => {});';
    const root = checkoutWith({ [GAMMA]: `${turnedOn}\n` });
    expect(authoredCriterionTitleRe(101, 2).test(turnedOn)).toBe(false);
    expect(testsForCriterion(101, 2, root)).toEqual([join(root, GAMMA)]);
  });

  it("selects the same file testsForCriterion does when the author's own title is read back", () => {
    const root = titledCheckout();
    const authored = suiteTestFiles(root).filter((path) => authoredCriterionTitleRe(101, 2).test(readFileSync(path, "utf8")));
    expect(authored).toEqual(testsForCriterion(101, 2, root));
  });

  it("does not match another criterion of the same ticket", () => {
    expect(authoredCriterionTitleRe(101, 1).test('test.fails("#101.2: doohickey hums in D", () => {});')).toBe(false);
  });
});

describe("affectedSlices", () => {
  const EDITED_CRITERION = "make test exits 0 when the widget spins counterclockwise";
  const DELETED_CRITERION = "make test exits 0 with a gadget that beeps twice on startup";
  const UNCHANGED_CRITERION = "make test exits 0 with a doohickey that hums in the key of D";
  const ADDED_CRITERION = "make test exits 0 with a brand-new sprocket nobody has a test for yet";

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

  it("never lists a criterion added with no existing test naming it, since that is a re-slice, not a re-entry", () => {
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
