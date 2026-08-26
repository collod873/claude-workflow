# The sweep reads this repo only; the cross-repo title sweep waits on a credential

Recorded 2026-08-26.

Lane 01's sweep searches this repository's issues, `docs/adr/`, `CONTEXT.md` and its docs, and
nothing else. `DESIGN.md` §01 also gave it *"a title sweep across the owner's other repos"*; that
half does not ship, and it does not ship because it cannot be written honestly with the credential
the lane has.

Ruled by the owner on 2026-08-26, with move 4b.

## Why it cannot simply be written

A workflow's `GITHUB_TOKEN` is scoped to the repository it runs in. `gh search issues --owner
collod873` under that token returns the owner's *public* repositories, and the estate is private —
so the call succeeds, returns nothing, and the sweep reports having looked. That is worse than not
looking: a `none found` line on the sheet is evidence the owner reads as *the estate was checked*,
and it would be false for every repo but this one.

## Considered options

- **Add a fine-grained PAT with read access across the estate.** Rejected for now, not on cost —
  the search is free — but on sequencing. §11's question 1 is *deferred, not open*: this repo and
  nothing else until the machine runs here, and a second credential is exactly what
  [#98](https://github.com/collod873/claude-workflow/issues/98) is still deciding the shape of. A
  token added ahead of that ruling is a token the identity map has to be drawn around rather than
  drawn for.
- **Ship the call and let it return nothing.** Rejected on the paragraph above. A mechanism that
  reports having checked what it could not see is the failure this lane is least able to survive:
  §01 names its failure as *a confident, coherent sheet resting on a wrong premise*, and this
  manufactures one on the one section that can pre-empt the whole sheet.
- **Repo-deep only, and say so.** Chosen.

## Consequences

**The prior-art section's claim is narrower than §01 implied, and the sheet does not overstate it.**
The sweep finds what this repository already decided. An idea Lumaria has already had is not found,
and nothing on the sheet suggests it was looked for.

**This is the second thing waiting on the same day.** §11's question 1 reopens once lane 05 runs on
a runner, and its standing recommendation for that day — the gauntlet and the cross-repo counter —
now has a third item beside it. All three want the same credential, which is an argument for
deciding #98 once rather than three times.

**What would reverse this:** the credential arriving for another reason. The moment anything in this
estate holds a token that can read a second repo, this call is one line and the sweep's reach grows
for free.
