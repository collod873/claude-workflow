---
name: standards
description: Run the standards chain end to end in one command: /standards-pass, then /ratify, then /to-tickets and /drain on whatever spec ratify filed. The only way the chain ever runs: nothing dispatches it, so invoke it when you want the standards of everything landed since the last pass written up.
disable-model-invocation: true
---

# Standards

One command for the whole authorship chain, and **the only way it runs**: nothing dispatches it,
not `/drain`, not a hook, not a schedule (ADR-0029). Run it when you want the standards of
everything landed since the last pass written up, whether that work came from a drained batch, a
solo `/implement`, or ten of each. Skipping landings costs nothing: step 1 computes its own scope
from the SHA in the last ledger, so a longer gap is one larger batch, not a gap in coverage.

This skill is an **orchestrator**, but of a **chain**, not a batch: it runs four different edges
once each, in order, rather than one edge many times. It produces no state its edges don't
(ADR-0001); every write happens inside the dispatched step, never here.

## The chain

Each of the first three steps below is dispatched as a **fresh-context subagent**: the Agent tool, by
stub, in the foreground (ADR-0026): a one-line prompt naming the step's `SKILL.md` (e.g. "Read
`<path>/ratify/SKILL.md` and follow it"), so the step fetches its own context instead of this skill
re-explaining it. Wait for each subagent's report before
dispatching the next; the chain is serial, never parallel, and the only thing that crosses from one
step's context into the next is the spec number named in step 2's report; nothing else carries over.
A step whose report says it is still waiting on its own subagents has stalled, not finished: resume
it (SendMessage to the same agent, "continue and report") rather than moving on without its result.

1. **`/standards-pass`**: sweeps everything landed on the default branch since the last pass and
   publishes one ledger issue, or updates one already open. No spec exists yet; dispatch it with no
   argument.
2. **`/ratify`**: decides every candidate on the open ledgers: lands what's small itself, files the
   rest into one spec, flags (never defers) the named sensitive shapes. Read its report for two
   things: whether it filed a spec **this run**, and every `[flag: …]` line it wrote.
3. **`/to-tickets <spec>`**: only if step 2 filed a spec this run. Slices that spec into
   tracer-bullet tickets. If step 2 filed nothing, skip straight to the debrief; a ledger with
   everything landed or declined has no further step to run.
4. **`/drain <spec>`**: only when step 3 ran, and **inline, not as a subagent**: read
   `drain/SKILL.md` and follow it yourself, in this session, with the spec step 3 named as the
   selector (an issue with sub-issues is exactly `/drain`'s selector for "those sub-issues"). `/drain`
   is a foreman, and a foreman runs inline, never as a subagent (ADR-0028). From here `/drain`
   owns the rest: landing, debrief, stop. This skill has nothing further to do.

**The chain ends where it stops, always.** Whichever step it stopped at, this invocation is over:
never re-enter step 1, never dispatch `/standards-pass`, `/ratify`, or `/standards` again in this
session, and never propose doing so. The landing step 4 just made is unswept by design; its
standards are written up the next time the maintainer types `/standards`, which is a command they
give, never a consequence of this run (ADR-0029). Step 1 computes its own scope from the last
ledger's SHA, so nothing is lost by leaving it.

## Debrief

Only when the chain stopped after step 2 or step 3; if step 4 ran, `/drain`'s own debrief is the
report. Report:

- That nothing was drained, and why (no candidates, or no spec filed).
- Every `[flag: …]` verdict from step 2, with what was decided: the maintainer's after-the-fact
  review inbox; reversal is a hand edit of the line plus a revert or follow-up ticket (ADR-0027).
