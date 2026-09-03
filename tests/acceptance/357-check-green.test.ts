import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readIfPresent } from "./275-checkpoint-wiring.fixture";
import { failureReport } from "./276-required-stage.fixture";
import {
  BAND_IDENTIFIERS,
  BUDGET_WORD,
  GAUNTLET,
  TIMING_BASELINE_JSON,
  TIMING_BASELINE_JSON_RELATIVE,
  TIMING_BASELINE_TS,
  TIMING_FAILURE,
  VENUES_DOC,
  isNestedRun,
  linesMatching,
  runGuarded,
} from "./357-timing.fixture";

/**
 * #357, criterion 7 — the repo's own check is green *with all of the above in place*.
 *
 * Both halves are asserted, in that order, because only both together are the criterion. `npm run
 * check` on its own is green on a tree where nothing has been removed yet, so a test that spawned it
 * and stopped would be one that passed before the ticket and passed after it — proving nothing
 * either time. The cheap half runs first so a red criterion says which piece of the ticket is
 * missing rather than costing a full check to find out.
 *
 * The spawn carries the nesting marker, so a copy of this suite running inside `npm run check`
 * stands down instead of spawning another one.
 */

describe("#357 the repo's own check", () => {
  // `npm run check` is green with all of the above in place — check: `npm run check`
  it(
    "is green with the baseline deleted, the band gone and the budget out of the docs",
    () => {
      // Inside a `npm run check` this criterion already spawned, running it again would never end.
      if (isNestedRun()) return;

      expect(
        existsSync(TIMING_BASELINE_JSON),
        `${TIMING_BASELINE_JSON_RELATIVE} is still in the tree`,
      ).toBe(false);
      expect(
        linesMatching(readIfPresent(TIMING_BASELINE_TS), BAND_IDENTIFIERS),
        "the band is still in shared/timing-baseline.ts",
      ).toEqual([]);
      expect(
        linesMatching(readIfPresent(GAUNTLET), TIMING_FAILURE),
        "bin/gauntlet still turns a duration into a failed check",
      ).toEqual([]);
      expect(
        linesMatching(readIfPresent(VENUES_DOC), BUDGET_WORD),
        "docs/agents/venues.md still gives a venue a budget",
      ).toEqual([]);

      const run = runGuarded("npm", ["run", "check"], 1_800_000);
      expect(failureReport("npm run check", run)).toBe("");
    },
    2_100_000,
  );
});
