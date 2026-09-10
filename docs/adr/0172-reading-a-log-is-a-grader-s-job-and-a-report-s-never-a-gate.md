---
status: constraint
date: 2026-09-09
reversal: Every hook on the hot path gains a read, and the single sanctioned exception stops being distinguishable from the rule.
---

# Reading a log is a grader's job and a report's, never a gate's

Hooks write run rows; `_harness.rows()` and `bin/hook-report` read them. A gate that read its own
log would put a filesystem scan on the path of every tool call it guards, which is a new failure
mode: observability that can block.

One exception is sanctioned and lives beside the writer rather than the reader: the Stop gate's
liveness check, a project-filtered read of `_hook.active_sessions()` answering whether another
session is mid-work. Naming it here is what keeps it an exception instead of a precedent.

**Rejected: a shared reader in `_hook.py`.** A gate that can import a reader will eventually use
one.

Imported from collod873/agent-skills ADR-0039 on 2026-09-09; that repo no longer carries the
ruling.
