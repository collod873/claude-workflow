import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every seam that spawns a child process sets `maxBuffer`.
 *
 * Node's default is 1 MB, and a child whose output exceeds it dies on
 * `spawnSync <cmd> ENOBUFS` — an error naming neither the command, nor the
 * size, nor the call that asked for too much. It is a cliff rather than a
 * slope: the seam works for months and then one listing crosses a megabyte.
 *
 * `git.ts` was given a 10 MB buffer. `gh.ts` was not, and the run watchdog's
 * first working run died reading one page of run objects (#41). That is the
 * third time in this repo a fix has been made in one file and not in its
 * sibling — after the dispatch name (#107) and the runner's git identity
 * (#109) — so it gets the same answer those did: a guard that holds every
 * seam to it, rather than a second file brought level and left to drift again.
 */

const SHARED_DIR = dirname(fileURLToPath(import.meta.url));

/** A seam is a shared module that spawns a child process synchronously. */
const SPAWNS = /execFileSync\(/;

const SETS_MAX_BUFFER = /maxBuffer:/;

/**
 * The source with its comments removed. `scrub-git-env.setup.ts` explains
 * the `execFileSync` shape the fixture tests use, in prose, and spawns
 * nothing itself — a guard that read that as a call would be asking a
 * comment to set a buffer.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const seams = readdirSync(SHARED_DIR)
  .filter((name) => name.endsWith(".ts") && !name.includes(".test.") && !name.includes(".fake."))
  .map((name) => ({ name, source: code(readFileSync(join(SHARED_DIR, name), "utf8")) }))
  .filter(({ source }) => SPAWNS.test(source));

describe("every exec seam sets maxBuffer", () => {
  it("finds the seams, so a passing suite is not an empty sweep", () => {
    expect(seams.map(({ name }) => name).sort()).toEqual(expect.arrayContaining(["gh.ts", "git.ts"]));
  });

  it.each(seams)("$name", ({ name, source }) => {
    expect(
      SETS_MAX_BUFFER.test(source),
      `${name} spawns a child without setting maxBuffer — Node's 1 MB default makes any output past ` +
        "it exit `ENOBUFS`, an error that names neither the command nor the size",
    ).toBe(true);
  });
});
