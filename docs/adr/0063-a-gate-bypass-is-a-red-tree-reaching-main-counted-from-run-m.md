# A gate bypass is a red tree reaching main, counted from run metadata and retired by move 10

Recorded 2026-08-26.

Status: superseded by ADR-0071

A **gate bypass** is one event and one event only: a commit reached `main` carrying a tree that
`bin/gauntlet push` refuses. One counter, not two. It reads the failed **step name** of `verify.yml`'s
runs on `main` — never a transcript, never a log — files an issue at **three**, and is retired by
move 10 rather than by a count.

`DESIGN.md` §11's unfiled question 5 said only that bypass is *"countable, therefore free, and the
counter belongs in §6."* Three of the ticket's own premises gave way on measurement.

## The corpus cannot hold this, and that is by design

The leading candidate was the session corpus — capture is global
([ADR-0018](0018-capture-runs-globally-the-auditor-and-the-release-run-in-thi.md)), it lands in
`Knowledge-Base/raw/sessions/`
([ADR-0020](0020-the-session-corpus-is-stored-in-knowledge-base-raw-sessions.md)), and the in-turn
failure is in the transcript.

It is not in the capture. `shared/spine.ts` states its own rule — *"the tool traffic (results, diffs,
output) stays out"* — and hook feedback reaches the transcript as a harness-injected user entry, which
the `origin.kind === "human"` filter drops. Measured 2026-08-26: the gauntlet's block message appears
in **22 raw transcripts** and in **0 of 1,522 captures**.

The raw transcripts that do hold it live at `~/.claude/projects/`, which
[ADR-0002](0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)'s eligibility rule
fails on both clauses — workstation off, and committed contents alone. The only legal route to that
evidence would be extending the capture hook to stamp a count into its `SessionRecord` note, which is
new machinery on a hook bound to fail open, for a number the next section says is not wanted.

## Why the in-turn bypass is not counted, which is what makes it one counter

The ticket asked whether the in-turn bypass and the push bypass are two mechanisms. They are one,
because only one of them is a defect.

`gauntlet-hook.mjs` already argues it: *"a red suite mid-task is a legitimate state — a TDD red phase
is exactly that shape."* An agent that ignores a turn-end failure and pushes green cost nothing and
lost nothing. The harm exists only where the red survives to trunk — and there, `--no-verify`, a clone
where `npm ci` never ran, and a commit made outside a Claude Code session are indistinguishable and
identical in consequence. Counting the in-turn signal separately measures an agent's manners; counting
the trunk event measures whether `main` is broken, which is what blocker 5 was ever about.

The reading this gives up: a count of ignored in-turn feedback would diagnose whether lane 06's
cheapest venue is earning its keep, which is
[ADR-0003](0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md)'s question pointed at
a venue. That is a lane 06 deletion question, and it is not open.

## The evidence already exists, and has never been read

`verify.yml` has run **34 times on `main`**. Six failed: two at `actionlint` — not a bypass, that is
the Actions venue catching the one thing the free venues cannot see — and **four at the Gauntlet
step**, all four confirmed exit 1 by `--- test ---` in their logs. Roughly one push in nine reaching
trunk with a tree the free venues would have refused, produced continuously since 2026-08-23, read by
nobody.

So the mechanism is a reader, not a recorder. Nothing new is captured, stored or spent.

## Exit 2 is excluded by construction

`bin/gauntlet`'s third exit code is *"the checks could not run"*, deliberately not a finding — §06:
*"an environment problem reported as a finding is how a repo learns to ignore its gates."* Today
`verify.yml` runs the gauntlet as one step, so exit 1 and exit 2 fail identically and a missing
`node_modules` would be counted as an agent routing around a gate.

The step captures its own exit code and fails through **two distinctly named steps** — `Gauntlet` for
exit 1, `Gauntlet could not run` for exit 2. The counter reads the failed step's name from run
metadata and never sees exit 2 at all. It excludes the actionlint failures by the same mechanism, for
free.

**Rejected: parsing the logs for the exit code.** The only thing in a log that separates exit 1 from
exit 2 is a string `bin/gauntlet` happens to print — `--- test ---`, `gauntlet: … checks not run`.
Nothing guards that format, so the counter would hold a second, unwatched copy of a fact the runner
already has, which is the same defect
[ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md) rules out when it
says a contract's `why` names a declaration site and never a measurement. §06 says it more directly:
*a check is defined once; a check defined twice drifts.* Logs are also the expensive read — a zip
download per run against one metadata call for the whole history — but fragility is the argument, not
cost, and a step name cannot be printed wrong by the program it describes.

**Rejected: writing a marker the counter reads back.** §6's counters are recomputed rather than
stored, *"so nothing a counter says can go stale"* — the defect that made 43% of Lumaria's inbox
findings dead on arrival. Step names are already recomputed state.

## The threshold, and the death

**Three** red `Gauntlet` runs on `main`, lifetime, files an issue proposing that **move 10 be brought
forward** — branch protection, ~$4/month, which §06 already names as the only thing that closes this
class. A declined proposal re-proposes only when the count has **grown**, inheriting
[ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)'s shape so the counter
cannot nag. Three rather than twenty for
[ADR-0037](0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)'s reason: the
direction that is cheap and reversible gets the low number, and this one's whole output is a
$4 purchase.

**It fires the day it ships.** The count is already there. That is the finding, not a mis-set
threshold.

**It is one-sided, and it needs no delete trigger.**
[ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) requires anything on
probation to have a firing condition that happens on its own. This one's is a build landing: **move 10
makes its class structurally impossible**, because no red tree reaches a protected branch. It is the
only mechanism in §6 whose success condition is its own deletion, and it is recorded here so nobody
later repairs it by giving it the zero-count delete trigger it does not need.

## Why it is class 7 and not class 1

This is [#102](https://github.com/collod873/claude-workflow/issues/102)'s admission bar in miniature,
and the ruling turns on it. §6's argument for the free counters was that rows 7, 9 and 10 had nothing
at all while rows 1–6 were watched twice over. On its face this counter reads the tree at HEAD —
**row 1**, the most-watched row — which would make it the ninth counter admitted by *countable,
therefore free*, the argument #102 says has no stopping condition.

It is not counting the code. It is counting **the gate not having run**: a check that should have
executed and did not. That is **row 7, absence — what should exist and doesn't**, whose only mechanism
today is the parity counter. Under that reading it is not an exception to §6's admission argument, it
is an instance of it.

## Consequences

**Its reader is the owner, via the brief.** It is the only counter in §6 whose output is a spend
decision, and a spend decision with no reader is not a decision. That settles its row against #102's
first question — a standing counter, not instrumentation.

**A bypass that never reaches `main` is invisible, on purpose.** So is a push of several commits where
an intermediate tree was red and the tip is green: the tip is what reached `main`, and trunk is green.

**`verify.yml`'s `paths-ignore` is not a hole.** A Markdown-only push does not fire the venue, and
nothing in a `.md` file can fail typecheck, lint or the suite — the tree it produces is green by
construction.

**The counter's own trigger changes shape at move 10**, when work arrives by pull request and pushes
to `main` stop. It does not need adapting, because that is the same moment its class closes.
