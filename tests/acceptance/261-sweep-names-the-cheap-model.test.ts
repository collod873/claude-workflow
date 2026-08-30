import { describe, expect, it } from "vitest";
import {
  callOfKind,
  flagValue,
  readSource,
  runSweepProbe,
  sweepCall,
  SWEEP_SOURCE,
} from "./261-spec-sweep.fixture";

/**
 * #261, criterion 2.
 *
 * The model is asserted on the argv as well as in the source, for the reason lane 01 records beside
 * its own three: a stage that does not name one silently costs whatever the CLI defaults to, and a
 * constant nothing passes to `runStage` looks exactly like one that does.
 */
const CHEAP_MODEL = "claude-haiku-4-5-20251001";
const AUTHOR_MODEL = "claude-opus-5";

describe("#261 — the sweep's model", () => {
  // The sweep names the same cheap model lane 01's own first stage names — check: `grep -q 'claude-haiku-4-5-20251001' .Workflow/agent-workflows/spec/sweep.ts`
  it("names claude-haiku-4-5-20251001 in sweep.ts", () => {
    expect(readSource(SWEEP_SOURCE)).toContain(CHEAP_MODEL);
  });

  // The sweep names the same cheap model lane 01's own first stage names — check: `grep -q 'claude-haiku-4-5-20251001' .Workflow/agent-workflows/spec/sweep.ts`
  it("passes that model to the stage it runs, while the author keeps the expensive one", () => {
    expect(flagValue(sweepCall().argv, "--model")).toBe(CHEAP_MODEL);

    // This is the first stage in this lane that is not Opus — so the author beside it still is,
    // and the cheap stage is a new one rather than the author downgraded.
    const author = callOfKind(runSweepProbe().cold, "author");
    expect(author).toBeDefined();
    expect(flagValue(author?.argv ?? [], "--model")).toBe(AUTHOR_MODEL);
  }, 600_000);
});
