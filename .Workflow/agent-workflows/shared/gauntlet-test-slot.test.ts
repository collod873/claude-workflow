import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * [ADR-0101](../../../docs/adr/0101-an-expected-red-acceptance-test-is-not-a-local-finding-so-th.md):
 * the gauntlet's `test` slot stops at the code suite, because `tests/acceptance/` is expected red
 * until the ticket each test names is built and the local venues cannot tell that apart from a
 * finding.
 *
 * This asserts the routing off the two facts that actually produce it — what `npm test` sweeps, and
 * which files vitest therefore collects — rather than grepping the script for a string, so a
 * rewritten-but-equivalent command passes and an equivalent-looking one that quietly re-includes
 * `tests/acceptance/` does not.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");

interface PackageJson {
  scripts: Record<string, string>;
}

const pkg: PackageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

/** The files the given `vitest run` argv would collect, as repo-relative paths. */
function collected(args: string[]): string[] {
  const out = execFileSync("npx", ["vitest", "list", "--filesOnly", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    // The same generous ceiling `vitest.config.ts` sizes its own timeouts by: this spawns a real
    // vitest, and a shared runner is where a process spawn is slowest (ADR-0015).
    timeout: 120_000,
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".test.ts"))
    .map((line) => path.relative(repoRoot, path.resolve(repoRoot, line)));
}

describe("the gauntlet's test slot stops at the code suite", () => {
  it("sweeps the lane and hook suites but not tests/acceptance", () => {
    const vitestArgs = pkg.scripts.test.split("&&")[0].trim().replace(/^vitest run\s*/, "").split(/\s+/);
    const files = collected(vitestArgs);

    expect(files.length, "the code suite must not be empty — an empty filter passes vacuously").toBeGreaterThan(0);
    expect(files.some((f) => f.startsWith(".Workflow/"))).toBe(true);
    expect(files.some((f) => f.startsWith(".claude/"))).toBe(true);
    expect(
      files.filter((f) => f.startsWith("tests/acceptance/")),
      "an acceptance test is expected red until its ticket is built; the venue that judges one is " +
        "acceptance/push-gate.ts, not a turn-end gauntlet",
    ).toEqual([]);
  });

  it("keeps tests/acceptance runnable on demand, so routing it away is not dropping it", () => {
    expect(pkg.scripts["test:acceptance"]).toBeDefined();
    const files = collected(["tests/acceptance"]);
    expect(files.every((f) => f.startsWith("tests/acceptance/"))).toBe(true);
  });
});
