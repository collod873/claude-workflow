---
status: constraint
date: 2026-09-09
reversal: `_harness.router_fired()` asserts the contract for every router this repo ships; a router that could refuse would make every edit on this machine blockable by a heuristic.
---

# A router injects a question and never refuses

A router is a hook that fires on an edit and answers only with `additionalContext`: no
`permissionDecision`, no `systemMessage`, silent on every error. It answers a question no grep can
settle — whether this edit needs some other artifact updated, whether a change should propagate
elsewhere in the tree — and that is exactly why it may never refuse: the judgement belongs to the
session, and a wrong refusal is paid on every edit.

`_harness.router_fired()` asserts the whole contract in one place — no decision, no warning — so
any router this repo ships inherits it rather than re-deriving it.

**Rejected: refusing on high confidence.** Confidence is the thing a heuristic is worst at
reporting.

Imported from collod873/agent-skills ADR-0038 on 2026-09-09; that repo no longer carries the
ruling.
