import { ESLint } from "eslint";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * spec #145, Lane 04: "An acceptance test may not import anything outside its own directory."
 * `tests/acceptance/**` is restored from `main`'s tip before CI runs it (ADR-0032); a helper
 * pulled in from anywhere else would silently revert to trunk's copy on every real run while the
 * test importing it did not, so the path filter that restore-from-tip relies on is complete only
 * if nothing inside it reaches outside it. `eslint.config.js`'s `acceptanceImportBoundaryRule`
 * enforces that through `bin/gauntlet lint`; this proves it against real fixtures, run through the
 * project's own `eslint.config.js` rather than a duplicate of its rule, so a future edit to the
 * config can't drift from what this test asserts.
 *
 * Fixtures are linted from a temp root rather than the real `tests/acceptance/` — that directory
 * doesn't exist in every worktree this ticket runs in (it's restored by a sibling slice), and this
 * rule's whole point is to key off the file's own path segments rather than the linter's `cwd`, so
 * a temp root proves that as directly as the real directory would.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CONFIG_FILE = join(REPO_ROOT, "eslint.config.js");

const dirs: string[] = [];

afterEach(() => {
  dirs.length = 0;
});

/** A temp root containing `tests/acceptance/`, so paths inside it match the override's `files:` glob. */
function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "acceptance-import-boundary-"));
  dirs.push(root);
  mkdirSync(join(root, "tests/acceptance/nested"), { recursive: true });
  mkdirSync(join(root, "shared"), { recursive: true });
  return root;
}

async function lint(root: string, relativePath: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: CONFIG_FILE });
  return eslint.lintFiles([relativePath]);
}

describe("acceptanceImportBoundaryRule, run through the project's eslint.config.js", () => {
  it("fails a fixture acceptance test importing a helper from outside tests/acceptance/", async () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "shared/helper.ts"), "export const helper = 1;\n");
    writeFileSync(
      join(root, "tests/acceptance/lane-04.test.ts"),
      'import { helper } from "../../shared/helper";\nexport const used = helper;\n',
    );

    const [result] = await lint(root, "tests/acceptance/lane-04.test.ts");

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.messages.some((m) => m.ruleId === "acceptance-boundary/no-outside-import")).toBe(true);
  });

  it("passes a fixture importing only from within tests/acceptance/", async () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "tests/acceptance/helper.ts"), "export const helper = 1;\n");
    writeFileSync(
      join(root, "tests/acceptance/nested/lane-04.test.ts"),
      'import { helper } from "../helper";\nexport const used = helper;\n',
    );

    const [result] = await lint(root, "tests/acceptance/nested/lane-04.test.ts");

    expect(result.messages.some((m) => m.ruleId === "acceptance-boundary/no-outside-import")).toBe(false);
  });

  it("leaves a bare specifier alone — an npm package is not a directory escape", async () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, "tests/acceptance/lane-04.test.ts"),
      'import { describe } from "vitest";\nexport const used = describe;\n',
    );

    const [result] = await lint(root, "tests/acceptance/lane-04.test.ts");

    expect(result.messages.some((m) => m.ruleId === "acceptance-boundary/no-outside-import")).toBe(false);
  });

  it("does not apply outside tests/acceptance/ — the override's files: glob stays scoped", async () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "shared/helper.ts"), "export const helper = 1;\n");
    mkdirSync(join(root, "shared/consumer"), { recursive: true });
    writeFileSync(
      join(root, "shared/consumer/uses-helper.ts"),
      'import { helper } from "../helper";\nexport const used = helper;\n',
    );

    const [result] = await lint(root, "shared/consumer/uses-helper.ts");

    expect(result.messages.some((m) => m.ruleId === "acceptance-boundary/no-outside-import")).toBe(false);
  });
});
