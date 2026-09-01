import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTRACT_RELATIVE_PATH, generateContract } from "./generate-contract";
import {
  CORPUS_RELATIVE_PATH,
  diffCorpusFixture,
  generateCorpusFixture,
  serializeCorpusFixture,
  type AdrCorpusFixture,
} from "./generate-corpus-fixture";

/**
 * #140: the corpus-fixture generator (`regenerate`) and `bin/gauntlet push`'s wiring of it
 * (`&& diff`), ADR-0056's pattern reused for `adr-corpus.evidence.json` the way
 * `generate-contract.test.ts` already exercises it for `.claude/contract.json`.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("generateCorpusFixture", () => {
  it("matches this repository's own committed adr-corpus.evidence.json byte-for-byte", () => {
    const committed = readFileSync(join(REPO_ROOT, CORPUS_RELATIVE_PATH), "utf8");

    expect(generateCorpusFixture(REPO_ROOT)).toBe(committed);
  });

  it("generates byte-identical output twice over an unchanged corpus", () => {
    expect(generateCorpusFixture(REPO_ROOT)).toBe(generateCorpusFixture(REPO_ROOT));
  });
});

/**
 * A throwaway `docs/adr` + `docs/research` tree, built fresh per test rather than committed under
 * `check-contract.fixtures/`-style directory: what these tests are about is the trim rule, not any
 * particular document, and a synthetic corpus makes the trim boundary exact instead of hostage to
 * whatever this repo's own notes happen to contain on a given day.
 */
function corpusRoot(adrs: Record<string, string>, notes: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "generate-corpus-fixture-"));
  const adrDir = join(root, "docs/adr");
  const researchDir = join(root, "docs/research");
  mkdirSync(adrDir, { recursive: true });
  mkdirSync(researchDir, { recursive: true });
  for (const [name, body] of Object.entries(adrs)) writeFileSync(join(adrDir, name), body);
  for (const [name, body] of Object.entries(notes)) writeFileSync(join(researchDir, name), body);
  return root;
}

describe("the trim: notes to their preamble, ADRs whole", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function generate(adrs: Record<string, string>, notes: Record<string, string>): AdrCorpusFixture {
    const root = corpusRoot(adrs, notes);
    dirs.push(root);
    return JSON.parse(generateCorpusFixture(root)) as AdrCorpusFixture;
  }

  /**
   * ADR-0080's second half, and #146's second and third criteria: a draft is not yet part of the
   * record, so a working tree holding one generates the same fixture as a tree without it — which
   * is what lets `bin/gauntlet stop` and `bin/gauntlet push` stay green over an in-progress ADR.
   * Before this the only way to hold a draft was to keep the gauntlet red.
   */
  it("excludes an unlanded draft from both corpora, so an in-progress document does not stale the fixture", () => {
    const landedOnly = generate(
      { "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n" },
      { "topic-2026-08.md": "**Resolves:** [x](https://example/1)\n" },
    );
    const withDrafts = generate(
      {
        "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n",
        "draft-a-half-written-ruling.md": "# A half-written ruling\n\nRecorded 2026-08-27.\n",
      },
      {
        "topic-2026-08.md": "**Resolves:** [x](https://example/1)\n",
        "draft-a-half-written-note.md": "# A half-written note\n",
      },
    );

    expect(withDrafts).toEqual(landedOnly);
  });

  it("truncates a research note's body at its first ## section", () => {
    const fixture = generate(
      { "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n" },
      {
        "topic-2026-08.md":
          "**Resolves:** [x](https://example/1)\n\n## Section one\n\nBody the counter never reads.\n",
      },
    );

    expect(fixture.notes[0].body).toBe("**Resolves:** [x](https://example/1)\n");
  });

  it("leaves an ADR's body whole, ## sections and all", () => {
    const body = "# A decision\n\nRecorded 2026-08-20.\n\n## Consequences\n\nStill here.\n";
    const fixture = generate({ "0001-a-decision.md": body }, {});

    expect(fixture.adrs[0].body).toBe(body);
  });

  it("leaves a note with no ## section untouched", () => {
    const body = "**Resolves:** [x](https://example/1)\n\nNo sections in this one.\n";
    const fixture = generate({}, { "topic-2026-08.md": body });

    expect(fixture.notes[0].body).toBe(body);
  });

  it("puts no ## in any generated note body, across a corpus of several notes", () => {
    const fixture = generate(
      {},
      {
        "one-2026-08.md": "**Resolves:** [x](https://example/1)\n\n## Section\n\nMore.\n",
        "two-2026-08.md": "**Unprompted:** no issue\n\n## Section\n\n## Another\n\nMore.\n",
        "three-2026-08.md": "**Resolves:** [x](https://example/1)\n\nNo sections here at all.\n",
      },
    );

    for (const note of fixture.notes) expect(note.body).not.toContain("##");
  });

  it("puts no ## in any note in this repository's own regenerated fixture", () => {
    const fixture = JSON.parse(generateCorpusFixture(REPO_ROOT)) as AdrCorpusFixture;

    for (const note of fixture.notes) expect(note.body).not.toContain("##");
  });
});

describe("serializeCorpusFixture", () => {
  it("two-space indents and ends with exactly one trailing newline", () => {
    const fixture: AdrCorpusFixture = {
      adrs: [{ number: 1, filename: "0001-a-decision.md", title: "A decision", body: "Recorded 2026-08-20.\n" }],
      notes: [],
    };

    const text = serializeCorpusFixture(fixture);

    expect(text).toBe(`${JSON.stringify(fixture, null, 2)}\n`);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("diffCorpusFixture", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function writeCopy(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), "generate-corpus-fixture-diff-"));
    dirs.push(dir);
    const path = join(dir, "adr-corpus.evidence.json");
    writeFileSync(path, text);
    return path;
  }

  it("reports nothing when the committed text already matches a fresh generation", () => {
    const path = writeCopy(generateCorpusFixture(REPO_ROOT));

    expect(diffCorpusFixture(REPO_ROOT, path)).toBeUndefined();
  });

  it("reports an added ADR when the committed fixture has drifted", () => {
    const fresh = JSON.parse(generateCorpusFixture(REPO_ROOT)) as AdrCorpusFixture;
    const stale: AdrCorpusFixture = { ...fresh, adrs: fresh.adrs.slice(1) };
    const path = writeCopy(serializeCorpusFixture(stale));

    const mismatch = diffCorpusFixture(REPO_ROOT, path);

    expect(mismatch).toContain(`+ adrs: ${fresh.adrs[0].filename}`);
  });
});

/**
 * The modules `bin/gauntlet push` loads by path off its own repo root, relative to that root —
 * `check-contract.ts` and `generate-contract.ts` for the existing contract check,
 * `generate-corpus-fixture.ts` for this one, `wiring-baseline.ts` (#183) for the wiring check,
 * `workflow-lint.ts` (ADR-0105) and the `reason.ts` it imports for the workflow check.
 * The fixture root has no `knip.config.ts`, so the wiring check opts out of it, and no
 * `.github/workflows/`, so the workflow check has nothing to lint and starts no container.
 */
const GAUNTLET_MODULES = [
  ".Workflow/agent-workflows/shared/check-contract.ts",
  ".Workflow/agent-workflows/shared/generate-contract.ts",
  ".Workflow/agent-workflows/shared/generate-corpus-fixture.ts",
  ".Workflow/agent-workflows/shared/wiring-baseline.ts",
  ".Workflow/agent-workflows/shared/workflow-lint.ts",
  ".Workflow/agent-workflows/shared/trailer-form.ts",
  ".Workflow/agent-workflows/shared/reason.ts",
];

const DOES_NOTHING = 'node -e ""';

describe("bin/gauntlet push's regenerate && diff for the corpus fixture", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  /**
   * A throwaway tree the real `bin/gauntlet` is run *as*, following `generate-contract.test.ts`'s
   * own `fixtureRoot` exactly (see that file's comment for why: a real push against this repo
   * itself costs a whole suite run, twice, for a check that is about the contract/corpus diff and
   * not about what `test` happens to run underneath it). Carries a two-ADR, one-note corpus so the
   * corpus check has something real to generate from.
   */
  function fixtureRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-push-corpus-fixture-"));
    dirs.push(root);

    symlinkSync(join(REPO_ROOT, "bin"), join(root, "bin"), "dir");
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
    for (const module of GAUNTLET_MODULES) {
      mkdirSync(join(root, dirname(module)), { recursive: true });
      copyFileSync(join(REPO_ROOT, module), join(root, module));
    }

    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "gauntlet-push-corpus-fixture",
          private: true,
          type: "module",
          scripts: {
            test: DOES_NOTHING,
            typecheck: DOES_NOTHING,
            lint: DOES_NOTHING,
            check: "bin/gauntlet push",
          },
        },
        null,
        2,
      )}\n`,
    );

    mkdirSync(join(root, "docs/adr"), { recursive: true });
    mkdirSync(join(root, "docs/research"), { recursive: true });
    writeFileSync(
      join(root, "docs/adr/0001-a-decision.md"),
      "# A decision\n\nRecorded 2026-08-20.\n",
    );
    writeFileSync(
      join(root, "docs/research/topic-2026-08.md"),
      "**Resolves:** [x](https://example/1)\n\n## Section\n\nBody.\n",
    );

    mkdirSync(join(root, dirname(CONTRACT_RELATIVE_PATH)), { recursive: true });
    writeFileSync(join(root, CONTRACT_RELATIVE_PATH), generateContract(root));

    mkdirSync(join(root, dirname(CORPUS_RELATIVE_PATH)), { recursive: true });
    writeFileSync(join(root, CORPUS_RELATIVE_PATH), generateCorpusFixture(root));

    return root;
  }

  function runPush(root: string): { status: number | null; stdout: string } {
    const run = spawnSync(join(root, "bin/gauntlet"), ["push"], {
      encoding: "utf8",
      cwd: root,
      env: process.env,
    });
    return { status: run.status, stdout: run.stdout };
  }

  it("exits 0 against a freshly generated corpus fixture", () => {
    const root = fixtureRoot();

    expect(runPush(root).status).toBe(0);
  });

  it("exits 1 against a corpus fixture reverted to stale content, then 0 once regenerated", () => {
    const root = fixtureRoot();
    const corpusPath = join(root, CORPUS_RELATIVE_PATH);
    const fresh = generateCorpusFixture(root);

    // The untrimmed shape this ticket replaces: a note's full body, including its ## sections,
    // rather than just its preamble — the exact drift `regenerate && diff` exists to catch.
    const stale: AdrCorpusFixture = JSON.parse(fresh);
    stale.notes[0].body = "**Resolves:** [x](https://example/1)\n\n## Section\n\nBody.\n";
    writeFileSync(corpusPath, serializeCorpusFixture(stale));

    const mismatched = runPush(root);
    expect(mismatched.status).toBe(1);
    expect(mismatched.stdout).toContain("--- corpus ---");

    writeFileSync(corpusPath, fresh);
    expect(runPush(root).status).toBe(0);
  });
});
