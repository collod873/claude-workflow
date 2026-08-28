import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Knip's question here is not "is this code imported?" — the test suite imports nearly all of it,
 * and #183 is the record of what that answer is worth. It is "does anything a *venue* runs reach
 * this?", where a venue is a workflow lane, a `bin/` script, or a Claude Code hook. Everything
 * else is reachable only from tests, which is the exact shape of the five components #183 found
 * built, unit-tested, and wired to nothing.
 *
 * So the entry set is not written down. It is read, on every run, out of the three places that
 * actually invoke this repo's TypeScript — a hand-maintained list would drift the silent way, by
 * keeping an entry for a lane that no longer exists and thereby vouching for the dead code that
 * lane still reaches.
 */

const REPO_ROOT = import.meta.dirname;

/** Every `.Workflow/…​.ts` path named anywhere in a file — how all three venues spell an invocation. */
const INVOCATION = /\.Workflow\/[A-Za-z0-9/._-]+\.ts/g;

function filesIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(REPO_ROOT, dir));
  } catch {
    return [];
  }
  return names
    .map((name) => join(dir, name))
    .filter((path) => statSync(join(REPO_ROOT, path)).isFile());
}

/**
 * The venues. `.github/workflows` is the lanes, `bin` is what a human or the gauntlet runs by hand,
 * `.claude/hooks` is what fires in a session. A `.ts` file named by none of them is not something
 * this repo can run, whatever its test file says.
 */
const venueFiles = [...filesIn(".github/workflows"), ...filesIn("bin"), ...filesIn(".claude/hooks")];

const invoked = new Set<string>();
for (const file of venueFiles) {
  const text = readFileSync(join(REPO_ROOT, file), "utf8");
  for (const match of text.matchAll(INVOCATION)) invoked.add(match[0]);
}

/**
 * The hooks are `.mjs` that Claude Code launches by path through `gauntlet.sh` — no import edge
 * reaches them from anything, so they have to be named as entries or they read as dead.
 */
const hookEntries = filesIn(".claude/hooks").filter((path) => path.endsWith(".mjs"));

/** `!` marks a pattern production-only; without it `--production` resolves to an empty project. */
const production = (paths: string[]) => paths.map((path) => `${path}!`);

export default {
  entry: production([...hookEntries, ...[...invoked].sort()]),
  project: ["**/*.{js,mjs,ts}!"],

  /**
   * The two settings that make this find anything. `includeEntryExports` because a lane's entry
   * file is a script, not a published API — `review.ts` exporting `runConformanceReview` that
   * `main()` never calls is the finding, and knip's default is to trust an entry file's exports.
   * `ignoreExportsUsedInFile` because an export a module only calls itself is a style note about
   * a stray `export` keyword, and burying twenty of those is how the two real ones get skimmed.
   */
  includeEntryExports: true,
  ignoreExportsUsedInFile: true,

  /** Fakes and fixtures exist for the suite. Being unreachable from a lane is their job. */
  ignore: ["**/*.fake.ts", "**/*.fixture.ts", "**/*.stub.ts", "**/*.fixtures/**", "**/*.setup.ts"],

  /**
   * Two escape hatches, both requiring the export to say in prose why it is exempt, because a
   * silent entry in an ignore list here is indistinguishable from the dead code this check exists
   * to find. `@shell` is a real production caller knip cannot see (a subprocess, a dynamic
   * `import()` from a shell heredoc); `@fixture` is a builder the suite alone is meant to reach.
   */
  tags: ["-shell", "-fixture"],

  /**
   * `execFileSync("bin/gauntlet", …)` and `execFileSync("bin/new-adr", …)` — knip reads an
   * extensionless argv[0] as an unresolved import. They are subprocesses, not module edges.
   */
  ignoreUnresolved: ["bin/gauntlet", "bin/new-adr"],
};
