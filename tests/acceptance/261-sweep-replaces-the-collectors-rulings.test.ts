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
 * #261, criterion 5.
 *
 * Replacement is observable exactly where appending would not be: the accepted sheet cites one ADR
 * path and the sweep cites another, so a field that replaced carries only the sweep's and a field
 * that appended carries both. Asserted from both ends — what must arrive, and what must not.
 */
describe("#261 — the sweep's result and the collector's rulings", () => {
  // The sweep's result replaces the collector's rulings rather than appending to them — check: `npx vitest run .Workflow/agent-workflows/spec/sweep.test.ts`
  it("hands the author the sweep's rulings and not the collector's", () => {
    const { cold, collector } = runSweepProbe();

    expect(cold.error).toBeNull();

    const author = callOfKind(cold, "author");
    expect(author, `the door ran ${describeCalls(cold)}`).toBeDefined();
    const handed = author?.blob ?? "";

    expect(handed).toContain(MARKS.quote);

    // The one ruling the accept did cite. Two sources writing one field is how they come to
    // disagree, so the upstream citation is gone rather than sitting beside the sweep's.
    expect(handed).not.toContain(MARKS.collectorAdrPath);

    const collected = (collector.rulings ?? "").trim();
    if (collected.length > 0) {
      expect(handed).not.toContain(collected);
    }
  }, 600_000);

  // The sweep's result replaces the collector's rulings rather than appending to them — check: `npx vitest run .Workflow/agent-workflows/spec/sweep.test.ts`
  it("passes the sweep's own test file", () => {
    expectVitestPasses(SWEEP_TEST_PATH);
  }, 600_000);
});
