import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A workflow that checks out must say so in its `permissions:` block.
 *
 * Declaring a `permissions:` block does not add to the default token — it
 * **replaces** it, and every scope left out is set to `none`. So a workflow
 * that lists only what its own logic needs ends up with a token that cannot
 * clone the repository it runs in, and on a private repo `actions/checkout`
 * fails with `remote: Repository not found` — a message that names an access
 * problem as a missing repository, three retries deep, before the workflow
 * reaches a line of its own code.
 *
 * `run-watchdog.yml` (#41) died exactly this way on its first real run, having
 * listed `actions: read` and `issues: write` and nothing else. This is the
 * same class as #109: a permission omission that no local venue can see,
 * because there is no local venue where a token exists at all. So it gets the
 * same treatment — a guard derived from what each workflow does, rather than
 * a fix in the one file that happened to hit it.
 */

const WORKFLOWS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows");

/** A `permissions:` block at the top level of the file, which replaces the default token entirely. */
const DECLARES_PERMISSIONS = /^permissions:\s*$/m;

/** `contents:` granted at either level — `read` for a clone, `write` for a push. */
const GRANTS_CONTENTS = /^ {2}contents: (read|write)$/m;

/** Any step that clones the repo. */
const CHECKS_OUT = /uses: actions\/checkout@/;

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({ name, source: readFileSync(join(WORKFLOWS_DIR, name), "utf8") }));

describe("a workflow that checks out grants itself contents", () => {
  it.each(workflows)("$name", ({ name, source }) => {
    if (!CHECKS_OUT.test(source) || !DECLARES_PERMISSIONS.test(source)) return;

    expect(
      GRANTS_CONTENTS.test(source),
      `${name} runs actions/checkout and declares a permissions: block without contents — that block ` +
        "replaces the default token rather than adding to it, so the checkout will fail with " +
        "`remote: Repository not found` before the workflow reaches any of its own steps",
    ).toBe(true);
  });

  it("actually finds the workflows that check out, so a passing suite is not an empty sweep", () => {
    const checkingOut = workflows.filter(({ source }) => CHECKS_OUT.test(source));

    expect(checkingOut.length).toBeGreaterThanOrEqual(3);
    // Every one of them also declares permissions today, so none of the cases above is skipped.
    for (const { name, source } of checkingOut) {
      expect(DECLARES_PERMISSIONS.test(source), `${name} declares no permissions block`).toBe(true);
    }
  });
});
