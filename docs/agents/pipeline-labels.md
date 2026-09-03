# Pipeline labels

The pipeline's canonical label vocabulary: four entries, each asserting only *where work sits*,
never a readiness verdict. This file maps them to the actual label strings used in this repo's
issue tracker.

| Canonical label | Label in our tracker | Meaning                                                                                                |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `fuzzy`          | `fuzzy`               | An open question; no acceptance criteria can be written from the issue alone yet; applied by `~/bin/file-issue question` |
| `needs-human`    | `needs-human`         | An agent tried and stopped: a criterion still unmet after one fix pass, or the merge gate rejected the same merge twice |
| `prd`            | `prd`                 | A spec someone else could build from, produced by `/to-spec`                                           |
| `wayfinder:*`    | `wayfinder:*`         | `/wayfinder`'s own labels: `wayfinder:map`, `wayfinder:research`/`prototype`/`grilling`/`task`, `wayfinder:dest-spec`, `wayfinder:dest-decision` |

When a skill mentions one of these roles, use the corresponding label string from this table.

**Absence of any of the above, and no `## Acceptance criteria` in the body, means
*not yet judged*, never a fifth role.** Nothing sweeps that state automatically: there is no
unattended on-ramp, so an unjudged issue waits for whichever session picks it up to run
`~/bin/file-issue ticketify`.

Six older labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`,
and `bug`/`enhancement` as triage output) were retired because each recorded a verdict rather
than a position. They are never seeded here.

Edit the middle column to match whatever vocabulary you actually use: the label *strings* are yours
to rename, the *meanings* are fixed by the skills that read and write them.

## Hand-offs

Two more labels are **imperatives**, not positions: each one hands work to a named lane, and only
the repository owner's own hand applies either. They are not readiness verdicts, so the rule above
is intact: `to-spec` says *spec this*, `to-build` says *build this now*.

| Label      | Applied by                 | Read by                                                       | Means                                                                 |
| ---------- | -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `to-spec`  | the owner, by hand         | `.github/workflows/spec-caller.yml` -> lane 02                  | Spec this accepted idea or closed Wayfinder Map (ADR-0059)             |
| `to-build` | the owner, by hand         | `.github/workflows/dispatch-reconcile-caller.yml` -> lane 09's recompute -> lane 06 | Build this hand-written ticket now, without the spec chain (#184) |

`to-build` is the one term nothing can infer from a body: **intent to build now**. Ticket *shape* is
not it (plenty of ticket-shaped issues are not wanted built), so the reconciler admits an issue
either because lane 03 published it (`## Parent PRD`) or because this label is on it, and refuses,
in one comment, a labelled issue missing `## Acceptance criteria` or `## Files claimed`. Nothing
removes the label: the `implement/issue-N` branch is already the started-ness claim, so a labelled
ticket that is running will not start twice.
