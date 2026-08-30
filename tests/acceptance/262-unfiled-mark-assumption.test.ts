import { describe, expect, it } from "vitest";
import {
  assumptionsSection,
  lastBody,
  type MarkedDecision,
  probeLane,
  specBody,
  stageResponse,
} from "./262-critic-pen.fixture";

/**
 * The criterion this file is the acceptance test for, verbatim:
 *
 * - [ ] A sheet's unfiled load-bearing mark reaches the assumptions section — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`
 *
 * Driven through the whole sheet door — collector, author, critic, reconciler, publication —
 * because the seam this criterion is about is the hand-off between them: ADR-0061's arithmetic
 * keeps its input and changes its consumer, from the gate to the writer, and a unit test either
 * side of that hand-off is what missed the last one for as long as it did.
 *
 * The critic resolves nothing here, so the mark is the only thing that can put an assumptions
 * section in the body.
 */

const UNFILED: MarkedDecision = {
  question: "which module owns the retry?",
  recommendation: "the caller",
  rejected: "the transport",
  mark: "shared/gh.ts",
  adrTitle: "",
};

const FILED: MarkedDecision = {
  question: "who files the accept's rulings?",
  recommendation: "the accept",
  rejected: "the shaper",
  mark: "shape/accept.ts",
  adrTitle: "The accept files its own rulings",
};

describe("#262 — the mark accounting outlives the gate", () => {
  it("A sheet's unfiled load-bearing mark reaches the assumptions section", () => {
    const body = specBody();
    const lane = probeLane(
      { door: "sheet", decisions: [UNFILED, FILED] },
      stageResponse(body, []),
    );

    expect(lane.setupError).toBeNull();
    expect(lane.error).toBeNull();

    const published = lastBody(lane.calls);
    expect(published, "the sheet door wrote no body to the tracker").toBeDefined();

    const section = assumptionsSection(published ?? "");
    expect(section, "the published body carries no `## Assumptions` heading").not.toBeNull();
    expect(section ?? "").toContain(UNFILED.mark);

    // Only the unfiled one. A decision carrying a filed ruling was ruled on, not guessed, and
    // listing it as an assumption is how a guess list stops being readable.
    expect(section ?? "").not.toContain(FILED.mark);
  }, 600_000);
});
