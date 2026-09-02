---
status: constraint
date: 2026-09-02
reversal: Reversing it means the enrol lane owning a second glob over `bin/` and `.Workflow/agent-workflows/shared/`, writing into every enrolled repository each time the machine touches them, every such write firing that repository's Verify and its own CI, and re-auditing every enrolled repository for the copy it then holds.
---

# An enrolled repository is checked by the machine's gauntlet running from the machine checkout, never by a copy of it

Every lane already has the machine checked out beside the target
([ADR-0132](0132-a-caller-checks-out-the-machine-with-no-credential-at-all-be.md)), so the
gauntlet and its checks are on every runner already. What was missing is that `bin/gauntlet` has
one root where it needs two: where its checks live (the machine) and what they check (the target).

The target owes only its `.claude/contract.json`, and the contract slots run against it. Of the
push venue's eight machine checks, those reading files the target may carry run when it does —
`docs/adr` for the corpus, trailers and ADR check; workflow lint always — and the four that diff a
baseline (`contract`, `clones`, `wiring`, `boundaries`) run only where that baseline exists, the
shape the clone check already has.

A copy was rejected: a stub carries no logic and cannot drift, but a copied gauntlet is a snapshot
of half the machine, changing hundreds of times a week
([research](../research/0001-every-assumption-the-reusable-workflow-split-broke-swept-in.md)).
