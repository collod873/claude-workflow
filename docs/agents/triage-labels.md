# Triage Labels

The pipeline's canonical label vocabulary — four entries survived
ADR-0004's rewrite (recorded in `collod873/agent-skills`), each asserting
only *where work sits*, never a readiness verdict. This file maps them to the actual label strings
used in this repo's issue tracker.

| Canonical label | Label in our tracker | Meaning                                                                                                |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `fuzzy`          | `fuzzy`               | An open question — `/triage` could not write this issue's acceptance criteria from the issue alone     |
| `needs-human`    | `needs-human`         | An agent tried and stopped — a criterion still unmet after one fix pass, or the merge gate rejected the same merge twice |
| `prd`            | `prd`                 | A spec someone else could build from, produced by `/to-spec`                                           |
| `wayfinder:*`    | `wayfinder:*`         | `/wayfinder`'s own labels: `wayfinder:map`, `wayfinder:research`/`prototype`/`grilling`/`task`, `wayfinder:dest-spec`, `wayfinder:dest-decision` |

When a skill mentions one of these roles, use the corresponding label string from this table.

**Absence of any of the above — and no `## Acceptance criteria` in the body — means *not yet judged***,
never a fifth role. That's `/triage`'s own backlog query, and it costs zero writes.

The six labels ADR-0004 deleted — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`, and `bug`/`enhancement` as triage output — are never seeded here. GitHub's stock set is
still present on the repo; it is not triage output.

This repo also writes four labels of its own — `slice-failed`, `close-refused`, `build-order`,
`standards-pass`. Those are state, not position, and nothing in the triage vocabulary reads them.
They are listed in `docs/agents/issue-tracker.md`.

Edit the middle column to match whatever vocabulary you actually use — the label *strings* are yours
to rename, the *meanings* are fixed by the skills that read and write them.
