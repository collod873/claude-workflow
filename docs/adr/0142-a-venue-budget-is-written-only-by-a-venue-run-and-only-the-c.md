---
status: superseded
date: 2026-09-02
superseded_by: ADR-0145
amends: ADR-0140
reversal: The generator would again write a solo `test` measurement into the venue half, so the push venue would again defend in a crowded room a bar set in a quiet one — and a workstation's own contention would again refuse pushes whose every check passed, which is the state that made four consecutive green runs unpushable.
---

# A venue budget is written only by a venue run, and only the committed baseline may refuse a push

ADR-0140's ratchet went red on the machine, not the code, in two ways.

**The number came from the wrong room.** `writeSuiteTiming` measured the suite alone and wrote it
as the push venue's `test` budget — but a venue judges a check while a dozen run beside it, so a
solo measurement is a bar no venue run reproduces. A `venues` entry is now written only by
`record`, from a venue run, so that contention is in the number. A rule, not advice: the one path
that could write a solo figure no longer can.

**Only the committed baseline may refuse.** It holds a runner's numbers, measured where the judging
happens, so exceeding it is a fact about the code. A workstation's gitignored one swings past the
margin run to run, and a gate that reddens for environment reasons is how a repo learns to ignore
its gates (ADR-0015). It reports.
