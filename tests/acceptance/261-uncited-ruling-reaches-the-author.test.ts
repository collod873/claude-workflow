import { describe, expect, it } from "vitest";
import {
  callOfKind,
  describeCalls,
  expectVitestPasses,
  MARKS,
  runSweepProbe,
  SWEEP_TEST_PATH,
} from "./261-spec-sweep.fixture";

/**
 * #261, criterion 4.
 *
 * The probe's sheet cites one ruling and one only. The sweep's own return carries a different one,
 * quoted, whose text nothing upstream contains — so its arrival in the author's stage can only have
 * come through the field the sweep fills. That is the whole of the PRD's case for this stage: the
 * predecessor spec argued against a ruling nobody upstream had thought to cite.
 */
describe("#261 — a ruling the collectors forgot", () => {
  // A ruling no upstream sheet or map cited still reaches the author as rulings — check: `npx vitest run .Workflow/agent-workflows/spec/sweep.test.ts`
  it("hands the author a filed ruling no upstream collector cited", () => {
    const { cold, collector } = runSweepProbe();

    expect(cold.error).toBeNull();

    // The sweep-only ruling is genuinely uncited upstream: the collector's own rulings field,
    // computed from the same sheet and the same accept, says nothing about it.
    expect(collector.rulings ?? "").not.toContain(MARKS.quote);

    const author = callOfKind(cold, "author");
    expect(author, `the door ran ${describeCalls(cold)}`).toBeDefined();

    // Nothing else this run was given carries this text — not the owner's words, not the sheet,
    // not the accept — so the author can only have been handed it as rulings.
    expect(author?.blob ?? "").toContain(MARKS.quote);
  }, 600_000);

  // A ruling no upstream sheet or map cited still reaches the author as rulings — check: `npx vitest run .Workflow/agent-workflows/spec/sweep.test.ts`
  it("passes the sweep's own test file", () => {
    expectVitestPasses(SWEEP_TEST_PATH);
  }, 600_000);
});
