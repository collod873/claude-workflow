import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The standing acceptance test the ratifier lane is judged against** (#296).
 *
 * Lane 06 selects which acceptance tests to run by fixed-string search over this directory
 * (`shared/affected-tests.ts`, `testsForCriteria`), and an empty selection is a hard failure
 * (`verify.yml`). A ratifier pull request carries no ticket, so it carries no ticket's criteria —
 * it sends one fixed criterion instead, and this file is what that criterion selects. The sentence
 * below is that criterion, verbatim; the assertion `criterionIsTheOneTheLaneSends` is what keeps
 * the two from drifting apart, because a reworded criterion would silently select nothing and
 * every ratifier batch would go red on "no acceptance test names a criterion this dispatch
 * carries".
 *
 * It asserts something real rather than standing in as a formality. A ratifier batch's whole
 * output is edits to exactly two files, and each has one way of being wrong that nothing else in
 * this repo checks:
 *
 *  - **`eslint.config.js`** — a rule turned on in a `rules` map with no definition behind it is an
 *    eslint startup failure. The lane authors rules and their registrations in the same edit, so
 *    the halves can disagree.
 *  - **`CODING_STANDARDS.md`** — an entry appended in anything but the file's own three-line shape
 *    is invisible to the revert detector, which parses that shape to answer "is this standard still
 *    in the tree?". A malformed append would read as an instant revert of the thing that just
 *    landed.
 *
 * ADR-0032 forbids this directory importing anything outside it, so the two parses below are this
 * file's own copies of the ones in `.Workflow/agent-workflows/ratify/standards.ts`. That
 * duplication is the rule, not an oversight: `tests/acceptance/` is restored from trunk's tip
 * before CI runs it, so a helper imported from elsewhere would silently revert while the test
 * importing it did not.
 */

const CRITERION =
  "Every enabled eslint rule resolves to a definition and every CODING_STANDARDS.md entry parses to the three-line shape";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The heading `CODING_STANDARDS.md`'s entries live under — nothing above it is a standard. */
const STANDARDS_HEADING = "## Standards";
const ENTRY_HEAD = /^- \*\*(.+?)\*\*\s+[—-]\s+(.+)$/;
const ENTRY_WHY = /^\s+Why:\s*(.+)$/;
const ENTRY_RED_FLAG = /^\s+Red flag:\s*(.+)$/;

interface FlatConfigElement {
  rules?: Record<string, unknown>;
  plugins?: Record<string, { rules?: Record<string, unknown> }>;
}

function isOff(severity: unknown): boolean {
  const level = Array.isArray(severity) ? severity[0] : severity;
  return level === "off" || level === 0;
}

async function flatConfig(): Promise<FlatConfigElement[]> {
  const module = (await import(pathToFileURL(join(REPO_ROOT, "eslint.config.js")).href)) as {
    default: unknown;
  };
  const config = module.default;
  return (Array.isArray(config) ? config : [config]) as FlatConfigElement[];
}

describe(CRITERION, () => {
  it("names the criterion the ratifier lane's dispatch actually sends, so this file stays selected", () => {
    const land = readFileSync(
      join(REPO_ROOT, ".Workflow/agent-workflows/ratify/land.ts"),
      "utf8",
    );
    expect(
      land.includes(CRITERION),
      "ratify/land.ts's RATIFIER_CRITERION no longer matches this file's criterion — lane 06 " +
        "selects acceptance tests by verbatim substring, so every ratifier batch would fail with " +
        '"no acceptance test names a criterion this dispatch carries"',
    ).toBe(true);
  });

  it("resolves every namespaced rule the config turns on to a definition the config supplies", async () => {
    const config = await flatConfig();

    const defined = new Set<string>();
    for (const element of config) {
      for (const [namespace, plugin] of Object.entries(element.plugins ?? {})) {
        for (const rule of Object.keys(plugin?.rules ?? {})) defined.add(`${namespace}/${rule}`);
      }
    }

    const enabled = new Set<string>();
    for (const element of config) {
      for (const [id, severity] of Object.entries(element.rules ?? {})) {
        if (!isOff(severity)) enabled.add(id);
      }
    }

    const unresolved = [...enabled].filter((id) => id.includes("/") && !defined.has(id));
    expect(unresolved, `enabled but defined by no plugin in this config: ${unresolved.join(", ")}`).toEqual(
      [],
    );
  });

  it("parses every entry under ## Standards to the three-line shape", () => {
    const lines = readFileSync(join(REPO_ROOT, "CODING_STANDARDS.md"), "utf8").split("\n");
    const start = lines.findIndex((line) => line.trim() === STANDARDS_HEADING);
    expect(start, "CODING_STANDARDS.md carries no ## Standards heading").toBeGreaterThan(-1);

    // Every list item under the heading has to be an entry — the check is that nothing there is a
    // bullet the format does not describe, because a malformed append is exactly what a ratifier
    // batch can leave behind and exactly what the revert detector cannot see.
    const malformed: string[] = [];
    let names = 0;
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].startsWith("- ")) continue;
      const head = ENTRY_HEAD.exec(lines[i]);
      if (!head) {
        malformed.push(lines[i]);
        continue;
      }
      if (!ENTRY_WHY.test(lines[i + 1] ?? "") || !ENTRY_RED_FLAG.test(lines[i + 2] ?? "")) {
        malformed.push(lines[i]);
        continue;
      }
      names++;
    }

    expect(malformed, `not in the "**Name** — what. / Why: … / Red flag: …" shape:\n${malformed.join("\n")}`)
      .toEqual([]);
    expect(names, "CODING_STANDARDS.md carries no parseable entry at all").toBeGreaterThan(0);
  });
});
