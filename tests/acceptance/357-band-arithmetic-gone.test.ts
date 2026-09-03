import { describe, expect, it } from "vitest";
import { readIfPresent } from "./275-checkpoint-wiring.fixture";
import {
  BAND_IDENTIFIERS,
  TIMING_BASELINE_TS,
  TIMING_BASELINE_TS_RELATIVE,
  linesMatching,
} from "./357-timing.fixture";

/**
 * #357, criterion 3 — the band, the arithmetic that judged against it, and the write seam that let
 * a runner commit a budget are all out of `shared/timing-baseline.ts`.
 *
 * The raw text is read, comments and all, because that is what the criterion's own `grep` reads: an
 * implementation that leaves `budgetFor` in a docstring fails its own check, so a reader that
 * stripped comments first would be looser than the criterion.
 *
 * `MIN_SLACK_MS` is asserted beside the four the check names because it is the band's floor and the
 * ticket lists it in what goes; "the band and its arithmetic are gone" is not true of a module that
 * still carries it.
 *
 * The module itself has to still be there — the stop venue's file selection stays in it, and
 * criterion 4's check runs its suite — so an empty read is a failure rather than a pass.
 */

/** The band's slack floor, named in the ticket's own list of what goes. */
const BAND_SLACK = /MIN_SLACK_MS/;

describe("#357 shared/timing-baseline.ts", () => {
  // The band and its arithmetic are gone from
  it("carries no band, no arithmetic over one, and no seam that commits a budget", () => {
    const source = readIfPresent(TIMING_BASELINE_TS);
    expect(
      source.length,
      `${TIMING_BASELINE_TS_RELATIVE} is not in the tree, and the stop venue's file selection lives in it`,
    ).toBeGreaterThan(0);

    expect(
      linesMatching(source, BAND_IDENTIFIERS),
      `${TIMING_BASELINE_TS_RELATIVE} still carries the band, its arithmetic, or the write seam`,
    ).toEqual([]);

    expect(
      linesMatching(source, BAND_SLACK),
      `${TIMING_BASELINE_TS_RELATIVE} still carries the band's slack floor`,
    ).toEqual([]);
  });
});
