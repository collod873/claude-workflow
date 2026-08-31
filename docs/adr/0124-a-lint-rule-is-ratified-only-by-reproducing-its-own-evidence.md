# A lint rule is ratified only by reproducing its own evidence

Recorded 2026-08-31.

When the ratifier decides to mechanise a finding, the harness runs the rule it just authored against
the tree **as it stood before that finding's site fixes**, and the rule must flag every site the
observation carries. A rule that misses one is demoted — its edits are reverted and the prose entry
the verdict already supplied lands instead. The trial is code, not a sentence in a prompt, and its
threshold is the observed failure itself rather than a number anyone chose. Ruled by the owner in
[#296](https://github.com/collod873/claude-workflow/issues/296).

## What this answers

`GOAL.md`'s third blocker asks how anyone knows a landed rule catches anything.
[ADR-0003](0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md) answers it at the
far end — every rule is asked at `/standards-pass` whether it ever fired, and removed when the
answer stays no — and that exit still stands for every rule this lane lands. But an exit measured in
sweeps is a slow way to learn that a rule was wrong on the day it was written, and by then the
refactor it justified has already landed.

The evidence to try it against already exists. A PROPOSED finding only reaches the ratifier by
clearing the two-site gate ([ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)),
so it arrives carrying the sites that warranted it. Those sites are the rule's own claim about
itself, stated before the rule existed, which is exactly what a test wants: a prediction the code
did not get to choose.

## Why the trial runs on the pre-fix tree

A rule authored alongside its own fixes has nothing left to flag by the time anyone could run it —
the sites are repaired. So the trial stages a detached worktree at the parent commit, copies the
authored config in, and lints there. That is the only arrangement in which "does this rule see the
problem" is a question with an answer.

The worktree is staged inside the repository rather than in a temp directory, for the reason the
clone gate's own staging tree gives: eslint and its plugins resolve out of `node_modules`, and a
path outside the repository cannot walk up to it.

## Consequences

**The demotion is the harness's decision, so the fallback is asked for up front.** A `mechanise`
verdict must carry the three-line entry to land instead if the trial fails. Code holding no fallback
text could only ever demote to a rejection, which would throw away a standard that was right about
everything except being lintable.

**Each finding gets its own spawn and its own commit.** The trial has to see the tree before this
finding was touched, and a demotion has to discard one finding's edits without touching the ones
already accepted. Both are only tractable per finding, so the batch's shared artifact is the pull
request rather than the model call.

**A rule that reproduces its evidence can still be useless.** The trial proves the rule sees the two
sites that warranted it; it proves nothing about the next copy. That is what ADR-0003's standing
question is still for, and this ruling narrows it rather than replacing it.
