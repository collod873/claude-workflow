import { describe, expect, it } from "vitest";
import {
  bodyWrites,
  lastBody,
  type MarkedDecision,
  probeLane,
  RESOLUTIONS,
  specBody,
  stageResponse,
} from "./262-critic-pen.fixture";

/**
 * The criterion this file is the acceptance test for, verbatim:
 *
 * - [ ] A draft carrying no resolutions and no unfiled marks runs no reconciler stage — check: `npx vitest run .Workflow/agent-workflows/spec/spec.test.ts`
 *
 * A guard is only observable as a pair, so both arms are here: a run carrying a resolution spends
 * the stage and writes the section, and a run carrying neither a resolution nor an unfiled mark
 * spends nothing and writes nothing. The first arm is what stops the second from being true of a
 * lane that has no reconciler at all.
 */

const FILED: MarkedDecision = {
  question: "who files the accept's rulings?",
  recommendation: "the accept",
  rejected: "the shaper",
  mark: "shape/accept.ts",
  adrTitle: "The accept files its own rulings",
};

const BODY = specBody();

describe("#262 — the reconciler runs when there is something to fold in", () => {
  it("A draft carrying no resolutions and no unfiled marks runs no reconciler stage", () => {
    // Arm one, the control: a draft the critic resolved something on pays for the stage.
    const folded = probeLane(
      { door: "critique", specBody: BODY },
      stageResponse(BODY, RESOLUTIONS),
    );
    expect(folded.setupError).toBeNull();
    expect(folded.error).toBeNull();
    expect(lastBody(folded.calls) ?? "", "the resolutions were never folded in").toContain(
      "## Assumptions",
    );

    // Arm two, the criterion: nothing to fold in, so no second stage and no write. ADR-0100's "a
    // first-round clearance spends nothing", preserved with the list swapped.
    const clean = probeLane({ door: "critique", specBody: BODY }, stageResponse(BODY, []));
    expect(clean.setupError).toBeNull();
    expect(clean.error).toBeNull();
    expect(clean.stages).toHaveLength(1);
    expect(clean.stages.length).toBeLessThan(folded.stages.length);
    expect(bodyWrites(clean.calls)).toHaveLength(0);

    // And the same on the door that has marks to carry: every mark filed, nothing resolved, so the
    // published body is the author's own and no rewrite ever lands on it.
    const sheet = probeLane({ door: "sheet", decisions: [FILED] }, stageResponse(BODY, []));
    expect(sheet.setupError).toBeNull();
    expect(sheet.error).toBeNull();
    expect(bodyWrites(sheet.calls).filter((write) => write.verb === "edit")).toHaveLength(0);
    expect(lastBody(sheet.calls) ?? "").not.toContain("## Assumptions");
  }, 900_000);
});
