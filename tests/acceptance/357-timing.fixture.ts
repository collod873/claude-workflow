import path from "node:path";
import { type CommandRun, runFromRoot } from "./276-required-stage.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The paths, patterns and guarded runner #357's seven acceptance tests share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by the test files beside it. `.fixture.ts` is the name
 * this directory already gives a file whose job is to be unreachable from a lane.
 *
 * It exists because every one of this ticket's criteria is a claim about one of four artifacts —
 * the committed baseline, `bin/gauntlet`, `shared/timing-baseline.ts` and `docs/agents/venues.md` —
 * and the last criterion is a claim about *all* of them at once. Written into each test file that
 * would be seven copies of the same four paths and the same three patterns to get subtly different
 * from each other, which is the divergence this directory's fixture convention exists to prevent
 * and which `bin/clone-gate` reports on push.
 *
 * **Nothing here imports outward.** CI restores `tests/acceptance/` from trunk and restores only
 * that directory, so a test that imported `timing-baseline.ts` would be reaching through a
 * specifier the branch under test controls. The subjects are reached the way a shell reaches them:
 * read as text, or spawned from the checkout root. The spawn-and-report itself already lives next
 * door in `276-required-stage.fixture.ts`, so it is called rather than restated.
 *
 * **Why the patterns are the criteria's own greps.** Two of #357's criteria close on a `grep` over
 * a file's text, so what they assert is the text a `grep` matches — a normalising reader would be
 * asserting something looser than the ticket asks for. They are matched line by line, because that
 * is the grain `grep -E` works at.
 */

/** The artefact criterion 1 deletes, spelled the way its own `test ! -f` spells it. */
export const TIMING_BASELINE_JSON_RELATIVE =
  ".Workflow/agent-workflows/shared/timing-baseline.json";

export const TIMING_BASELINE_JSON = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "timing-baseline.json",
);

/** The directory the baseline sat in — walked so a relocated baseline is still a baseline. */
export const SHARED_DIR = path.join(repoRoot, ".Workflow", "agent-workflows", "shared");

/** The module the band and the write seam come out of, and which the stop wall stays in. */
export const TIMING_BASELINE_TS_RELATIVE = ".Workflow/agent-workflows/shared/timing-baseline.ts";

export const TIMING_BASELINE_TS = path.join(SHARED_DIR, "timing-baseline.ts");

/** The suite criterion 4's own check command names, as the criterion spells it. */
export const TIMING_BASELINE_TEST_RELATIVE =
  ".Workflow/agent-workflows/shared/timing-baseline.test.ts";

export const GAUNTLET_RELATIVE = "bin/gauntlet";

export const GAUNTLET = path.join(repoRoot, "bin", "gauntlet");

export const VENUES_DOC_RELATIVE = "docs/agents/venues.md";

export const VENUES_DOC = path.join(repoRoot, "docs", "agents", "venues.md");

/** What every gauntlet run leaves at the target root — gitignored, overwritten, judged by nothing. */
export const TIMINGS_ARTIFACT_RELATIVE = ".gauntlet-timings.json";

export const TIMINGS_ARTIFACT = path.join(repoRoot, ".gauntlet-timings.json");

/** Criterion 2's own grep: a duration turned into a failed check. */
export const TIMING_FAILURE = /failed_names.*timing/;

/** Criterion 3's own grep: the band, its arithmetic, and the seam that let a runner commit one. */
export const BAND_IDENTIFIERS = /DEFAULT_MARGIN_PCT|budgetFor|ratchetFloor|WRITE_VENUE_ENV/;

/** Criterion 6's own grep: the word a venue's budget is written in. */
export const BUDGET_WORD = /budget/i;

/**
 * The lines of `text` matching `pattern`, each prefixed with its line number — so a failed absence
 * assertion names what was found rather than only that something was.
 *
 * The pattern is rebuilt without `g` so a caller cannot hand in a regex whose `lastIndex` makes
 * every other line invisible.
 */
export function linesMatching(text: string, pattern: RegExp): string[] {
  const match = new RegExp(pattern.source, pattern.flags.replace(/g/g, ""));
  return text
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => match.test(entry.line))
    .map((entry) => `${entry.number}: ${entry.line.trim()}`);
}

/**
 * The marker a spawned check carries, so a nested acceptance run does not spawn the same check
 * again.
 *
 * Two of these criteria run a command that may itself run this directory's suite — `npm run check`
 * plainly, `bin/gauntlet turn` possibly — and a criterion that re-entered itself would not be a
 * slow test, it would be a runner that never finishes. The child inherits the marker, so the copy
 * of the test inside the child stands down and the outer run is the one that judges.
 */
export const NESTED_ENV = "ACCEPTANCE_357_NESTED";

/** Whether this process is already running inside a check one of these criteria spawned. */
export function isNestedRun(): boolean {
  return process.env[NESTED_ENV] === "1";
}

/**
 * Runs a command from the checkout root with `env` layered over this process's, and the nesting
 * marker set.
 *
 * The layering is done on `process.env` around the call rather than by passing an environment
 * through, because `runFromRoot` already merges `process.env` and already strips the runner's own
 * markers so a spawned suite starts a clean run — widening the call beats restating the runner.
 */
export function runGuarded(
  command: string,
  args: string[],
  timeout: number,
  env: Record<string, string> = {},
): CommandRun {
  const layered: Record<string, string> = { [NESTED_ENV]: "1", ...env };
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(layered)) {
    saved[key] = process.env[key];
    process.env[key] = layered[key];
  }
  try {
    return runFromRoot(command, args, timeout);
  } finally {
    for (const key of Object.keys(saved)) {
      const previous = saved[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}
