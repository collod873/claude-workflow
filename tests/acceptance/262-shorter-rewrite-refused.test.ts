import { describe, expect, it } from "vitest";
import { labelWrites } from "./237-spec-pass.fixture";
import {
  bodyWrites,
  checkboxLines,
  CRITERIA,
  dispatches,
  probeLane,
  probeReconciler,
  reconcilerResponse,
  RESOLUTIONS,
  specBody,
  stageResponse,
} from "./262-critic-pen.fixture";

/**
 * The criterion this file is the acceptance test for, verbatim:
 *
 * - [ ] A rewrite returning fewer checkbox lines than it was given is refused with nothing written — check: `npx vitest run .Workflow/agent-workflows/spec/reconcile.test.ts`
 *
 * Asserted from both ends, because a stage that refuses everything satisfies the refusal half and
 * breaks the lane: the shorter rewrite is refused, the equal-length one goes through, and the
 * refusal reaches the tracker as nothing at all — no edit, no label, no dispatch.
 */

const LONG_BODY = specBody(CRITERIA);
const SHORT_BODY = specBody([CRITERIA[0]]);

describe("#262 — the pen's bound is arithmetic", () => {
  it("A rewrite returning fewer checkbox lines than it was given is refused with nothing written", () => {
    // The premise of the case, stated rather than assumed: the rewrite really is short by one.
    expect(checkboxLines(SHORT_BODY).length).toBeLessThan(checkboxLines(LONG_BODY).length);

    const refused = probeReconciler({
      body: LONG_BODY,
      resolutions: RESOLUTIONS,
      response: reconcilerResponse(SHORT_BODY),
    });

    expect(refused.error, "a rewrite that dropped a criterion was accepted").not.toBeNull();
    expect(refused.body).toBeNull();

    // The other end: the same stage, handed a rewrite that kept every checkbox line, returns a body.
    // Without this the criterion above is satisfied by a stage that refuses everything.
    const kept = probeReconciler({
      body: LONG_BODY,
      resolutions: RESOLUTIONS,
      response: reconcilerResponse(LONG_BODY),
    });
    expect(kept.error, "a rewrite that kept every criterion was refused").toBeNull();
    expect(checkboxLines(kept.body ?? "")).toHaveLength(checkboxLines(LONG_BODY).length);

    // "With nothing written": the refusal fails the run before the tracker is touched at all.
    const lane = probeLane(
      { door: "critique", specBody: LONG_BODY },
      stageResponse(SHORT_BODY, RESOLUTIONS),
    );

    expect(lane.setupError).toBeNull();
    expect(lane.error, "the run survived a rewrite that dropped a criterion").not.toBeNull();
    expect(bodyWrites(lane.calls)).toHaveLength(0);
    expect(labelWrites(lane.calls).added).not.toContain("sliceable");
    expect(dispatches(lane.calls)).toHaveLength(0);
  }, 900_000);
});
