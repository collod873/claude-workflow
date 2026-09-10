---
status: constraint
date: 2026-09-09
reversal: Three writers go back to one per repo, and every hook not written in Python drops out of `hook-report` and `hook-trace` the next time the row gains a field.
---

# A hook writes its run row through its language's writer, never a private append

The run row is spelled once per language a hook is written in: `_hook.py`, `_hook.mjs` and
`_hook.sh`, side by side in the hooks directory. One pin test (`test__hook_writers.py`) drives all
three with the same payload and diffs the rows.

A hook in a fourth language gets a fourth writer here before its first row. The bash writer
parses no JSON of its own: it hands the payload to the JS one, so a field's spelling lives in one
place.

**Rejected: every language shelling to the Python writer.** A row that depends on a second
toolchain being present is a row that silently stops the day it is not, indistinguishable from a
hook that never fired.

Imported from collod873/agent-skills ADR-0043 on 2026-09-09; that repo no longer carries the
ruling.
