---
status: constraint
date: 2026-09-09
reversal: The `check:` grammar is spelled across issue bodies and in `ticket_shape.py` and the close gate, none of which can rewrite an already-closed issue's record.
---

# A criterion is verified by running its own check marker, and one without a marker is UNVERIFIED

A criterion carries a trailing `- check: \`cmd\`` marker; the closer runs it and the record names
the observed exit status. A criterion with no marker records `UNVERIFIED` rather than blocking the
close.

That trade gives up a stronger guarantee this repo once required elsewhere: that a verification
record came only from a fresh context that had not produced the diff. The trade is stated here
because it was made once, in a spec, and otherwise survived only as italics inside the rulings it
superseded.

**Rejected: refusing a close on an unmarked criterion.** Most criteria are prose about judgement,
and a gate that demanded a command for each would be satisfied by fake ones.

Imported from collod873/agent-skills ADR-0036 on 2026-09-09; that repo no longer carries the
ruling.
