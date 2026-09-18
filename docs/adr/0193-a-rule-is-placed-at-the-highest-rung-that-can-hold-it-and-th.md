---
status: constraint
date: 2026-09-15
supersedes: ADR-0010
reversal: Reverting returns placement to venue alone, as ADR-0010 had it: the rung question goes unasked, so a rule a machine could have repaired is filed as a gate that refuses, and the prose that taught it is left standing beside the gate. That is how the rooting rule came to be written out five times and `claimLimit`'s value spelled out in two lane prompts while the rules file that owns it goes unread.
---

# A rule is placed at the highest rung that can hold it and the earliest venue that can see enough, and the change that places it deletes every restatement

A rule sits at one intersection. The **rung** names what a violation costs - 
impossible, repaired, refused, reported, taught. The **venue** names what the
repair costs - terminal, turn, stop, push, lane, CI.

The rung is singular: what a machine can repair cannot coherently also refuse.
Venues are not, and need not be - `turn` and `stop` run the same slots off one
source. A second enforcer *reading* the source is one rule with two enforcers
([ADR-0184](0184-one-rules-source-spells-the-ticket-shape-both-validators-enf.md)).
A copy that *restates* the source in its own words is a second rule wearing the
first one's name, and it drifts the moment the original moves, outliving even
its own reversal.

[ADR-0174](0174-a-ratified-standard-must-be-expressible-as-a-sub-second-grep.md)
states this for one arrow, taught → refused. This is that sentence with the
nouns removed.

**Rejected: placing by venue alone.** ADR-0010 ruled earliest-venue and asked
nothing about cost, so the restatements stayed.
