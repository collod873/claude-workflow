import { describe, expect, it } from "vitest";
import {
  CLONE_BASELINE,
  CORPUS_FIXTURE,
  TIMING_BASELINE,
  chosenAttempt,
  describeProbe,
  regenerateProbe,
  seededMatching,
} from "./349-timing-baseline.fixture";

/**
 * ADR-0139's rule is that a target owes nothing but its contract, and `regenerateArtifacts` reads
 * that as "regenerate only what is already here". #349 carves out one artifact from that gate: an
 * absent timing baseline is not a check switched off, so it gets seeded — while the corpus fixture
 * and the clone baseline, which are judgements a target opts into, stay present-only.
 *
 * So the run is made against a target carrying nothing but `.claude/contract.json`, and what is
 * asserted is what it left behind: a timing baseline that was not there before, and no corpus
 * fixture and no clone baseline that were not there before either.
 *
 * The artifacts are matched by name rather than by path, because the ticket fixes no root for any
 * of them.
 */
describe("regenerate-artifacts, at a target carrying only its contract", () => {
  // `regenerate-artifacts.ts` seeds an absent timing baseline at a target that carries a
  // `.claude/contract.json`, while the corpus fixture and clone baseline keep the present-only
  // gate — check: `npx vitest run .Workflow/agent-workflows/implement/regenerate-artifacts.test.ts`
  it("seeds the absent timing baseline, and seeds no corpus fixture and no clone baseline", () => {
    const probe = regenerateProbe();
    const attempt = chosenAttempt(probe);
    const seeded = attempt?.seeded ?? [];

    const timing = seededMatching(seeded, TIMING_BASELINE);
    expect(
      timing.length > 0
        ? "a timing baseline was seeded"
        : `no timing baseline was seeded at the target.\n${describeProbe(probe)}`,
    ).toBe("a timing baseline was seeded");

    // The other two artifacts keep the gate exactly as it is: absent before, absent after.
    expect(seededMatching(seeded, CORPUS_FIXTURE)).toEqual([]);
    expect(seededMatching(seeded, CLONE_BASELINE)).toEqual([]);
  });
});
