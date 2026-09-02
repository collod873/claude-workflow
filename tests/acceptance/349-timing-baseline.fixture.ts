import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTsDriver, subjectPath } from "./ts-driver.fixture";

/**
 * The reader #349's two `regenerate-artifacts.ts` criteria share: it runs the real
 * `regenerateArtifacts` against a bare temp target in a child process, and hands back every file
 * the run left behind.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by the two test files beside it.
 *
 * **Why a child process.** CI restores `tests/acceptance/` from trunk before running it, and
 * restores only that directory — so a test that imported the subject would be reaching through a
 * specifier the branch under test controls, and an implementer could satisfy the criteria by
 * editing the thing reached rather than by building the ticket. The subject is reached the way a
 * shell reaches it instead: a generated driver, run from the checkout root, importing
 * `regenerate-artifacts.ts` by an absolute path built at runtime. The runner ladder that does the
 * spawning already lives next door in `ts-driver.fixture.ts`, so it is imported rather than
 * restated.
 *
 * **Why one fixture rather than one copy per test.** Both criteria ask the same question of the
 * same run — *given a target carrying nothing but `.claude/contract.json`, what did
 * `regenerateArtifacts` write?* — and differ only in whether they read the seeded file's name or its
 * contents. Two copies of a driver is two sets of divergent bugs about the same temp venue, which
 * is the duplication this directory's fixture convention exists to prevent.
 *
 * Two things this probe deliberately does not assume:
 *
 * - **Where the artifacts live.** The ticket names `timing-baseline.json`, the corpus fixture and
 *   the clone baseline without fixing a root for any of them, so the probe reports every file the
 *   run left at the target and the assertions match on the artifact's *name*. Pinning a root would
 *   be pinning something the ticket left open, and the implementer is reading the same sentence.
 * - **How `regenerateArtifacts` is called.** The ticket names the function, not its signature, so
 *   the driver tries a short ladder of call shapes against a freshly rebuilt target and reports
 *   every one of them. It stops at the first shape that seeds a timing baseline; when none does,
 *   every attempt is in the report, which is what a red criterion should print. The ladder cannot
 *   make a wrong implementation pass — a run that seeds nothing fails whichever shape reached it.
 *
 * The target is deliberately bare: a `.claude/contract.json` and nothing else, no `package.json`
 * and no checkout, so a regeneration that probes for a target's checks finds nothing to run and the
 * probe stays a probe about seeding rather than about npm.
 */

const SENTINEL = "__ACCEPTANCE_349__";

/** The module #349 claims, as an absolute path built at runtime. */
export const REGENERATE_SOURCE = subjectPath(
  ".Workflow",
  "agent-workflows",
  "implement",
  "regenerate-artifacts.ts",
);

/** The test file both criteria's own check command names. */
export const REGENERATE_TEST_RELATIVE =
  ".Workflow/agent-workflows/implement/regenerate-artifacts.test.ts";

/** The artifact this ticket makes seedable, matched by name however it is spelled. */
export const TIMING_BASELINE = /timing[-_. ]?baseline/i;

/** The two artifacts whose present-only gate stays exactly as it is. */
export const CORPUS_FIXTURE = /corpus/i;
export const CLONE_BASELINE = /clone/i;

/** One call shape the driver tried, and what the target looked like afterwards. */
export interface RegenerateAttempt {
  /** The call shape, spelled the way the driver made it. */
  shape: string;
  /** The throw, when the call threw — `null` when it returned. */
  threw: string | null;
  /** Every file at the target afterwards that the fixture did not write, target-relative. */
  seeded: string[];
  /** Each seeded file's text, by its target-relative path; `null` when it could not be read. */
  texts: Record<string, string | null>;
}

export interface RegenerateProbe {
  imported: boolean;
  /** Why the module could not be imported — a fact about the run, not about the ticket. */
  importError: string | null;
  /** What the module exports, so a missing `regenerateArtifacts` prints what was there instead. */
  exportNames: string[];
  attempts: RegenerateAttempt[];
  /** The attempt the assertions read: the one that seeded, else the first that returned. */
  chosen: number;
  error?: string;
}

/**
 * The driver, written to a temp file and run from the checkout root. Plain JavaScript in an `.mts`
 * file so it is ESM under every runner the ladder tries.
 */
const DRIVER_SOURCE = `
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SENTINEL = "${SENTINEL}";
const subject = process.env.ACCEPTANCE_SUBJECT;
const root = process.env.ACCEPTANCE_ROOT;

const emit = (payload) => process.stdout.write("\\n" + SENTINEL + JSON.stringify(payload) + "\\n");

// The one file the fixture puts at the target: what makes it a target at all.
const WROTE = [".claude/contract.json"];

function reset() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, ".claude"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude", "contract.json"),
    JSON.stringify({ checks: {} }, null, 2) + "\\n",
    "utf8",
  );
}

function walk(dir, prefix, out) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

function seededFiles() {
  const found = [];
  walk(root, "", found);
  return found.sort().filter((rel) => WROTE.indexOf(rel) === -1);
}

function textOf(rel) {
  try {
    const text = readFileSync(path.join(root, rel), "utf8");
    return text.length > 200000 ? null : text;
  } catch (err) {
    return null;
  }
}

const quiet = () => {};
const noop = async () => "";

// Every name the one root argument could plausibly ride in on, all set to the same directory, and
// inert seams beside them. Extra keys cost nothing; a missing one would be a probe that failed for
// a reason having nothing to do with the ticket.
const bag = {
  root: root,
  targetRoot: root,
  target: root,
  dir: root,
  cwd: root,
  path: root,
  log: quiet,
  logger: quiet,
  exec: noop,
  run: noop,
};

const shapes = [
  ["regenerateArtifacts(root)", (fn) => fn(root), false],
  ["regenerateArtifacts(root, deps)", (fn) => fn(root, bag), false],
  ["regenerateArtifacts(deps)", (fn) => fn(bag), false],
  ["regenerateArtifacts() from the target root", (fn) => fn(), true],
];

const here = process.cwd();
const attempts = [];
let chosen = -1;

try {
  const mod = await import(pathToFileURL(subject).href);
  const fn =
    typeof mod.regenerateArtifacts === "function" ? mod.regenerateArtifacts : mod.default;
  if (typeof fn !== "function") {
    emit({
      imported: true,
      importError: null,
      exportNames: Object.keys(mod),
      attempts: [],
      chosen: -1,
    });
  } else {
    for (const shape of shapes) {
      reset();
      let threw = null;
      try {
        if (shape[2]) process.chdir(root);
        await shape[1](fn);
      } catch (err) {
        threw = String((err && err.stack) || err);
      } finally {
        process.chdir(here);
      }
      const seeded = seededFiles();
      const texts = {};
      for (const rel of seeded) texts[rel] = textOf(rel);
      attempts.push({ shape: shape[0], threw: threw, seeded: seeded, texts: texts });
      const timed = seeded.some((rel) => /timing[-_. ]?baseline/i.test(rel));
      if (timed) {
        chosen = attempts.length - 1;
        break;
      }
      if (chosen === -1 && threw === null) chosen = attempts.length - 1;
    }
    emit({
      imported: true,
      importError: null,
      exportNames: Object.keys(mod),
      attempts: attempts,
      chosen: attempts.length === 0 ? -1 : chosen === -1 ? 0 : chosen,
    });
  }
} catch (err) {
  emit({
    imported: false,
    importError: String((err && err.stack) || err),
    exportNames: [],
    attempts: [],
    chosen: -1,
  });
}
`;

let cached: RegenerateProbe | undefined;

/**
 * Runs `regenerateArtifacts` against a fresh bare target and reports what it left there.
 *
 * Memoised per test file, so each of the two criteria spends one child process rather than one per
 * assertion.
 */
export function regenerateProbe(): RegenerateProbe {
  if (cached !== undefined) return cached;

  const root = mkdtempSync(path.join(os.tmpdir(), "acceptance-349-target-"));
  try {
    cached = runTsDriver<RegenerateProbe>({
      source: DRIVER_SOURCE,
      sentinel: SENTINEL,
      prefix: "acceptance-349-",
      env: { ACCEPTANCE_SUBJECT: REGENERATE_SOURCE, ACCEPTANCE_ROOT: root, CI: "1" },
      failure: "could not run regenerateArtifacts out of process",
    });
    return cached;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The attempt the assertions read, or `null` when no call shape ever reached the subject. */
export function chosenAttempt(probe: RegenerateProbe): RegenerateAttempt | null {
  if (probe.chosen < 0 || probe.chosen >= probe.attempts.length) return null;
  return probe.attempts[probe.chosen];
}

/** The files a run seeded whose path names the artifact `pattern` matches. */
export function seededMatching(seeded: readonly string[], pattern: RegExp): string[] {
  return seeded.filter((rel) => pattern.test(rel));
}

function firstLine(text: string): string {
  return text.split("\n")[0];
}

/**
 * What the probe actually did, as one string — so a criterion that goes red prints which call
 * shapes were tried, which of them threw, and what each one left at the target.
 */
export function describeProbe(probe: RegenerateProbe): string {
  const lines: string[] = [];

  if (!probe.imported) {
    lines.push(
      `${REGENERATE_SOURCE} could not be imported: ${probe.importError ?? "(no reason given)"}`,
    );
  } else if (probe.attempts.length === 0) {
    const exports = probe.exportNames.join(", ");
    lines.push(
      `${REGENERATE_SOURCE} exports no regenerateArtifacts — it exports ${exports || "(nothing)"}`,
    );
  }

  for (const attempt of probe.attempts) {
    const ran = attempt.threw === null ? "returned" : `threw ${firstLine(attempt.threw)}`;
    const left = attempt.seeded.length === 0 ? "(no new file)" : attempt.seeded.join(", ");
    lines.push(`${attempt.shape}: ${ran}; left ${left}`);
  }

  return lines.join("\n");
}
