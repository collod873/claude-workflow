import { describe, expect, it } from "vitest";
import {
  assumptionsSection,
  checkboxLines,
  lastBody,
  probeLane,
  probeReconciler,
  reconcilerResponse,
  RESOLUTIONS,
  specBody,
  stageResponse,
  TRICKY_CRITERIA,
} from "./262-critic-pen.fixture";

/**
 * The criterion this file is the acceptance test for, verbatim:
 *
 * - [ ] Criteria stay matchable verbatim against the body after a rewrite — check: `npx vitest run .Workflow/agent-workflows/spec/reconcile.test.ts`
 *
 * This is the guarantee lane 04's re-entry trigger depends on: `affectedSlices` diffs a slice's
 * test-named criteria against the spec body verbatim, so a criterion that came back re-wrapped,
 * re-indented or re-punctuated is a criterion lane 04 reads as lost. The rewrite under test is one
 * that folds an assumptions section in, because that is the edit most able to break it silently.
 */

const BODY = specBody(TRICKY_CRITERIA);

describe("#262 — a fold that leaves the criteria alone", () => {
  it("Criteria stay matchable verbatim against the body after a rewrite", () => {
    const probe = probeReconciler({
      body: BODY,
      resolutions: RESOLUTIONS,
      response: reconcilerResponse(BODY),
    });

    expect(probe.error).toBeNull();
    const written = probe.body ?? "";

    // The rewrite this criterion is about is one that actually folded something in.
    expect(assumptionsSection(written), "nothing was folded into the body").not.toBeNull();

    const lines = written.split("\n");
    for (const criterion of TRICKY_CRITERIA) {
      expect(lines, `criterion is no longer a verbatim line: ${criterion}`).toContain(criterion);
    }

    // And the assumptions arrive as prose, not as checkboxes: an assumption written as `- [ ]` is a
    // criterion to everything downstream that counts them.
    expect(checkboxLines(written)).toEqual(TRICKY_CRITERIA);

    // The same guarantee where lane 04 actually reads it — the body on the tracker, after the write.
    const lane = probeLane(
      { door: "critique", specBody: BODY },
      stageResponse(BODY, RESOLUTIONS),
    );

    expect(lane.setupError).toBeNull();
    expect(lane.error).toBeNull();

    const published = lastBody(lane.calls);
    expect(published, "the run wrote no body to the tracker").toBeDefined();
    const publishedLines = (published ?? "").split("\n");
    for (const criterion of TRICKY_CRITERIA) {
      expect(
        publishedLines,
        `the published body no longer matches verbatim: ${criterion}`,
      ).toContain(criterion);
    }
  }, 900_000);
});
