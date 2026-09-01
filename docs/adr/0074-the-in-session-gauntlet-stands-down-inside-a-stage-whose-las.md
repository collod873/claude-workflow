---
status: note
date: 2026-08-27
reversal: Removing the stand-down means unsetting `WORKFLOW_STAGE` in `execClaude` and dropping the guard in `.claude/hooks/gauntlet-hook.mjs`, after which a stage's final turn is again spendable on a reply to a hook — the failure that discarded a finished plan on #134 at eight minutes and $1.15.
---

# The in-session gauntlet stands down inside a stage, whose last word must be its output block

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
