# Six of era 6's eleven verbs do not survive the map, and two survive only as local human verbs

Recorded 2026-08-26.

Every era-6 pipeline verb was held against `DESIGN.md`'s nine lanes, in one pass, before the skill
inventory was read. This is that ruling, filed as a record because the section carrying it is
removed by [#75](https://github.com/collod873/claude-workflow/issues/75) and because two of its
verdicts live nowhere else.

| Verb | Lands on | Verdict |
|---|---|---|
| `/to-tickets` | Lane 03 | **Ported.** Live, on a runner |
| `/to-spec` | Lane 02 | **Port.** Local-only today, which makes it a keystroke gate on every unit of work |
| `/implement` | Lane 05 | **Port**, narrowed. Its brief becomes ticket + seam manifest + failing tests, never the repo |
| `/grilling` | Local session | **Keep, unported** |
| `/wayfinder` | Local session | **Keep, unported** |
| `/triage` | Lane 00/01 boundary | **Absorbed.** Capture files, the shaper interprets. A separate triage verb is a third name for one edge |
| `/standards-pass` → `/ratify` → `/standards` | §6, the lens audit | **Absorbed**, and built. Two lenses — violation and proposed — shipped by spec [#36](https://github.com/collod873/claude-workflow/issues/36) and firing automatically since [#63](https://github.com/collod873/claude-workflow/issues/63) |
| `/drain` | — | **Delete** |
| `/converge` | — | **Delete** |
| `/sync-skills` | — | **Delete** |
| `/ask-matt` | — | **Delete** |

## The count, corrected

`DESIGN.md` §9 read *"five of eleven verbs do not survive."* **That number is wrong and is not
ported.** The table is eleven rows covering thirteen verb names — the standards chain is three verbs
in one row. Six rows do not survive: **four deleted outright, and two absorbed into mechanisms that
are not verbs.** Five was reachable only by counting the deletions and one of the two absorptions.

The finding the number was carrying is unharmed, and is the reason the map was drawn before the
inventory was read: **not one of the six is bad.** Each answers a question this map answers
differently or does not have.

## Why each deletion

- **`/drain`** — a batch worker with worktrees, a foreman and a merge loop *on the workstation* is
  [ADR-0002](0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)'s exact
  prohibition. Lanes 05 and 08 are what it was for: the governor dispatches, the warden serialises.
  Its open defects are defects in a thing that does not survive the map.
- **`/converge`** — bringing a machine back to the GitHub backups is only necessary because state
  lives on a machine. `DESIGN.md` §1 forbids that.
- **`/sync-skills`** — vendoring an upstream skill tree and re-applying deltas is a grooming
  obligation with ~60 rows of divergence to maintain. C4.
- **`/ask-matt`** — an entry point recommending which flow fits exists because there are eleven
  flows. There are nine lanes and the label picks.

## Why two verbs stay human, and stay local

This is the half of the ruling that had no other home, and it is the reason this ADR covers all
eleven verdicts rather than the deletions alone. A *keep, unported* has no lane section to fold into.

- **`/grilling`** — grilling needs the owner's answers by construction. An unattended grilling agent
  grills itself. Lane 01 replicates the part that *is* automatable — walk the decision tree,
  recommend on each — and escalates here when it cannot.
- **`/wayfinder`** — destination and scope, including the ticket budget, are named in `GOAL.md` §2 as
  where the human deliberately stays. It is not an edge, and it should stay a local, human-fired
  verb.

## Consequences

- `DESIGN.md` §9 is removed; this ADR is the record.
- `/implement`'s narrowing is already carried by §05's implementer row and is not orphaned.
- `/triage`'s absorption is carried by lanes 00 and 01.

## What would reverse this

A deleted verb's job reappearing without a lane to land on — which would mean the map missed an edge,
and would be a new ADR naming which.
