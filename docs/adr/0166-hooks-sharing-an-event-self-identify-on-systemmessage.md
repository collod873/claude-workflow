---
status: constraint
date: 2026-09-09
reversal: Two lint rules are named for it and every hook's refusal envelope is built from this shape; unwinding it means rewriting `_hook.deny()` and every hook that calls it.
---

# Hooks sharing an event self-identify on `systemMessage`

When two hooks can refuse on the same event, `permissionDecisionReason` is raced and may not reach
the model; `systemMessage` is not, and reaches the human intact. So every refusal carries both,
with identical text, prefixed `[hook-name]` derived from the running script rather than restated.

The envelope is built once in `_hook.deny()`; `bin/lint` refuses any hook that assembles its own,
and refuses a restated `HOOK_NAME` literal that a rename could desynchronise.

**Accepted cost.** The marginal spawn is +0.1 ms, paid on every fire of the busiest event on this
machine.

**Rejected: `permissionDecisionReason` alone.** It is raced between hooks sharing one event, so a
refusal may never reach the model.

Imported from collod873/agent-skills ADR-0012 on 2026-09-09; that repo no longer carries the
ruling.
