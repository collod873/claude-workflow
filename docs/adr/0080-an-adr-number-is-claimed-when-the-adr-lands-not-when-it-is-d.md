# An ADR number is claimed when the ADR lands, not when it is drafted, because two authors write into docs/adr and neither sees the other's uncommitted work

Recorded 2026-08-27.

`bin/new-adr "a ruling"` writes `docs/adr/draft-<slug>.md`, carrying no number. `bin/new-adr --land
docs/adr/draft-<slug>.md` fetches `origin/main`, renames the draft onto the next free number, and
regenerates the corpus fixture. The number is claimed at the second step, against the record both
authors share, as late as the author can claim it.

## The collision this answers

`docs/adr/` has had two authors since the accept lane began filing on a runner
([ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md)): the owner's
checkout and a hosted runner holding a fresh clone of `origin/main`. Numbering from *the highest
number on the disk this runs on* was correct for exactly as long as there was one disk.

It broke the way it had to. An uncommitted `0077` sat in the owner's working tree while the lane,
which cannot see it and never could, filed its own `0077`. Nothing detected the collision — it
surfaced only because an unrelated fixture test went red
([#146](https://github.com/collod873/claude-workflow/issues/146)).

**The number was claimed against the wrong corpus, and no amount of looking harder at the wrong
corpus fixes that.** Reading `origin/main` at draft time does not either: the owner's draft is
unpushed by definition, so the runner cannot see it whether it asks the disk or the remote. The
only thing that moves is *when*. A number claimed immediately before the commit that pushes it is
claimed against a corpus that is seconds old and shared; a number claimed when a file is created
is claimed against whatever the author happened to be looking at, which may be days stale and is
private either way.

## A draft with no number is also the answer to the second half of #146

`adr-corpus.evidence.json` is generated from `docs/adr/` and compared byte-for-byte at
`bin/gauntlet push`, so an uncommitted ADR failed the suite at every venue. The only way to hold a
work-in-progress ruling was to keep the gauntlet red, which trains the habit the gauntlet exists to
prevent.

That falls out of this rule rather than needing one of its own. Every reader of the corpus already
selects on the filename shape — `ADR_FILENAME_RE` wants four digits — so a draft carrying no number
is invisible to `generate-corpus-fixture.ts` and to `missing-trailer-counter.ts` without either of
them learning a new rule. A research note has no numeric shape to fail, so those two readers
exclude a `draft-` prefix explicitly; that is the one place this ruling costs a line of code.

**The rule stated once, for both: a draft is not yet part of the record.** What makes it part of the
record is landing it, and landing it is what claims the number.

## Considered options

- **Number against `origin/main` instead of the disk.** Rejected: it makes a number *stable* without
  making it *unique*, because the case that actually happened — an unpushed draft the other author
  cannot see — is invisible to the remote too. It also leaves the working-tree half of #146
  untouched, so it buys one mechanism and still owes a second.
- **Claim numbers from a shared counter — a ref, a label, an issue.** Rejected on cost against the
  thing it buys. It is a network round-trip and a piece of state to reconcile, and it closes a race
  window that landing already narrows to seconds.
- **Let both authors collide and detect it at the push.** Rejected as the shape
  [ADR-0044](0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md) rules against:
  it makes the repair a thing a human does after being told, where landing makes the collision not
  happen. Kept as the *backstop* — `--land` refuses a number already taken on disk.
- **Number at the land.** Chosen.

## Consequences

**A residual race survives, and it is seconds wide rather than days.** Two authors that both land
between each other's fetch and push still take the same number. `--land` fetches immediately before
the rename and refuses a number already present, which closes everything except the window between
that fetch and the push that follows it. Widening the fix past that is machinery for a case this
repo has not had and would not detect faster than the next `git pull`.

**Landing regenerates the corpus fixture, so the fixture is not a second thing to remember.** The
land is the moment `docs/adr/` grows, and `bin/gauntlet push` gates on the fixture agreeing with
the directory ([ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)).
Putting the regeneration in the one place every author goes through is what keeps the gate from
being where you first hear about it. `shape/accept.ts` still regenerates after its own writes,
because it appends the ADR body *after* the draft is created and the fixture has to snapshot the
finished text.

**`bin/new-research` is deliberately untouched.** Its notes are dated, not sequenced, so it has no
number to collide on — the `draft-` exclusion above is all it needs, and it gets that for free.

**Every author that writes into `docs/adr/` now owes the fixture.** That is three: the owner by
hand, `shape/accept.ts`, and `watchdog/back-stamp-walk.ts` — the last of which learned it by turning
`main` red on 2026-08-27 for a stamp it had correctly derived and could not push.
