# Pipeline labels

The pipeline's canonical label vocabulary — four entries survived
ADR-0004 (recorded in `collod873/agent-skills`)'s rewrite, each asserting
only *where work sits*, never a readiness verdict. This file maps them to the actual label strings
used in this repo's issue tracker.

| Canonical label | Label in our tracker | Meaning                                                                                                |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `fuzzy`          | `fuzzy`               | An open question — no acceptance criteria can be written from the issue alone yet; applied by `~/bin/file-issue question` |
| `needs-human`    | `needs-human`         | An agent tried and stopped — a criterion still unmet after one fix pass, or the merge gate rejected the same merge twice |
| `prd`            | `prd`                 | A spec someone else could build from, produced by `/to-spec`                                           |
| `wayfinder:*`    | `wayfinder:*`         | `/wayfinder`'s own labels: `wayfinder:map`, `wayfinder:research`/`prototype`/`grilling`/`task`, `wayfinder:dest-spec`, `wayfinder:dest-decision` |

When a skill mentions one of these roles, use the corresponding label string from this table.

**Absence of any of the above — and no `## Acceptance criteria` in the body — means
*not yet judged*, never a fifth role. Nothing sweeps that state automatically: ADR-0032 retired the
unattended on-ramp that used to, so an unjudged issue waits for whichever session picks it up to
run `~/bin/file-issue ticketify`.

The six labels ADR-0004 (recorded in `collod873/agent-skills`) deleted — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`, and `bug`/`enhancement` as triage output — are never seeded here.

Edit the middle column to match whatever vocabulary you actually use — the label *strings* are yours
to rename, the *meanings* are fixed by the skills that read and write them.
