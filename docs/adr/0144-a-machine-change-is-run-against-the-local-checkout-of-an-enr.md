---
status: superseded
date: 2026-09-02
superseded_by: ADR-0146
reversal: Reversing it means an enrolled repository's Verify is again the first place a machine change meets a real target, so every assumption the change breaks is found there one run at a time — the shape of 2026-09-02, when twelve hand-landed commits produced six defects of one class across eight hours of runner time and two relaying sessions.
---

# A machine change is run against the local checkout of an enrolled repository before it lands

The machine checks an enrolled repository from its own checkout (ADR-0139), so `bin/gauntlet`
already takes a target root, and Lumaria's checkout sits on the same disk. Nothing joined the two
until the end of a day that needed them joined.

So: before a machine change lands on `main`, through a lane or by hand, it runs
`TARGET_WORKSPACE=<checkout> bin/gauntlet push` against an enrolled repository. Six minutes on the
workstation. Every defect it would have caught today was one class, *the machine assuming the
target is itself*, and each cost a runner cycle and a session instead.

Hand-landed changes are bound hardest: the immutable set keeps workflow files out of every lane,
so the least-tested code was getting the least judging.

**Rejected:** a permanent canary runner — the same findings, ten minutes later, on minutes the
estate does not have.

**Accepted cost.** One push-venue run per change, against a checkout kept current.
