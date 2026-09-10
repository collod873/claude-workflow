---
status: constraint
date: 2026-09-09
reversal: A drifted roster is invisible by construction; the last drift let a secret written into a notebook go unscanned for the life of the mismatch, with nothing failing.
---

# The edit-tool matcher is one roster, asserted against the live settings

A settings matcher built only from `A-Za-z0-9_- ,|` is an exact pipe OR-list, not a regex. So
`Edit|Write` matched two tool names and nothing else, every hook on it was blind to
`NotebookEdit`, and a secret written into a `.ipynb` was never scanned.

The roster is defined once, in `_hook.EDIT_TOOLS`, the matcher string derived from it, and a test
asserts that string against the live `settings.json`. Registration and roster cannot drift
without a red test.

**Rejected: each hook naming its own tools.** That arrangement produced the gap, and nothing
observable changed while it was wrong.

Imported from collod873/agent-skills ADR-0037 on 2026-09-09; that repo no longer carries the
ruling.
