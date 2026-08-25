import { z } from "zod";
import { Observation } from "./observation-schema";

/**
 * A released finding whose fix is a lint rule with zero other hits and a
 * green suite (spec #36 §Solution) — mechanisable, so it arrives on the
 * release branch as a diff already applied and committed rather than a
 * decision for the owner to make. `release.ts`'s composer never applies
 * this diff itself; it is applied (and committed, `Machinery-Commit: true`)
 * before the batch reaches the composer, and is visible in the PR's own
 * diff view rather than restated in its body.
 */
export const MechanisedFinding = z.object({
  observation: Observation,
  /** The diff already applied to the release branch for this finding. */
  diff: z.string().min(1),
});

export type MechanisedFinding = z.infer<typeof MechanisedFinding>;

/**
 * A released finding with no possible mechanical proof — a prose
 * `CODING_STANDARDS.md` candidate, a judgement call — so it arrives in the
 * release PR body as a checklist item for the owner to decide, and nothing
 * is applied to the branch on its behalf.
 */
export const ProseFinding = z.object({
  observation: Observation,
  /** The checklist line's text: what the owner is being asked to decide. */
  checklistItem: z.string().min(1),
});

export type ProseFinding = z.infer<typeof ProseFinding>;

/**
 * One release's selected observations — spec #36 slice 7's scoped,
 * triggered release, filtered by slice 8's ratification memory — split into
 * the two halves the release PR treats differently: `mechanised` findings
 * already applied as a diff, and `prose` findings listed as a checklist
 * (spec #36 §Solution: "a new lint rule with zero other hits and a green
 * suite auto-merges... a prose standard has no possible proof and waits in
 * the PR"). Either half may be empty; a batch with both empty is not
 * release-eligible at all (`release.ts`'s `composeRelease` makes no `gh`
 * call for it).
 */
export const ReleaseBatch = z.object({
  mechanised: z.array(MechanisedFinding),
  prose: z.array(ProseFinding),
});

export type ReleaseBatch = z.infer<typeof ReleaseBatch>;
