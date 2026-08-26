# Parity and correction do not survive their own history, so section 6 keeps four counters and four sizing measurements leave it

Recorded 2026-08-26.

[ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)'s bar applied to the
ten things `DESIGN.md` §6 had accumulated. **Four are counters, four are sizing measurements, and two
are cut.**

| | Event | Count | Files | Class |
|---|---|---|---|---|
| **Bypass** | `verify.yml` completes on a push to `main` | 3 | Bring move 10 forward | 7 |
| **`not_planned` closes** | A lane 07 finding issue closes | 3 grow / 20 delete | Add or remove a refuter | 6 × 9 |
| **Cross-repo** | A finding recorded, in any repo | 2 — the second site | File the machinery defect here | 10 |
| **Lost dispatch** | A spec published carrying `sliceable` | 1 | Name the PRD that never sliced | 7 |

**Cut: parity and correction.** **Left §6 for the ADR that made their decision:** the share of red
PRs reaching `blocked` (ADR-0041), out-of-brief reads by module (ADR-0042), PR wait time at the merge
(ADR-0039), and the share of specs dispatching at a zero open-question count (ADR-0062).

## The correction counter has no signal, in a corpus that exists

It reads *"a commit reverted, or added and deleted the same day."* Over this repo's **175 commits**:

- **Zero** commits are a revert. Three mention reverting in prose; none is one.
- **Zero** files were added and deleted on the same day.

Not a low rate — an empty set, over the whole history, of both halves of its trigger. It would have
filed nothing since the repo was created, and it names no count and no action at which it would have.

This is the cheapest possible reading of ADR-0064's measurement clause and it is decisive: the signal
does not occur here. What it was reaching for is real — evidence class 9, the owner's behaviour, a
labelled failure already judged by a human and free to read — but `git log` is not where this owner
records a correction. He records it by ruling on an issue.

**Row 9 keeps its coverage, and gets a better mechanism.** ADR-0037's `not_planned` counter is
explicitly *"class 6 crossed with class 9"* — a delivered ticket closed `not planned`, or left
untouched for five days, is the owner declining to act, which is the same behaviour read off the
surface he actually uses. It has a count, an action and a job. Row 9 goes from an unspecified counter
with zero traffic to a specified one with a lane depending on it.

## Parity counts what a gate already guarantees

It fires *"on a slice published, beside its siblings"* and reads for a structural shape the siblings
have and this one does not. Measured across the four PRDs this repo has sliced — **34 sibling slices**
in total, 11, 9, 7 and 7 — every one carries `## Acceptance criteria` and `## Files claimed`.

That uniformity is not an observation, it is enforcement: `~/bin/file-issue ticket` refuses a body
without both headings. So at the venue parity fires on, the structural shape it compares is one a
green gate already forces, and
[ADR-0036](0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md) refuses exactly that
finding before any work is spent. Parity would have run 34 times and reported nothing it was allowed
to report.

**The other reading is worse, not better.** If "sibling units" means the code each slice produces
rather than the ticket, the venue is sibling pull requests — and
[ADR-0041](0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)'s finding stands:
**this repo has opened zero pull requests, ever.** There is no corpus, and the lane that would create
one (lane 05) is unbuilt. Under ADR-0064 that is *no traffic yet* rather than *no signal*, which
would normally be a deferral — but a deferral needs the thing being deferred to name a count and an
action, and parity names neither in `DESIGN.md` or in any ADR. Deferring an unspecified mechanism to
a lane that does not exist is precisely the permanent exception
[ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) rules against.

**Row 7 keeps its coverage.** The bypass counter is class 7, it is specified, and ADR-0063 measured 4
of 34 `verify.yml` runs on `main` already failing at the Gauntlet step — it fires the day it ships.
The absence row loses the mechanism with no traffic and keeps the one with a backlog.

If a PR-level parity finding turns out to be real once lane 05 has run, it re-enters through the
front door: an ADR naming its shape, its count and its action, at the admission event ADR-0064
defines. Deleting it now costs one paragraph to restore and buys a §6 that describes only mechanisms
that will exist.

## The cross-repo counter survives on a precondition, and its remit shrinks

Zero findings have ever arrived at a second site in a second repo, because no second repo runs the
pipeline. That is a statement about a precondition and not a null result, so ADR-0064's clause defers
rather than cuts, and the move that supplies the precondition is
[move 12](https://github.com/collod873/claude-workflow/issues/114).

But **what it counts is narrower than §6 claims**.
[ADR-0055](0055-a-lane-ships-as-a-reusable-workflow-and-a-second-repo-carrie.md) rules that a lane
ships as a reusable workflow and a second repo carries a six-line stub — so there is no sync contract
by construction, and machine drift across repos can no longer happen in the half §6 was written
about. What copying survives is the free venues and the check contract, and
[ADR-0057](0057-the-installer-derives-every-list-it-acts-on-and-overwrites-o.md)'s
`regenerate && diff` plus re-running the installer already cover those.

So the drift-detection half is gone and the **defect-carrier half is the whole job**:
[ADR-0009](0009-the-machine-may-file-defects-against-itself-but-never-featur.md) rules that a
machinery defect found in another repo is filed *here*, and a run dispatched elsewhere has no write
path back, so the counter is what walks it home. §6 already called that *"load-bearing rather than
merely cheap"*; it is now the only reason the counter exists. Its count of **2** is unchanged and is
not arbitrary — it is C3's second-site trigger, the one candidate trigger `GOAL.md` puts on record.

It is also the sole mechanism on row 10, so cutting it would leave an evidence class dark, which is
the argument §6 was built on.

## The lost dispatch is a counter, and it is the case the run watchdog cannot see

ADR-0062 left it as a row with no contract. It gets one: it fires on a spec published carrying
`sliceable`, at **1**, and files an issue naming the PRD that carries the label with no sub-issues and
no completed slicing run. One is the right number because a single lost dispatch is a defect, not a
trend.

It looks like [#41](https://github.com/collod873/claude-workflow/issues/41)'s class and it is not
covered by #41's fix. That watchdog keys on **a run that executed zero jobs** — it reads runs. A
`repository_dispatch` that never arrived produces **no run at all**, so there is nothing for a
run-reading sweep to find. This is the same absence one level further out, and it is genuinely
uncovered.

Its reader is the owner via the brief, like every other counter. ADR-0062 described its reader as *a
mechanism*, which would have made it a retry rather than a counter — but the same ADR rules
`sliceable` a **durable trace rather than a trigger**, so nothing consumes it automatically and there
is no mechanism to be its reader. It files, like the rest.

## The brief does not exist yet, and the counters ship anyway

Every counter's reader is the owner via the brief, which is move 9 and unbuilt. That is survivable
and §6 should say so, because otherwise a spec author blocks move 8a on move 9 and inverts §10's
whole argument for putting the free venues first.

**The tracker is already a reader.** This repo's first 100 issues close at a median of 1.5 h with a
maximum of 47.1 h (ADR-0039), and the owner clears roughly thirty items a day. An issue filed into
that tracker is received. The brief **batches by topic** so related decisions arrive together; it does
not originate, and ADR-0004 says an empty queue produces nothing. A counter filing four issues a month
into a tracker that turns over in ninety minutes is not an unread counter — it is an unbatched one,
and batching is an improvement rather than a precondition.

## Consequences

**Move 8a is no longer "the three free counters."** Two of its three are cut, so
[#92](https://github.com/collod873/claude-workflow/issues/92) becomes the cross-repo counter alone
and inherits move 12's precondition. Its acceptance criteria for parity and correction go with them.
The bypass counter already ships separately as
[move 8d](https://github.com/collod873/claude-workflow/issues/115); `not_planned` ships with
[move 7a](https://github.com/collod873/claude-workflow/issues/99), as ADR-0037 requires — *"it is
that lane's only evidence that its filter is sized right"*; the lost dispatch counter is small enough
to ride move 8d, which is the other row-7 absence counter and the other thing that reads run metadata.

**§6's coverage ledger is unchanged in shape and honest for the first time.** Rows 7, 9 and 10 each
keep a mechanism, and each of those mechanisms now names what it files. The ledger's original finding
— *rows 1–6 watched twice over, rows 7, 9 and 10 with nothing at all* — was correct, and answering it
took four counters rather than three, only one of which is one of the original three.

**Two evidence classes are watched by something with measured traffic**, which is new. Before this
ruling every counter in §6 was an argument; the bypass counter has a backlog of four and the
`not_planned` counter has ADR-0019's 27 graded findings behind its threshold.

**The number to watch is the share of counters that survive their next admission audit.** ADR-0064
sets that event; this is its first firing, and it cut two of ten. A second admission that cuts none
means the question is being asked as a formality.
