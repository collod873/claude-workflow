# A lane that spends a model queues behind itself rather than cancelling, and one with no concurrency group gets one

Recorded 2026-08-29.

`cancel-in-progress: true` on a job holding a paid model call throws that call away, and the run
history records it as `cancelled` — which reads as though a human pressed stop rather than as the
lane killing itself. Five Spec runs on #233 died this way between 18:31 and 20:27 on 2026-08-29,
each one killed by the next critic comment landing on the same issue; two Acceptance runs on the
same publish went the same way. So a lane that spends a model sets `cancel-in-progress: false` and
a second event queues behind the first, which is what `integrate.yml` and `audit.yml` have always
said and for the same reason: work already paid for is not a thing a later run should discard.

The other half of the same defect is having no `concurrency:` block at all, where the two runs
neither queue nor cancel but both complete and both act — `to-tickets.yml` slicing one PRD into two
sets of sub-issues, `release-on-prd-close.yml` opening two release pull requests for one close. So
a lane that spends a model **or** performs a write declares a group, keyed on the subject it acts
for (ADR-0108's rule, applied to the two lanes that ticket did not claim).

Both rules are guards in `shared/workflow-permissions.test.ts` rather than a convention, derived the
way the permissions guards beside them are: from `npm install -g @anthropic-ai/claude-code@` and the
`secrets.CLAUDE_CODE_OAUTH_TOKEN` binding for the first, and from `reachableWrites` for the second.
A substring sweep for `CLAUDE_CODE_OAUTH_TOKEN` would not do — `release-on-prd-close.yml` names that
secret in a header comment explaining why it needs no preflight.

[ADR-0108](0108-implementer-concurrency-is-keyed-per-ticket-because-a-fixed.md) ruled on the *key* of
a group and left the *cancel* alone; lane 04's near-identical loss was fixed by re-keying its group
(`ed3e603`) on that reading, which fixed which runs share a group and did nothing for the runs that
legitimately share one. This ADR is the other half, and does not disturb that key rule.

## Consequences

Queueing keeps both answers where cancelling kept one. A Spec issue that draws three fast-follow
critic comments now pays for three rounds and posts three sheets, where before it paid for three and
posted one. That is the trade this ADR makes deliberately: the estate's failure mode was losing
answers it had already bought, and a duplicate sheet is visible and cheap to read past, while a
`cancelled` run is invisible and was costing diagnosis time as well as money. GitHub queues at most
one pending run per group and replaces the pending one on the next event, so a burst of N comments
costs two rounds, not N.
