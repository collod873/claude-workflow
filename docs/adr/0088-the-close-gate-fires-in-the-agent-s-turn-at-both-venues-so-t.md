---
status: constraint
date: 2026-08-28
amends: ADR-0021, ADR-0023, ADR-0048
reversal: Reversing means rebuilding `close-gate.yml`, its session-end reconciler and the `close-refused` label state, un-retiring ADR-0021/0023/0048, and re-accepting that a refused close is repaired in a session that has already ended.
---

# The close gate fires in the agent's turn at both venues, so the tracker-side gate and its reconciler retire

The close gate is one file, `.claude/hooks/close-gate.py`, a PreToolUse hook. It judges a close before it runs — at this workstation and inside every stage on a hosted runner — and `close-gate.yml`, its reconciler, and the `close-refused` label go away.

ADR-0010's earliest venue is not a machine, it is **the agent's turn**, and a runner has turns too. The hook fires under `--dangerously-skip-permissions`, which every stage passes, and its `deny` is honoured there: a drill stage repaired itself in-turn, where the tracker-side repair cost a session already ended.

**Rejected:** keeping both venues, which ADR-0021 arranged and which drifted — the cure is one *file*, not one venue.

**Accepted cost.** A close outside a Bash tool call — a merge keyword, the web UI, a phone — goes unjudged, and a crashed hook fails open. Nothing counts either.

**Amended 2026-09-09:** the hook lives in this repo only; `collod873/agent-skills` carries no
copy.
