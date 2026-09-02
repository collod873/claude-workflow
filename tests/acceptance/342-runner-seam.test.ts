import { describe, expect, it } from "vitest";
import { commandLine, runVitest } from "./274-stage-names.fixture";

/**
 * #342's second criterion: the seam that lets `record` write the committed file on a runner belongs
 * to the regenerate step and to nothing else — a plain `bin/gauntlet push` on a runner still judges
 * and discards, the way ADR-0142 leaves it.
 *
 * **Why the check is spawned rather than performed here.** Two things this criterion is about
 * cannot be reached from this directory: `record`'s runner gate lives in a module
 * `tests/acceptance/` may not import, and actually running `bin/gauntlet push` to watch it write
 * nothing would run the whole gauntlet against this checkout. The criterion names the venue where
 * the behaviour is observable — `.claude/hooks/gauntlet.test.ts` — so that suite is spawned from
 * the checkout root and its verdict is the assertion. `274-stage-names.fixture.ts` already owns the
 * spawn-and-report, so it is imported rather than copied.
 *
 * Red until the ticket lands, because no seam exists yet for that suite to describe.
 */

/** The suite this criterion's own check command names, repo-relative, as the ticket spells it. */
const GAUNTLET_HOOK_TEST = ".claude/hooks/gauntlet.test.ts";

describe("#342 the runner write-seam belongs to the regenerate step alone", () => {
  // The seam that lets `record` write the committed file on a runner is set by the regenerate
  it("step alone, and a plain `bin/gauntlet push` on a runner still writes nothing", () => {
    const run = runVitest([GAUNTLET_HOOK_TEST], 900_000);

    const report =
      run.status === 0
        ? ""
        : `\`${commandLine([GAUNTLET_HOOK_TEST])}\` exited ${String(run.status)}:\n${run.output}`;

    expect(report).toBe("");
  }, 960_000);
});
