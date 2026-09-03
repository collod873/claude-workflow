import { describe, expect, it } from "vitest";
import { readIfPresent } from "./275-checkpoint-wiring.fixture";
import { commandLine, runVitest } from "./274-stage-names.fixture";
import {
  GAUNTLET,
  GAUNTLET_RELATIVE,
  TIMING_BASELINE_TEST_RELATIVE,
  TIMING_BASELINE_TS,
  TIMING_BASELINE_TS_RELATIVE,
  linesMatching,
} from "./357-timing.fixture";

/**
 * #357, criterion 4 — the stop venue stops being a share of a measured suite and becomes a hard
 * wall that only ever chooses files.
 *
 * Three things, none of which can be true of the tree before this ticket lands:
 *
 * - Neither the script nor the module still carries `STOP_FILE_SHARE`. That constant *is* the share
 *   of a measured suite the ticket replaces, and a wall that still consults it is not a wall.
 * - One of them names the wall. The ticket fixes the number at 5000 ms and does not say which of
 *   the two files holds it, so both are read and every ordinary spelling of the number is accepted
 *   — pinning a home or a punctuation would be pinning something the ticket left to the implementer.
 * - The criterion's own check is green: `npx vitest run` over the module's suite, which is where the
 *   ticket puts the test that drives a file set over the wall and watches the overflow move to push.
 *
 * The wall is looked for in both files rather than one because the selection is spelled across
 * both: `bin/gauntlet` chooses which test files it runs, and the per-file times it chooses from come
 * out of the module.
 */

/** The share of a measured suite the wall replaces. */
const STOP_FILE_SHARE = /STOP_FILE_SHARE/;

/** 5000 ms, however it is ordinarily written. */
const WALL = /\b5_?000\b|\b5\s*\*\s*1_?000\b|\b5e3\b/;

describe("#357 the stop venue", () => {
  // The stop venue admits test files under a hard 5000 ms wall and returns a selection rather than
  it(
    "admits test files under a hard 5000 ms wall and returns a selection, not a verdict",
    () => {
      const script = readIfPresent(GAUNTLET);
      const module = readIfPresent(TIMING_BASELINE_TS);

      expect(script.length, `${GAUNTLET_RELATIVE} is not in the tree`).toBeGreaterThan(0);
      expect(
        module.length,
        `${TIMING_BASELINE_TS_RELATIVE} is not in the tree`,
      ).toBeGreaterThan(0);

      expect(
        linesMatching(script, STOP_FILE_SHARE).concat(linesMatching(module, STOP_FILE_SHARE)),
        "the stop venue is still a share of a measured suite rather than a hard wall",
      ).toEqual([]);

      expect(
        WALL.test(script) || WALL.test(module),
        `neither ${GAUNTLET_RELATIVE} nor ${TIMING_BASELINE_TS_RELATIVE} names a 5000 ms wall`,
      ).toBe(true);

      const run = runVitest([TIMING_BASELINE_TEST_RELATIVE], 900_000);
      expect(
        run.status,
        `\`${commandLine([TIMING_BASELINE_TEST_RELATIVE])}\` is red:\n${run.output}`,
      ).toBe(0);
    },
    1_200_000,
  );
});
