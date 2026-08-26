# `No diff.` excuses the range and nothing else

Recorded 2026-08-25.

`No diff.` was the first branch of `evaluateRecord` and returned `allow` outright, before a
bullet, a criterion count or a verdict was read. It now stands in for the `base..head` line only:
the bullets are still counted against the issue's criteria, still carry a verdict each, and still
have to point at shaped evidence. It passes on its own in exactly one case — an issue body that
declares no `## Acceptance criteria` at all, where there is nothing for bullets to correspond to.

The hole was not hypothetical. #55's drill A closed an issue that had delivered none of its seven
criteria: run 32916246191 went green with `pass (no-diff)` and the gate filed a record saying the
work was done. The salvage stage is not what failed — it looked for evidence, found none, and
wrote seven honest failures. The grammar threw them away on the record's first two words, and
`salvage/prompt.md` made that the *likely* shape rather than an edge case, because an issue nobody
delivered carries no commit by definition. A close carrying no commit is a real thing; a close
carrying no evidence is not.

## Consequences

An empty `## Acceptance criteria` heading is now refused with a different message than a missing
one: `No diff.` rescues the second and not the first, so telling someone to declare it under an
empty heading would be a loop. Era 6's `hooks/close-gate.py` is fixed the same way rather than
left to drift ([ADR-0021](0021-one-gate-per-rule-the-workstation-close-hook-stands-down-whe.md)
stands it down here but it still guards every other repo on the workstation), which also cost it
its inline-`No diff.` fast path — counting an issue's criteria means reading the issue, so the
network call is no longer optional.

`RECORD-GRAMMAR.md`'s declared ceiling is unchanged and still binding: a well-shaped lie passes.
This closes a hole below that line, where nothing was even claimed.
