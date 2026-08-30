import { describe, expect, it } from "vitest";
import {
  assumptionsSection,
  probeReconciler,
  reconcilerResponse,
  RESOLUTIONS,
  specBody,
} from "./262-critic-pen.fixture";

/**
 * The criterion this file is the acceptance test for, verbatim:
 *
 * - [ ] The reconciler folds the critic's resolutions into the body under a `## Assumptions` heading — check: `npx vitest run .Workflow/agent-workflows/spec/reconcile.test.ts`
 *
 * The faked model returns a body carrying no assumptions section, so the section in the value
 * `runSpecReconciler` resolves to is the lane's doing and not the model's. That is the only reading
 * of this criterion a caller can observe: a heading the prompt merely asks for is fail-open, and
 * there is no longer an owner reading the output to notice it went missing.
 */

describe("#262 — the reconciler writes the guesses down", () => {
  it("The reconciler folds the critic's resolutions into the body under a `## Assumptions` heading", () => {
    const body = specBody();
    const probe = probeReconciler({
      body,
      resolutions: RESOLUTIONS,
      // The model hands back the body it was given — unchanged, and carrying no assumptions of its
      // own. Anything under the heading below is the reconciler's own writing.
      response: reconcilerResponse(body),
    });

    expect(probe.error, "runSpecReconciler refused a resolutions payload").toBeNull();

    const written = probe.body ?? "";
    const section = assumptionsSection(written);
    expect(section, "the rewritten body carries no `## Assumptions` heading").not.toBeNull();

    // One line each, carrying the reason: four user stories rest on the reason being there, and a
    // decision whose reason lives somewhere else in the document is a coin flip nobody can grade.
    for (const resolution of RESOLUTIONS) {
      const line = (section ?? "")
        .split("\n")
        .find((candidate) => candidate.includes(resolution.decision));
      expect(line, `no assumption line carries: ${resolution.decision}`).toBeDefined();
      expect(line ?? "").toContain(resolution.reason);
    }
  }, 600_000);
});
