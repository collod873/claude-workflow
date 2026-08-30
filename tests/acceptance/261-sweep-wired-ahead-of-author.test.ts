import { describe, expect, it } from "vitest";
import {
  describeCalls,
  indexOfKind,
  readSource,
  runSweepProbe,
  SPEC_SOURCE,
} from "./261-spec-sweep.fixture";

/**
 * #261, criterion 1.
 *
 * Two halves, because the criterion has two: the check command's own claim about `spec.ts`, and the
 * behaviour the phrase "ahead of the author" is about — that the cold door actually spends a stage
 * before the one carrying the author's allow-list and Opus model.
 */
describe("#261 — the sweep ahead of lane 02's author", () => {
  // The sweep is wired into lane 02's chain ahead of the author — check: `grep -q 'runSpecSweep' .Workflow/agent-workflows/spec/spec.ts`
  it("names runSpecSweep in the module that owns lane 02's chain", () => {
    expect(readSource(SPEC_SOURCE)).toContain("runSpecSweep");
  });

  // The sweep is wired into lane 02's chain ahead of the author — check: `grep -q 'runSpecSweep' .Workflow/agent-workflows/spec/spec.ts`
  it("runs the sweep stage before the author stage on the sheet door", () => {
    const { cold } = runSweepProbe();

    expect(cold.error).toBeNull();

    const sweep = indexOfKind(cold, "sweep");
    const author = indexOfKind(cold, "author");

    // The author is the stage carrying `--allowedTools` and `claude-opus-5`; the sweep is the one
    // naming the cheap model. A door that ran no cheap stage at all reports -1 here.
    expect(
      sweep,
      `no stage named the sweep's model — the door ran ${describeCalls(cold)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(author).toBeGreaterThanOrEqual(0);
    expect(sweep).toBeLessThan(author);
  }, 600_000);
});
