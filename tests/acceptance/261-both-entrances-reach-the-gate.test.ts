import { describe, expect, it } from "vitest";
import { labelWrites } from "./237-spec-pass.fixture";
import {
  describeCalls,
  indexOfKind,
  runSweepProbe,
  runVitest,
  SPEC_TEST_PATH,
  type DoorProbe,
} from "./261-spec-sweep.fixture";

/**
 * #261, criterion 7.
 *
 * The gate is the only thing lane 03 fires on, and inserting a stage ahead of the author is exactly
 * the kind of change that can strand one door short of it. So both entrances are driven end to end
 * — the sheet door through the collector, the sweep, the author and the critic; the session door
 * straight at the critic — and each is held to the two writes the gate makes at a zero count.
 */
const SLICEABLE = "sliceable";

/** Whether a run asked for the `repository_dispatch` lane 03 fires on. */
function dispatched(calls: string[][]): boolean {
  return calls.some((call) => call[0] === "api" && call.some((arg) => arg.includes("dispatches")));
}

/** The gate's two writes: the durable label, then the dispatch it says was owed. */
function expectReachedTheGate(door: DoorProbe): void {
  expect(door.error).toBeNull();
  expect(door.result?.outcome).toBe("dispatched");
  expect(labelWrites(door.gh).added).toContain(SLICEABLE);
  expect(dispatched(door.gh)).toBe(true);
}

describe("#261 — both of lane 02's entrances", () => {
  // Both entrances still reach the gate with the sweep inserted ahead of the author — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`
  it("labels and dispatches from the sheet door, with the sweep run ahead of the author", () => {
    const { cold } = runSweepProbe();

    expectReachedTheGate(cold);

    const sweep = indexOfKind(cold, "sweep");
    const author = indexOfKind(cold, "author");
    expect(
      sweep,
      `no stage named the sweep's model — the door ran ${describeCalls(cold)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(sweep).toBeLessThan(author);
  }, 600_000);

  // Both entrances still reach the gate with the sweep inserted ahead of the author — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`
  it("labels and dispatches from the door a spec written in a session enters by", () => {
    const { warm } = runSweepProbe();

    expectReachedTheGate(warm);

    // That door has no author to run a sweep ahead of, so it still spends its one critic stage.
    expect(indexOfKind(warm, "critic")).toBeGreaterThanOrEqual(0);
  }, 600_000);

  // Both entrances still reach the gate with the sweep inserted ahead of the author — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`
  it("passes lane 02's own test file with the sweep in the chain", () => {
    const run = runVitest(SPEC_TEST_PATH);

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  }, 600_000);
});
