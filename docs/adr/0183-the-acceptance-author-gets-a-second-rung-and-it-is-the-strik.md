---
status: constraint
date: 2026-09-13
reversal: Undoing this returns lane 04 to spending a second Opus call that cannot differ from the first, so a repeat failure costs the same money twice and reaches the owner no sooner.
---

# The acceptance author gets a second rung, and it is the strike it already earned

Lane 04's author has been on the strike ladder since #457, but only to be counted: `climbLadder`
computed a rung and every value short of the decision dispatched the same bare `acceptance-wanted`.
A ticket whose batch was refused got the identical prompt again, with no way to know a run before it
had died, let alone on what. Repeat failures on one ticket are ordinary here, so two of those Opus
calls were the same call.

The rung now reaches the author. `rung: fresh-eyes` renders every standing strike's signature into
the author's own prompt, as lane 05 hands its second model the strikes as gate output. The author is
already Opus: what changes is not the model but what it knows.

**Rejected: routing the second strike to the mechanic, as lane 05 does.** The mechanic repairs a
tree and authors no test.
