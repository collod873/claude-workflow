import { describe, expect, it } from "vitest";
import { readIfPresent } from "./275-checkpoint-wiring.fixture";
import {
  GAUNTLET,
  GAUNTLET_RELATIVE,
  TIMING_FAILURE,
  linesMatching,
} from "./357-timing.fixture";

/**
 * #357, criterion 2 — `bin/gauntlet` may still record a duration, and may no longer refuse on one.
 *
 * Asserted on the script's text, matched line by line, because that is exactly the grain the
 * criterion's own `grep -qE 'failed_names.*timing'` works at: what makes a duration a failed check
 * is the venue's failure list carrying `timing`, and that is a line a maintainer reads.
 *
 * Only the criterion's own spelling is matched. A reverse-order line — prose saying `timing` never
 * joins `failed_names` — is not what the criterion refuses, and matching it would put a comment a
 * faithful implementer might write between them and a green check.
 */

describe("#357 bin/gauntlet", () => {
  // Nothing in `bin/gauntlet` turns a duration into a failed check: the `record` call may stay, its
  it("turns no duration into a failed check at any venue", () => {
    const script = readIfPresent(GAUNTLET);
    expect(script.length, `${GAUNTLET_RELATIVE} is not in the tree`).toBeGreaterThan(0);

    expect(
      linesMatching(script, TIMING_FAILURE),
      `${GAUNTLET_RELATIVE} still adds timing to a venue's failures`,
    ).toEqual([]);
  });
});
