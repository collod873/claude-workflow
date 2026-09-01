---
status: note
date: 2026-08-23
reversal: Undoing it restores the whole-response `<output>` count inside `extractOutput` and the tests around it, a self-contained parse change — and ADR-0081 has since moved a stage's answer onto a structured output tool call, so the block contract this defends is largely no longer the live one.
---

# A stage's output block is the outermost span, and the payload may mention the tag

Re-admitted 2026-08-31 as a **note**: this records a change record — what was added, moved or retired, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
