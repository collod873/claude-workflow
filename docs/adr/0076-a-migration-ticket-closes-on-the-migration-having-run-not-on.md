# A migration ticket closes on the migration having run, not on the script existing

Recorded 2026-08-27.

Spec #134 read COMPLETED with two of its three user stories false. Every ticket beneath it was
honest by its own wording — #141 and #142 each said *"Ship a script that…"*, and each shipped one,
tested, green. Nobody ran either. The close gate checks that a ticket's children are closed and
that each child's criteria are checked off; a criterion of the form `npm test -- scrub.test.ts`
exits 0 is satisfiable without the migration ever touching the thing it was written to migrate.

So: a ticket whose deliverable is a migration is **worded as the run**, never as the artifact, and
carries at least one acceptance criterion asserting the **post-state of the target** — checkable
against the real thing rather than against a fixture the ticket's own test builds. A suite passing
proves the script works. It never proves the script ran.

## Considered options

- **Trust the wording.** Rejected — this *was* the status quo. Three tickets under one spec drifted
  to artifact-shaped criteria independently, which makes it a property of how the shape reads, not
  of who wrote it.
- **Refuse artifact-shaped criteria at `file-issue` time.** Rejected. "Is this a migration?" is a
  judgement, and a refusal that is wrong in the *deny* direction stops legitimate filing dead.
- **Warn, and put the rule in the doc every producer already reads.** Chosen. `bin/ticket_shape.py`
  (`collod873/agent-skills`) warns when a migration-shaped body's every criterion is satisfied by a
  test passing or by a path the ticket itself claims, the same severity as its existing
  no-evidence and unresolved-claim warnings.

## Consequences

The detector is deliberately half-blind, and says so: it fires only on migration vocabulary, so
#136 — a *provisioning* step that closed the same way, on `audit.yml` naming a deploy key that had
never been created — is not caught by it. Provisioning is the same disease and wants its own
ruling; this one is scoped to what #141 and #142 demonstrated.
