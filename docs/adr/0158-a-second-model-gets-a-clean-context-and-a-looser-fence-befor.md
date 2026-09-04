---
status: constraint
date: 2026-09-04
reversal: Two model rounds stop being cheaper than one owner interruption once the added spend outpaces the time it saves, or once fresh-eyes declared edits turn out to be a routine way past the fails rule rather than the rare one this ruling assumes.
---

# A second model gets a clean context and a looser fence before a red gate reaches the owner

A resumed repair session inherits the first model's own read of the ticket. When that read is what
is wrong — the test asserts something false, or the fix lives outside the claim — resuming it only
re-plays the same blind spot against the gate's output. So once that repair round is still red, or
never had a session to resume, a fresh session on `claude-opus-5` gets the brief again with no prior
turns: the ticket as written, not as the first model came to understand it.

Its fence loosens to match: it may edit a wrong `test.fails(` test, or touch a file outside the
claim, but only by naming the edit in `declaredEdits` with a reason. A silent widening would hide the
failure this round exists to find; a declared one becomes the first thing the review lane checks. The
immutable set stays closed for both models.
