# An unread document cannot be detected, so the backwards question back-stamps prose instead of deleting it

Recorded 2026-08-26.

`DESIGN.md` §11 Q5 asked whether an unread document gets deleted automatically. The answer is **no**,
because "unread" is not observable and the thing that *is* observable wants writing, not deleting.

[ADR-0003](0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md) works because a
lint rule's firing leaves a complete mechanical record — Actions history, 27 `Verify` runs and 7
failures in this repo's whole life. Prose has no equivalent, and all three candidate signals were
measured and rejected:

- **The session corpus.** `Knowledge-Base/raw/sessions/` does record reads — `## Files Touched`
  carries `Read:` lines. But of its 876 captures only **35** come from the era the hook actually
  runs; the other 833 are April–May, from the retired wiki's recorder, in other repos. Across all of
  it exactly **three** of this repo's ADRs ever appear as a `Read:`. It misses `cat` in Bash, `grep`,
  always-on `CLAUDE.md`, and subagent reads — and it records *loading*, never influence.
- **Inbound citations, whole repo.** All 44 ADRs have at least one. `docs/adr/README.md` does not
  index them, so these are real citations. Zero deletable: the test discriminates nothing.
- **Citations in `DESIGN.md` only.** Three uncited — the template, ADR-0008, ADR-0024 — and both
  real ones are the **superseded** ones. ADR-0008 was struck by
  [ADR-0043](0043-write-on-surprise-does-not-ship-the-transcript-auditor-alrea.md); ADR-0024 was
  amended by [ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md). The
  only signal that discriminates finds exactly what must never be deleted, because the amendment
  chain *is* the record.

So the act is a **back-stamp**: a superseded record gains a pointer to the record that superseded
it. Deletion survives only where an exit already exists —
[ADR-0003](0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md)'s lint rules, and
`CODING_STANDARDS.md` entries, whose only exit is *mechanised*.

| Class | Test | Act |
|---|---|---|
| ADRs | Is it named by a later ADR's `Amends:` trailer? | Back-stamp a `Status: superseded by ADR-NNNN` line |
| `docs/research/` | Does it name the issue it answers? | File an issue against it |
| Lint rules | Has any `Verify` run ever failed naming it? | Delete — ADR-0003, unchanged |
| `CODING_STANDARDS.md` entries | Same, once mechanised | Delete — the file's existing exit |

**Standing lenses and counters are out of scope**, and go to
[#102](https://github.com/collod873/claude-workflow/issues/102), which asks what refuses a counter
and already names this generalisation as the refusal it is looking for. Also out: `CONTEXT.md`
terms — a glossary term is load-bearing precisely when nobody looks it up, because it is doing its
work inside every brief that gets assembled — and `DESIGN.md`/`GOAL.md`/`INDEX.md`, where the unit
would be a section rather than a file and
[ADR-0025](0025-design-md-carries-no-lane-status-a-shipped-lane-collapses-to.md)'s collapse rule
already does that job.

## The pruning boundary this was held to does not exist

The question was filed against a safety condition attributed to
[ADR-0006](0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md) — *pruning can never
reach something the owner wrote*. **ADR-0006 contains no such sentence.** It rules that agents draft
and the owner signs, and strikes vocabulary from the places the human deliberately stays. The
boundary was invented in the restatement.

It is struck rather than restated, and there is no authorship gate on this mechanism. Two reasons,
and the ruling stands on either. It is unimplementable: 129 commits, every one authored
`Collin Lodato` whether an agent wrote it or he did, and zero `Co-Authored-By` trailers — so as
stated the boundary would protect the 3-in-34 ADR-0006 counts as owner-originated and block all of
them. And it is unnecessary: nothing here deletes prose, so there is nothing for it to guard.

## The convention already existed, and nobody kept it

`docs/adr/README.md` has said this all along — *"Add a `superseded by ADR-NNNN` status line to the
old one. The point of the record is that you can see the mind change."*

**Zero of 43 ADRs carry one.** That is `GOAL.md` C4's adoption law demonstrated inside this repo's
own record: a convention needing an active ritual is dead regardless of quality, and this one was
written down, mandated, and never once performed. It is the argument for mechanising it rather than
restating it more firmly.

## What this does not close

`GOAL.md` §4 blocker 3 stays open. Its condition — the backwards question reaching the lint rules
and the ADRs — is answered here as a **decision**, and a decision retires nothing; a built mechanism
does. The condition is restated as two builds: this back-stamp counter, and ADR-0003's lint audit,
which is **ruled but unbuilt** — `/standards-pass` does not implement it (its own `ADR-0003` link
points at a different ADR-0003 in `agent-skills`), and `/ratify`'s "a lint rule with zero hits
against the repo as it stands" is a static tree scan, not a question about history.

Blocker 3's counts are also corrected where they are cited here and in `DESIGN.md` §6: it is **2**
`CODING_STANDARDS.md` entries and **14** lint rules, not 36, and **44** ADRs, not 30.
