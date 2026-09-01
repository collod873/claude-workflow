---
status: constraint
date: 2026-08-27
reversal: Undoing it means rewriting both modes of `bin/new-adr`, the `draft-` exclusions in `generate-corpus-fixture.ts` and `missing-trailer-counter.ts`, and the fixture regeneration in `shape/accept.ts` and `watchdog/back-stamp-walk.ts`, while re-admitting the collision that already produced two ADR-0077s across two disks — and the `--land` gesture is documented outside this repo, in agent-skills' ADR-FORMAT.md.
---

# An ADR number is claimed when the ADR lands, not when it is drafted, because two authors write into docs/adr and neither sees the other's uncommitted work

`bin/new-adr "a ruling"` writes `docs/adr/draft-<slug>.md`, carrying no number; `--land` fetches `origin/main`, renames onto the next free number, and regenerates the corpus fixture. The number is claimed at the land, against the record both authors share.

`docs/adr/` has had two authors since the accept lane began filing on a runner: the owner's checkout and a hosted clone. Numbering from the highest number on *this* disk held only while there was one disk — an uncommitted `0077` collided with the lane's. A numberless draft is also invisible to every reader selecting on `ADR_FILENAME_RE`, so work-in-progress no longer reddens the gauntlet.

**Rejected:** numbering against `origin/main` — stable but not unique, since an unpushed draft is invisible to the remote too; a shared counter, which is network state to reconcile. Collision detection survives as a backstop.

**Accepted cost.** A seconds-wide race between fetch and push remains, and every author writing `docs/adr/` owes the fixture.
