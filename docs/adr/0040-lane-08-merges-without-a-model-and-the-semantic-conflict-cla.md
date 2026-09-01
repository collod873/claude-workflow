---
status: constraint
date: 2026-08-26
reversal: Reversing it means building the merge warden — a Sonnet stage in lane 08, a coherence-finding type, and merges that hold — which re-introduces the parked work ADR-0011 forbids, and the semantic-conflict class has meanwhile been assigned to the proposed lens shipping in move 8b, with DESIGN.md §3's model assignment already rewritten.
---

# Lane 08 merges without a model, and the semantic-conflict class goes to the proposed lens

Lane 08 spends no model. The merge warden is deterministic code — rebase, re-run the gauntlet against current trunk, merge, deploy preview — and never holds a merge for a semantic conflict. That class goes to the proposed lens, whose two-site gate already detects *the same thing at two places* and is measured at 55% valuable.

**Rejected:** hold and file, on ADR-0011 — nothing clears a semantic-conflict finding except the owner, so a held merge is parked work that drains onto him. Merge and file is strictly dominated: it fires the moment the lens does and adds a model call.

**Accepted cost.** Duplicated work reaches trunk and is caught one merge later, at release. If it lands and the lens is not surfacing it, this is the decision to revisit. The merge stays serialised.
