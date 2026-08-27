# A superseded ADR is named by a trailer its successor writes, and the first thing the counter catches is a missing trailer

Recorded 2026-08-26.

Status: superseded by ADR-0072

[ADR-0044](0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md) makes the act a
back-stamp. This is how a machine knows which record to stamp.

**Supersession is not detectable from prose.** The vocabulary across 44 ADRs is `retired` ×11,
`amends` ×10, `struck` ×7, `restated` ×2, `replaces` ×2 — five words, no canonical one — and
`extends` ×1, which is **not** supersession:
[ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md) extends
[ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md) and both stand. A verb grep has a
known false positive on the day it ships, and it is a heuristic over prose in a repo that has now
twice measured hand-written manifests drifting — `contract.json` in four repos, two of them already
wrong about themselves ([#80](https://github.com/collod873/claude-workflow/issues/80)).

So supersession is **declared, not inferred**. A superseding ADR carries a trailer naming its
predecessor, `bin/new-adr` gains an `--amends NNNN` flag that writes it, and the back-stamp is
derived from the trailer graph. A one-time backfill covers the ~20 existing cases; that pass is a
human read of the five verbs' hits, done once, not a standing heuristic.

## Why a hand-written field is survivable here and was not in contract.json

Because **the counter catches its own absence.** An ADR whose body contains one of the supersession
verbs *and* the filename of an earlier ADR, but carries no `Amends:` trailer, is a finding — the
counter files it. Nobody has to remember the trailer; forgetting it is the thing that gets detected.

That is the difference from `contract.json`, which had no reader that could tell a stale manifest
from an accurate one, and from `docs/adr/README.md`'s existing back-stamp convention, which had no
reader at all and achieved **zero compliance in 43 ADRs**. `GOAL.md` C4 asks whether a mechanism
needs maintenance to stay true. This one's maintenance obligation is the thing it watches.

The backstop is still a heuristic, and it is the honest weak point of this ruling: a superseding ADR
that names its predecessor in neither the trailer nor a recognised verb is invisible. The trade is
accepted because that shape has never occurred in 44 ADRs, and because the failure is silent absence
rather than a false back-stamp on a live record.

## Research notes get the same treatment, weaker

`docs/research/` has no exit at all. Its natural test — did the issue this document answers close,
and did the closing decision cite it — is unavailable, because the pointer is hand-written and
already drifting: `Resolves:`, `Researches:`, `Research for`, and **two of seven documents carry no
pointer at all**.

So the same discipline applies — a real `Resolves:` field, written by the tool that creates a
research note — and the counter's first finding is the two documents missing one. The act stays
**file an issue**, never delete, because research fails differently: it is not unread, it is
*wrong*. [#101](https://github.com/collod873/claude-workflow/issues/101) is a document carrying a
figure labelled **measured** that cannot be reproduced, cited in this map's own grilling round as an
anchor before it was struck.

## Consequences

The trailer graph is **recomputed, never stored**, which is what keeps it from going stale — the
same property `DESIGN.md` §6 claims for its counters, and the defect that made 43% of Lumaria's four
weeks of inbox findings dead on arrival.
