import { describe, expect, it } from "vitest";
import { commandLine, runVitest } from "./274-stage-names.fixture";

/**
 * #342's first criterion: the committed `venues.push` half is produced by lane 05's regenerate
 * step, and it gets there by running the push venue on the runner — a number measured in the
 * venue, on the runner class that will judge it — rather than by `writeSuiteTiming`'s solo suite
 * measurement, which since ADR-0142 writes `suite` and never `venues`.
 *
 * **Why this is a spawned check rather than an import.** `timing-baseline.ts` lives outside
 * `tests/acceptance/`, and CI restores this directory from trunk and only this directory — a test
 * that imported the subject would be reaching through a specifier the branch under test controls,
 * which the boundary rule refuses outright. So the subject is reached the way a shell reaches it:
 * the criterion's own check command is spawned from the checkout root and what it did is read back.
 * The spawn-and-report already lives beside this file in `274-stage-names.fixture.ts`, so it is
 * imported rather than restated.
 *
 * Red until the ticket lands, because today nothing in that suite describes a regenerate step that
 * produces a venue entry at all.
 */

/** The suite this criterion's own check command names, repo-relative, as the ticket spells it. */
const TIMING_BASELINE_TEST = ".Workflow/agent-workflows/shared/timing-baseline.test.ts";

describe("#342 lane 05's regenerate step writes the committed venue half", () => {
  // Lane 05's regenerate step produces a committed `venues.push` entry for every push check by
  it("running the push venue on the runner, so the timing baseline's own suite is green", () => {
    const run = runVitest([TIMING_BASELINE_TEST], 900_000);

    const report =
      run.status === 0
        ? ""
        : `\`${commandLine([TIMING_BASELINE_TEST])}\` exited ${String(run.status)}:\n${run.output}`;

    expect(report).toBe("");
  }, 960_000);
});
