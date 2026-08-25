import { z } from "zod";

/**
 * The four verdicts `/standards-pass`'s ledger records against a candidate
 * (its own `## Ratification` section) — see
 * `~/.agents/skills/standards-pass/SKILL.md`. Only `declined` is read by
 * this module's filter today; the other three are stored for a decision to
 * be findable later without a schema migration.
 */
export const RatificationDecision = z.enum(["ratified", "declined", "superseded", "deferred"]);

export type RatificationDecision = z.infer<typeof RatificationDecision>;

/**
 * One ratified verdict against a finding, as ratification memory persists
 * it (spec #36 §4, "Ratification is memory"). `finding` is the same
 * identity string `Observation.finding` (./observation-schema.ts) and
 * `GatedProposedFinding.finding` (./lenses/proposed.ts) use — the join key
 * `filterByRatificationMemory` (./ratification.ts) matches a later run's
 * observations against.
 *
 * `sites` is the site list the decision was made against — "carry the site
 * list; that is what distinguishes 'recurred again' from 'grew'." `reason`
 * holds whatever free text explains the verdict (a declined reason, a
 * ratified rule's target file, a superseding slug, a deferred question) —
 * one field for all four, since none of it is read back by code, only by a
 * human re-deciding.
 */
export const RatificationRecord = z.object({
  finding: z.string().min(1),
  decision: RatificationDecision,
  sites: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});

export type RatificationRecord = z.infer<typeof RatificationRecord>;
