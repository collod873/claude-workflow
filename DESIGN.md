# The design

**The target.** What the machine *is* — every edge from an idea to a closed ticket, what event fires
it, what it refuses, and where the owner is required. [`GOAL.md`](GOAL.md) says what the system is
*for*; [`INDEX.md`](INDEX.md) says where everything in the estate lives.

It is the map a proposal gets held against, and the reason "we already have a skill for that" stops
being an argument: the map was drawn before the skills were consulted.

---

## 0 · How to read this

Each lane names four things while it is being designed. A lane missing any of them is not a lane:

- **Fires on** — the event. There is no other way in.
- **Refuses** — what it turns away before spending model time.
- **Cost** — model stages per unit of work, and owner minutes. This is the only form in which C1's
  test (*what does this add to the smallest unit of real work?*) can be answered, so it is stated
  per lane rather than summarised anywhere.
- **Sees** — which evidence classes the lane can observe, numbered against the ten-class taxonomy in
  [`finding-what-goes-wrong.md`](https://github.com/collod873/agent-skills/blob/main/docs/research/finding-what-goes-wrong.md)
  §4. C5 is a coverage constraint, and coverage that is not enumerated is coverage that is assumed.
  A lane that produces work rather than findings says **—**, which is a real answer.

### A shipped lane collapses to its contract

[ADR-0025](docs/adr/0025-design-md-carries-no-lane-status-a-shipped-lane-collapses-to.md). When a
lane ships, its section is rewritten down to **six** fields, and every sentence arguing why it was
built that way is deleted. The four above, plus:

- **Binds** — what the lane forces on the design of *another* lane: a venue's budget, a
  bypassability, a cap. It exists because a fact can be load-bearing on a lane that does not exist
  yet without being that lane's trigger, refusal, cost or coverage.
- **Lives in** — the code path, and the ADRs that rule it.

**A lane's status is the shape of its own section.** A contract is shipped. Design prose is unbuilt.
A partly-shipped lane is both at once and the seam is visible, which is more than a status mark ever
said. There are no marks anywhere in this document and nothing here is updated when a lane ships —
**the collapse is the edit that ships it.**

**The one obligation the collapse leaves:** if a fact turns out to live only inside the argument
being cut, it moves into **Binds** or becomes an ADR *before* the argument goes. Never kept in case;
a paragraph kept in case is the manifest this rule exists to refuse.

A row marked **⬤ owner** is a point where Collin is required. There are five, and reducing that
number is the whole project. Two are in the lanes (01, 02); three are outside them — the two taste
calls in §7 and the brief in §8 — and all five are marked where they occur.

The scoring rule: a proposed lane is held against C1–C7 in `GOAL.md` §2. A lane that fails a
constraint is not a smaller lane; it is a different goal, and it does not get built. **This document
is a proposal and does not exempt itself** — what survived that scoring unresolved is §11.

### What one line of change costs

The per-lane costs exist so C1 can be computed rather than argued:

| Path | Model stages | Owner touches |
|---|---|---|
| **Short** (00 → 01 → 05 → 06 → 07 → 08 → 09) | 7, plus 3 per review finding | **1** — two minutes |
| **Long** (adds 02, 03, 04) | 13+ | **2** — plus 5–15 minutes |

Era 4 died at ~7 plan steps for ~3 edits in 1 file. The short path lands on the same number — and
the distinction that matters is that **era 4's seven steps were his.** Seven machine stages costing
one two-minute click is not the same object as seven plan steps costing an afternoon of attention,
which is exactly why routing had to become a machine call
([ADR-0007](docs/adr/0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md)) rather
than a policy that sends every feature long.

---

## 1 · The substrate

**GitHub is not the code host. It is the state machine.** Already ruled —
[ADR-0001](docs/adr/0001-github-is-the-spec-and-issue-tracker.md). Restated here because everything
below hangs off it: a stage has no memory of the one before it, so no coordination state may live
inside a session. All of it maps onto a GitHub primitive.

| Primitive | Carries |
|---|---|
| **Issues** | Work items, and the decisions queued for the owner. One issue, one decision, one answer |
| **Labels** | The state machine itself. Every transition is an event, and every event is a trigger |
| **Sub-issue / blocked-by edges** | The dependency graph, native — not a field in a file |
| **Pull requests** | The unit of review, and the only way code enters the trunk |
| **Actions** | Where every gate runs, structurally out of reach of the agents it judges |
| **Issue comments** | The decision log, permanently attached to the thing it ruled on |

**The rule:** if a fact is not in a committed file or a GitHub object, it does not exist. No agent
may remember anything.

Three properties fall out for free, and each answers a constraint directly:

- **Cold pickup.** Any stage can take any work item without inheriting a conversation. The brief is
  the issue. *(C6 — this is what makes sessions disposable rather than precious.)*
- **Idle is free.** Vanish for two weeks and GitHub does nothing. Waiting is its default state, so
  the away-for-a-week case costs no design at all. *(C3, C4.)*
- **Phone-native.** The GitHub mobile app is already a decision-answering interface. There is no
  dashboard to build, and therefore none to groom. *(C4, C7.)*

## 2 · The three surfaces

[ADR-0002](docs/adr/0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md) already
ruled the venue: work executes on GitHub-hosted runners, never on the workstation. That splits into
three surfaces, and confusing them is how these systems get expensive.

| Surface | What runs there | Shape |
|---|---|---|
| **Actions — reflexes** | Triage, labels, drift checks, refusals, publishing, the gauntlet | Headless, cheap model, no discretion, seconds. Never writes feature code |
| **Cloud sessions — work** | Specification, implementation, review, the standing lenses | One per work item, isolated checkout, minutes to hours. Owner absent |
| **Local session — judgment** | Grilling a shape, driving a design canvas, prototyping, asking "what's stuck" | Short, disposable, output written to a file or an issue before it closes. *(C6)* |

**The failure mode to name:** running implementation locally because it is faster to watch. It is
not faster, and watching is what consumes the decision budget — the actual scarce resource. The
bootstrap that does exactly this today, and its expiry, are in §10.

## 3 · Model assignment

Tier tracks **irreversibility, not difficulty**. A cheap model making a trivially correct choice
that becomes load-bearing across six modules is the worst trade available.

| Model | Runs | Why |
|---|---|---|
| **Haiku 4.5** | Capture, labelling, drift detection, brief formatting, cost accounting | High volume, zero discretion, trivially reversible |
| **Sonnet 5** | Implementation of specified work, refutation, merge warden, fixers | Bounded by a spec and a test suite — the ceiling is the spec, not the model |
| **Opus 5** | Spec authoring, seam selection, slicing, audit, adversarial review, the standing lenses | Being subtly wrong is expensive and invisible. Low volume, high consequence |

Reasoning effort moves on the same axis: mechanical stages low, refuters and the coupling lens high.

---

## 4 · The lanes

Nine lanes. A work item passes through them in order. **⬤ owner** marks a point where Collin is
required — **two of the five are here**, in lanes 01 and 02. The other three are the two taste calls
in §7 and the brief in §8, marked there.

### 00 · Intake

> **Fires on:** the owner creating a work item through any of the three doors below. Nothing else
> in the system is human-initiated.
>
> **Cost:** no model, no owner minutes — a form submit at a red light. · **Sees:** — (it records;
> finding is not its job)

**There is no capture agent.** Ingress takes three forms, distinguished by how much context the
owner has already built:

| Door | When | What enters the system | Next lane |
|---|---|---|---|
| **Micro** — GitHub issue form | At a red light, out and about, phone | A 1-liner. `.github/ISSUE_TEMPLATE/` applies `idea` or `bug` automatically. One required field, *"What's the idea?"* | 01 (Shape) |
| **Tactical** — local `/grill-with-docs` session | At the desk, single-session alignment | The session ends aligned and publishes a GitHub issue with the grilled decisions. The owner invokes `/to-spec` directly while context is hot — **no handoff to a runner**, because the session already holds the nuance and serialising it to an issue loses signal | 02 (Spec, in-session) |
| **Macro** — `/wayfinder` map | Multi-session domain exploration | A closed Wayfinder Map issue (e.g. [Lumaria #751](https://github.com/collod873/Lumaria/issues/751)) carrying ADR rulings, filed sub-issues, and scoped boundaries. Closing the map or applying a `to-spec` label triggers the cloud spec author | 02 (Spec, headless) |

**All three doors produce the same downstream object**: a GitHub issue carrying enough decided
context for lane 02 to synthesise a spec without interviewing the owner.

The design pressure here is friction at a red light, not model quality. Every additional field is a
question asked at the worst possible moment, and the fields worth having — urgency, scope, what it
touches — are exactly what lane 01 exists to work out.

**Lane 00 records; lane 01 interprets.** The owner's words are stored verbatim and never edited,
which is what makes it safe for the next lane to restate them: the original is always there to
check the interpretation against.

**Refusal:** none. Capture must never refuse, or ideas get lost, which is the one thing it exists
to prevent. It also never *dispatches* — a filed idea is a captured observation, not approved work.

**On blockers:** this does not retire blocker 2. Blocker 2 is that nothing in the system can start
work, and that is retired by the connectors in moves 5–7. Lane 00 moves the entry keystroke from a
desk to a phone, which is worth an afternoon and is not the same claim.

**Ingress is a GitHub object from the first moment**, which is why the substrate rule in §1 costs
nothing here. A session may also file an idea when the owner explicitly says so; that capability is
deliberately written down nowhere, so no agent is primed to volunteer ideas of its own — F2 is the
system becoming its own biggest customer, and an invitation in `CLAUDE.md` is read at the start of
every session.

**The one exception is a defect in the machinery itself**, which any run may file unasked —
[ADR-0009](docs/adr/0009-the-machine-may-file-defects-against-itself-but-never-featur.md). Defects
only, never features, and **always into this repo whichever repo the run was working in**: a lane
that misfires while working on a product is not that product's bug, and filing it beside that
product's bugs buries it where nobody who can fix it is looking. That is why the lane-00 scope note
below is about *ideas* and not about defects.

**Scope: this repo only**, until there is evidence about which repos ideas actually arrive for.
Adding another is a copied file. Note that defaults cannot be centralised — GitHub requires a
public `.github` repository for default community health files, which does not cover a private
estate.

### 01 · Shape

> **Fires on:** the `idea` label. **Refuses:** at stage 1, an idea that already exists or that an
> ADR has already ruled on — the chain stops there and never spends the shaper.
>
> **Cost:** 3 model stages (Haiku, Opus, Sonnet), under a dollar per idea; **2 owner minutes**,
> batched. · **Sees:** prior art, which is not an evidence class — its input is an opinion, not an
> artifact. This is why §01 cannot get surprised, and why the transcript lens exists

Three stages, serial, one agent each. Each consumes the last, so there is no parallelism to buy.

| Role | Model | Count | Does |
|---|---|---|---|
| Sweep | Haiku | 1 stage | Prior art: issues open and closed, `docs/adr/`, `CONTEXT.md`, docs — repo-deep, plus a title sweep across the owner's other repos. Its second job is **building stage 2's reading list** |
| Shaper | Opus | 1 stage | Restates the idea as work, then walks the decision tree — proposing N decisions each with a recommended answer and the alternatives it rejected. Gets a **prepared context and no search tools** — the idea verbatim, `CONTEXT.md`, `CODING_STANDARDS.md`, and the sweep's list ([ADR-0030](docs/adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md)) |
| Refuter | Sonnet | 1 stage | Attacks the **recommendations**, not the idea. Reports only what survives; silent when it agrees |
| ⬤ **owner** | — | 2 min, batched | `approved`, `parked`, `killed`, or a comment requesting a change |

**The output is a decision sheet, not a critique.** This is what makes the accept a real click:
approving a bare one-liner asks the owner to originate an opinion, and §7 is the whole argument for
converting that into reacting to something concrete.

**The scarce resource is the length of what the owner reads**, not the money — the whole chain is
under a dollar per idea. So the sheet is capped at a phone screen, five sections and no others:

| Section | Cap |
|---|---|
| Restatement | ≤ 1 paragraph |
| Prior art | ≤ 3 lines, each a link plus why it bears on this idea. `none found` is a legal line |
| Decisions | ≤ 5, ≤ 2 lines each — the recommended answer and the alternative rejected |
| Surviving refutations | ≤ 3 lines. **Absent** when the refuter is silent, never `none` |
| Route | 1 line — short or long, with the reason (§01a) |

Anything that does not fit is **cut, never appended.** Prior art earns its funded space because it
is the only section that can pre-empt the whole sheet: three links saying *you already ruled this*
is a kill the owner can make in ten seconds.

Each decision may carry a **mark on a load-bearing assumption**, and the mark **names the thing that
moves** when the answer flips — another decision on the sheet, or an existing artifact: an ADR, a
shipped lane's contract, a file. A mark that names nothing is malformed and is stripped
mechanically, so the test needs no judgement at check time
([ADR-0028](docs/adr/0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)). That mark
does double duty: it is also the first of the three ADR tests, *hard to reverse* — which is why it
may point off the sheet at all. A decision that moves nothing else on the page can still be
expensive to unwind, and under the narrower reading it went unmarked, so no ruling was filed for
exactly the decisions that most needed one.

**The sheet is a comment on the idea issue, and a re-run posts a new comment** — the latest is live.
Editing in place reads more tidily and is forbidden: ADR-0006 stakes a prediction on this lane —
if the override rate on sheets resembles the 73-of-81 rate from mid-work questions, *the sheet is at
fault* — and that number is only computable if the earlier rounds survive to be compared against
what the owner actually did.

**Accepting the sheet is what files the ADRs** and any term the shaper had to coin —
[ADR-0005](docs/adr/0005-accepting-a-shaped-idea-is-what-files-its-adrs.md),
[ADR-0006](docs/adr/0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md). Lane 02 then
cites those rulings rather than restating them, which is what keeps a follow-up ticket from
re-deciding something already settled.

That accept is **W5 — agents draft, the owner signs** — as a mechanism rather than a maxim: the
signature is a label, and it is the same click that starts the work. It is also the first half of
**W4**, because the ruling lands in `docs/adr/` next to the code it will govern at the moment it is
made, not whenever somebody remembers to write it down.

**All four owner verbs are labels**, never comment prose — a label is something a gate can fire on.

| Verb | Triggers |
|---|---|
| `approved` | Files the ADRs from marked decisions passing the three-part bar, coins any new `CONTEXT.md` terms, dispatches on the route. The same click starts the work |
| `go-long` / `go-short` | Optional, alongside `approved` — the one-word route override ADR-0007 asks for |
| `parked` | No dispatch. Drops the `idea` label so this lane cannot re-fire. The sheet stays as the record and **nothing ever re-raises it** — §8's five-day expiry does not reach it, because parking removes it from the queue. Anything that resurfaces parked work is a nag, and C4 says a nag dies by month three |
| `killed` | Closes the issue, and becomes **prior art with teeth**: stage 1's refusal reads closed ideas, so re-filing the same idea is refused with a link to the kill and never reaches the shaper |
| a comment | A change request — re-runs the shaper, capped at 2 rounds, then it posts as-is and only `approved` / `parked` / `killed` remain. Uncapped is the fixer mistake in a new place |

**The shaper may refuse to shape** when the decision tree will not close under five decisions. That
is the honest *"needs a live session"* — the same instinct as §02's *a spec with zero open questions
is suspect*, pointed the other way — and it costs no new number, because the sheet's own cap is the
condition. Marks route; they never refuse
([ADR-0029](docs/adr/0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md)).

**The shaper cannot discover that its own context is incomplete**, which is the price of taking its
tools away. So it may emit **one** re-sweep request naming what it needs and why, re-running the
sweep with that gap as an explicit target. If the second sweep still does not produce it, the shaper
marks the affected decision — pointing at the gap — and writes the sheet anyway. One cheap Haiku
stage against this lane's only failure, capped at one round so it cannot loop.

**The refuter is on probation, and the probation is a count.** At the **20th sheet posted with zero
surviving refutations**, the counter files an issue proposing its deletion —
[ADR-0031](docs/adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md). It files
an issue and never deletes the stage itself, per §6's rule that counters produce issues and never
notifications; a declined proposal re-proposes only when the count has grown. A third agent asked
*"do these look good?"* answers yes almost always — that is the pc-build failure, an agent judging
its own kind. Asked to **kill** them, silence is the good outcome, which is exactly why the
probation needed a firing condition that silence alone could not satisfy forever.

**C1 forces the sizing.** The Foundry runs three adversaries plus a synthesiser on every idea; four
Opus sessions against a one-line fix is exactly the era-4 death (~7 plan steps for ~3 edits).

**What this lane cannot do is get surprised.** It only ever surprises itself, so its failure mode is
a confident, coherent sheet resting on a wrong premise — which is precisely what the transcript lens
in §6 exists to catch. The assumption marks are the reviewable form of that, and they are the
lane's only defence.

### 01a · The short path

**Below the short path is a direct path.** A small defect or UI tweak that the owner can hold in
one session — 1–3 files, no concurrency, no multi-module coordination — skips lanes 01 through 04
entirely. The owner edits, the gauntlet and review (lanes 06–07) still run on the PR, and that is
the whole ceremony. The direct path exists because the alternative is era 4: seven plan steps for
three edits. It is safe because it is **never unguarded** — every PR still passes through the
gauntlet and review, which are the lanes that catch regressions, not the lanes that prevent scope
creep. The risk it accepts is building a small wrong thing; the risk it avoids is not building
anything because the overhead exceeded the work.

A defect carries a failure that already happened; a feature carries an opinion about what would be
better. The sheet ends with a **route recommendation**, and the owner's accept takes it or a
one-word override sends it long. That is C2's shape — machine judgement with a reviewable
checkpoint, never a human quiz. Commit `68b071f` deleted a sizing quiz for asking the owner
senior-dev questions; making him the sizer here would rebuild it.

**The short path may skip spec, slice and acceptance-authoring. It may never skip the gauntlet or
review** (lanes 06–07), and **more than half the sheet's decisions carrying a mark** sends it long
regardless — a shaper guessing at that much of an idea cannot route it either. The threshold is a
fraction rather than a flat count because a flat 3 waves through a two-decision sheet with both
marked, which is plainly an idea nobody understands (ADR-0029, amending ADR-0007's original ~3).

That threshold is **the only thing holding the line on the expensive misroute**, and it is a guess
until sheets exist to count — ADR-0028 widened what a mark may point at, so more items get marked
and more route long. **The share of items routed long is the number to watch.**

**It is available to features as well as defects** —
[ADR-0007](docs/adr/0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md). An earlier
draft reserved it for defects, reasoning that a small-looking feature is exactly where the ceremony
earns its keep. Nothing in the record supports that, and C1 says the opposite: no era was ever
replaced for producing bad output, and era 4 died spending ~7 plan steps on ~3 edits in 1 file.
The two errors are not symmetric, which is the whole argument. A wrong **short** route sends a
feature to the gauntlet without a spec — visible, because lanes 06–07 still run, and recoverable by
re-shaping. A wrong **long** route buys era 4's overhead and leaves no trace anywhere, because
nothing records the ceremony an item did not need.

### 02 · Spec

> **Fires on:** any of the three triggers below. **Refuses:** an idea whose adversary comments have
> not been answered; a Wayfinder Map with unresolved stubs.
>
> **Cost:** 2 Opus stages; **5–15 owner minutes**, batched — the most expensive owner touch in the
> system, and the one that pays for itself. · **Sees:** —

`/to-spec` exists but is local-only, which makes it a keystroke gate on every unit of work. Move 6
puts it on a runner.

| Role | Model | Count | Does |
|---|---|---|---|
| Spec author | Opus | 1, cloud | Opens a PR adding a spec. Two non-negotiables: acceptance criteria **quote the owner's words**, and every place it had to invent intent becomes a numbered open question rather than a silent assumption |
| Spec critic | Opus | 1, on PR open | Hunts only for underspecification — sentences admitting two implementations, criteria that cannot be observed. It does **not** propose fixes; proposing lets it paper over the ambiguity it exists to surface |
| ⬤ **owner** | — | 5–15 min, batched | Answer the open questions. This is the one place where going slower makes you faster |

**Three triggers, one output.** Each produces the same PRD issue; they differ only in where the
decided context lives:

| Trigger | Source of context | Surface | Session state |
|---|---|---|---|
| `approved` label on a Decision Sheet | Lane 01's shaped decisions + ADRs | Cloud (Actions) | Cold — no conversation to inherit |
| Owner invokes `/to-spec` after `/grill-with-docs` | Live conversation context | Local session | Hot — full nuance in the context window |
| `to-spec` label on a closed Wayfinder Map | The map issue body: ADR rulings, filed sub-issues, scoped boundaries | Cloud (Actions) | Cold — but the map is self-contained by design |

**Why the tactical door stays local.** Serialising a live grill to an issue so a runner can read
it back is lossy compression that pays double tokens for less signal. The owner is already sitting
there; one more prompt costs seconds. The cloud path exists for the cases where the owner is
*not* sitting there — a Wayfinder Map closed yesterday, or a shaped idea approved from the phone.

**A spec that ships with zero open questions is treated as suspect** — it guessed silently. This is
C2 done correctly: the machine asks about *intent*, which the owner is the only one who can answer,
and never asks a sizing or architecture question, which he cannot.

### 03 · Slice

> **Fires on:** the `prd` label.
>
> **Refuses:** a PRD that already has sub-issues; a PRD that is itself a sub-issue; a missing
> `CLAUDE_CODE_OAUTH_TOKEN`.
>
> **Cost:** 3 Opus stages per spec — seam sweep, slicer, auditor-and-publisher. No owner minutes.
>
> **Sees:** —
>
> **Binds:**
> — It emits the **seam manifest**, one line per shared shape. Lane 05's brief carries it, and the
> one-line bound is load-bearing: every line is injected into every consuming ticket's body and
> therefore into every worker's context.
> — **The seam picker runs at slice time, not at spec time**, so lane 02 does not owe an interface
> contract before slicing. Neither placement follows from a constraint; the built one holds until a
> slice fails in a way that names the answer.
> — Physical disjointness is drawn here, which is what makes lane 05's 3–6 concurrent implementers
> safe to run at all. That is **W3**, and lane 08 is its merge-time complement rather than a
> replacement.
> — Every `dependsOn` is published as a native blocked-by edge and read back to verify, so the
> dependency graph is a GitHub object rather than a field in a file.
>
> **Lives in:** `.Workflow/agent-workflows/to-tickets/`, fired by
> `.github/workflows/to-tickets.yml`. [ADR-0012](docs/adr/0012-a-stage-s-output-block-is-the-outermost-span-and-the-payload.md).

### 04 · Acceptance

> **Fires on:** a slice published, **or a merged edit to a spec that already has acceptance tests.**
> **Refuses:** a criterion the spec does not determine — that is a spec defect, and the correct
> output is a `spec/gap` issue, not an invented test.
>
> **Cost:** 1 Opus per slice. · **Sees:** class 5 (the runtime) and class 6 (promised vs delivered),
> both moved earlier — the tests exist before the code does

| Role | Model | Count | Does |
|---|---|---|---|
| Acceptance author | Opus | 1 per slice, isolated | Writes tests **from the spec only**, with no access to an implementation — because none exists yet. Each test names the criterion it proves, verbatim — which is **W4's endpoint**, documentation a test suite can fail on. Merged to trunk **before** any implementer is dispatched |

**Then the load-bearing part:** CI refuses any implementation PR that modifies a file under
`tests/acceptance/`. An implementer that cannot pass a test cannot quietly rewrite it — it can only
fail, escalate, and land in the queue as blocked.

**Immutable is not frozen, and the difference is where the grooming would have hidden.** A spec that
legitimately changes would otherwise strand its tests with nobody permitted to touch them, and
"someone updates the acceptance tests" is exactly the maintenance obligation C4 refuses to build. So
`tests/acceptance/` has **one author — this lane — and one way to re-enter it:** a merged edit to
the spec re-fires the acceptance author for the affected slices only, on a PR of its own, before any
implementer resumes. The thing that checks is still never the thing that built, no matter how many
times the spec moves.

This is the single highest-value item on this page. It is **W2 made structural** — the thing that
checks is never the thing that built — where era 6's `close-gate.py` is the weak form of the same
idea, because the closing record it reads is authored by the agent being judged. It is also the
mechanism that makes the whole out-of-the-loop premise safe: without it, the fleet's output is
unverifiable, which makes it worthless, which puts the owner back in the loop reading diffs.

**It runs at the Actions venue** — lane 06 binds that, along with the 10-minute budget it has to fit.

### 05 · Build

> **Fires on:** `ready` **and** a free slot under the governor's cap. **Refuses:** dispatch when the
> owner's decision queue is full (§8).
>
> **Cost:** 1 Sonnet per slice, plus up to 3 fix attempts on red. · **Sees:** — while it runs;
> class 4 at the end of it, via write-on-surprise below

`/implement` and `/drain` exist locally. `/implement` is ported and narrowed by this lane; `/drain`
does not survive the map — [ADR-0027](docs/adr/0027-six-of-era-6-s-eleven-verbs-do-not-survive-the-map-and-two-s.md).

| Role | Model | Count | Does |
|---|---|---|---|
| Implementer | Sonnet | 3–6 concurrent, isolated checkout | Brief is the ticket, the seam manifest, the module's `CONTEXT.md`, and the failing tests — **not** the repo. An implementer that reads broadly couples broadly. Needing to read another module means the interface is wrong, which is a `seam/question` issue, not its call to fix |
| Fixer | Sonnet | 1 per red PR, **max 3 attempts** | Attempts to green a failing build, then labels `blocked`, writes what it tried, and stops. Uncapped fixers are how you find out on Sunday that something ground against a wall for eleven hours |

**The fixer is what unlocks the last move.** It is the only thing in the design that clears a red
without the owner, so nothing may be promoted to refusing before it exists —
[ADR-0011](docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md), and the reason branch
protection sits at move 10 rather than move 1.

Concurrency sized to one operator's review rate, not to available compute — see §8.

**Every run ends with one question:** *what did you learn that, had you known it at the start, would
have changed what you did?* A real answer is appended to the module's `CONTEXT.md` — the file the
next implementer's brief already loads, so it is read by construction rather than by hope. Nothing
means nothing gets written; the bar is surprise, not diligence.
[ADR-0008](docs/adr/0008-a-run-ends-by-writing-what-surprised-it-into-the-module-s-co.md). This is
W6 — *write the autopsy while it still stings* — and it is the only thing that carries a run's own
class-4 evidence out of a transcript nobody would otherwise read.

### 06 · Verify

> **Fires on:** every edit, every turn end, every push, every PR — one venue each.
>
> **Refuses:** the edit, the turn, the push, the merge, respectively. The three venues below Actions
> **fail open**; the push venue **fails closed**. A hook that cannot run its checks — no node on
> PATH, no `node_modules` — stays silent and lets the turn through, because a convenience venue that
> wedges every turn in the repo is worse than the defect it was hunting. The push venue refuses
> instead, because a human is standing there and the next thing downstream is `main`.
>
> **Cost:** no model at the first three venues, Actions minutes at the fourth.
>
> **Sees:** class 1 (the tree at HEAD) and class 5 (the runtime).
>
> **Binds:**
> — **A check sits at the earliest venue whose budget it fits**
> ([ADR-0010](docs/adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)). The
> budgets: **<1s** in the turn, **<10s** at turn end, **<60s** on push, **<10min** in Actions,
> unbounded overnight. What earliest buys is a cheap *repair*, not a cheap check — a type error
> caught in-turn is fixed by the implementer that caused it with context still hot; the same error
> in Actions costs a cold fixer run reconstructing what the implementer already knew.
> — **Anything needing a runner runs at Actions, under the 10-minute budget** — integration, a
> seeded database, lane 04's acceptance tests, contract tests against lane 03's seam manifest.
> Nothing below Actions can carry them.
> — **Every venue below Actions is bypassable.** `--no-verify` skips the push and commit hooks; a
> `PostToolUse` hook is fed back as tool output and an agent may read it and proceed anyway. Until
> move 10 there is **no venue an agent cannot route around**, and nothing counts how often one does.
> — **No venue is promoted to refusing above a flaky check.** A flaky gate trains `--no-verify` and
> is worse than a slow one. A "could not run" is a third exit code rather than a failure, because an
> environment problem reported as a finding is how a repo learns to ignore its gates.
> — **A test's timeout is sized for the slowest venue it runs in**
> ([ADR-0015](docs/adr/0015-a-test-s-timeout-is-sized-for-the-slowest-venue-it-runs-in-n.md)).
> — **Every defect that escapes to the owner adds a gate**, at the lowest venue that could have
> caught it, at the moment the defect proves it missing. That growth is not grooming under C4
> because no review cycle triggers it. Adding every escape to Actions by default is how the gauntlet
> becomes the bottleneck it exists to prevent.
> — A check is defined **once**; the venue chooses only the scope and the failure mode. A check
> defined twice drifts.
>
> **Lives in:** `bin/gauntlet <turn|stop|push>`, called by `.claude/hooks/` (`PostToolUse`, `Stop`),
> `.husky/pre-push` and `.github/workflows/verify.yml`. Self-installing via `"prepare": "husky"`, so
> the hook installs itself on a runner and in any fresh clone. ADR-0010, ADR-0015.

**Retires blocker 5** — the only unambiguous regression in the six-month record: 12 broken commits
reached `main` in five days, all genuine breakage.

**Two venues are still unbuilt**, and they are the design content left in this lane:

| Venue | Budget | Carries | State |
|---|---|---|---|
| **In Actions** — on the PR | <10min | Integration, seeded database, anything needing a runner; acceptance tests (lane 04); contract tests against the seam manifest | `verify.yml` runs but **refuses nothing**. Branch protection is move 10 — it costs $4/month, because protected branches do not exist on a private repo under the Free plan |
| **Overnight** | unbounded | Broad sweeps, visual regression, flake quarantine re-runs | Absent, and dormant until a repo has a UI |

**Every check fits every venue here, and that is a fact about this repo's size rather than a
principle.** `bin/gauntlet` times itself against the budgets above and says so when it is over, which
is the only thing that will ever tell us to split them.

### 07 · Review

> **Fires on:** CI green. **Refuses:** nothing — this lane produces findings, not verdicts.
>
> **Cost:** 2 Opus per PR, plus 3 Sonnet per finding. The most expensive lane per unit of work, and
> the refuters are the reason its output does not cost more downstream than it does here. ·
> **Sees:** class 2 (a single diff) and class 6 (spec conformance)

| Role | Model | Count | Does |
|---|---|---|---|
| Correctness reviewer | Opus | 1 per PR | Hunts defects, not style. Style is the linter's job and arguing about it in review is pure noise |
| Conformance reviewer | Opus | 1 per PR | Reads the **spec first, then the diff**, and answers one question: does this do what the spec said, or what the code says it does? An agent that reads the implementation first will rationalise it |
| Refuter ×3 | Sonnet | 3 per finding, parallel | Every finding gets three independent agents trying to **kill** it. Default to refuted when uncertain. Majority-refuted findings are dropped without ever being seen |

The refuters are not a quality mechanism — they are the **queue-length mechanism**. C7 caps the
owner's queue at ~7; a review layer with no filter fills that cap with noise in a day, and the next
round of alarms gets trusted less. A false alarm that reaches the owner costs more than a caught bug
missed here. **How many refuters it actually ships with is open** — see §11.

**Not an agent's job.** Scale, cost-to-run and architectural fragility fail silently and late, and
neither the owner nor an agent can verify an agent's judgement on them. That is a contract
engineer for a half day, twice a year. A line item, not a gap to engineer around.

### 08 · Integrate

> **Fires on:** PR approved. **Refuses:** a merge whose gauntlet has not been re-run against current
> trunk.
>
> **Cost:** 1 Sonnet per merge, serialised. · **Sees:** class 2, but across a *pair* of diffs — the
> semantic conflict that neither diff shows alone and no single-diff reviewer can

| Role | Model | Count | Does |
|---|---|---|---|
| Merge warden | Sonnet | **exactly 1, serialised** | Rebase, re-run the full gauntlet against current trunk, merge, deploy preview. Builds fan out; merges do not |

Its real value is the **semantic** conflict that git merges cleanly: two PRs that both compile, both
pass, and together mean the product now has two ways to do one thing. It files a coherence issue
instead of merging.

This is the merge-time complement to W3, which lane 03 implements at authoring time. Authoring-time
disjointness prevents textual conflict; nothing prevents semantic conflict. **What a semantic-conflict
finding looks like, and what the warden does instead of merging, is not yet specified.**

### 09 · Close

> **Fires on:** `issues.closed`.
>
> **Refuses:** the close — reopens the issue and comments why. Only a close marked `completed` is
> judged; *not planned* and *duplicate* assert that nothing was delivered, so there is no claim to
> verify ([ADR-0013](docs/adr/0013-the-close-gate-judges-only-a-close-marked-completed.md)).
>
> **Cost:** no model where the closing record parses; 1 Haiku where it does not.
>
> **Sees:** class 6 (the tracker — promised vs delivered).
>
> **Binds:**
> — **It is a compliance mechanism and is not a correctness one.** A well-shaped lie passes;
> `unmet-criterion` fired exactly **once in 558** era-6 rows. The lane that makes this a correctness
> gate is **04**, and nothing may be built on a claim that this gate checks whether the work was
> actually done.
> — **A model may translate evidence into the gate's grammar, but never render the verdict**
> ([ADR-0014](docs/adr/0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md)). A
> salvaged record goes through the identical evaluator a hand-written one does.
> — **`No diff.` excuses the range and nothing else**
> ([ADR-0022](docs/adr/0022-no-diff-excuses-the-range-and-nothing-else.md)).
> — **`close-refused` is state, not history** — a passing re-close lifts it
> ([ADR-0023](docs/adr/0023-the-close-refused-label-is-state-not-history-a-passing-re-cl.md)).
> — **One gate per rule.** The workstation close hook is stood down for this repo
> ([ADR-0021](docs/adr/0021-one-gate-per-rule-the-workstation-close-hook-stands-down-whe.md)); the
> era-6 estate still runs it and still has the hole.
> — **The one way past it** is closing a delivered ticket as *not planned*. Narrower than the hole it
> replaced, deliberate rather than forgotten, and **countable** — §6 flags the counter.
>
> **Lives in:** `.github/workflows/close-gate.yml`, `.Workflow/agent-workflows/close-gate/`.
> ADR-0013, ADR-0014, ADR-0021, ADR-0022, ADR-0023.

**Retires blocker 1, structurally.** The venue is what does it: `issues.closed` fires no matter *how*
an issue was closed — keyword, phone, web UI — and an Action that errors is a red run rather than a
silent pass. A gate that cannot be routed around is the precondition for stepping back at all.

---

## 6 · The standing lenses and counters

Ten things get read while nobody is watching. Seven spend a model; three only count. Each is
attached to the event that makes it non-vacuous, which is what distinguishes a lens from a cadence.
Nothing in this system runs on a clock —
[ADR-0004](docs/adr/0004-a-clock-may-release-a-batch-but-may-never-originate-work.md).

**Sees** numbers the evidence class each one can observe, against
[`finding-what-goes-wrong.md`](https://github.com/collod873/agent-skills/blob/main/docs/research/finding-what-goes-wrong.md)
§4. C5 is a coverage constraint; the ledger below is how it gets scored rather than asserted.

| Lens | Model | Fires on | Reads for | Sees | State |
|---|---|---|---|---|---|
| **Diff** | Opus | CI green | Defects and spec conformance — lane 07. Catches almost nothing else | 2 | lane 07 |
| **Transcript** | Opus | Session end, batched | The moment an agent **guessed at intent and moved on** — hedge language before a consequential choice, a requirement restated in weaker terms, an assumption stated once and never revisited. Correct-looking code with a wrong premise leaves fingerprints in the transcript that are invisible in the diff | 4 | unbuilt |
| **Decision log** | Opus | An ADR or ruling recorded | Contradiction: *"you ruled in March that X, this week you ruled Y — one of these is stale."* It never pre-answers on the owner's behalf | 8 | unbuilt |
| **Spec** | Haiku | A merge touching a module | Drift. A lying spec is worse than no spec, because every agent downstream believes it forever | 8 | unbuilt |
| **Coupling** | Opus, high effort | N landings in a module since its last read | Duplicated concepts, three implementations of one idea, a module that has quietly grown a second responsibility. Output is a small number of ranked refactor issues | 3 | unbuilt |
| **Violation** | Sonnet | Session end | A landed diff breaking a **ratified** `CODING_STANDARDS.md` rule that no linter enforces | 2 | built |
| **Proposed** | Sonnet | Session end | A smell worth a new standard — **held until a second site appears.** The two-site gate is C3's second-site trigger pointed at findings | 3 | built |

**The standards chain, absorbed and built.** `/standards-pass` → `/ratify` → `/standards` is these
two lenses (ADR-0027). Their contract:

> **Fires on:** a session ending in this repo, which derives its own SHA range, publishes it as a git
> note and dispatches the audit.
>
> **Refuses:** a PROPOSED finding with only one site — the two-site gate
> ([ADR-0019](docs/adr/0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)). A
> declined finding re-proposes only when its recurrence *grew*.
>
> **Cost:** 2 Sonnet passes per session over its own SHA range. · **Sees:** classes 2 and 3.
>
> **Binds:**
> — Observations live as **git notes on their own ref**, keyed to the commit they describe
> ([ADR-0016](docs/adr/0016-observations-live-in-git-notes-on-their-own-ref-keyed-to-the.md)) —
> `refs/notes/observations`, and the session corpus at `Knowledge-Base/raw/sessions/`
> ([ADR-0020](docs/adr/0020-the-session-corpus-is-stored-in-knowledge-base-raw-sessions.md)).
> — Release fires **on a PRD close or at N=20 unreleased findings** — never on a clock, never N
> issues ([ADR-0017](docs/adr/0017-release-fires-on-a-prd-close-or-on-n-unreleased-observations.md)),
> and lands as **one** pull request.
> — **Capture runs globally; the auditor and the release run in this repo only**
> ([ADR-0018](docs/adr/0018-capture-runs-globally-the-auditor-and-the-release-run-in-thi.md)) —
> recording is not executing work, so ADR-0002 does not reach it.
> — COMPOSITION and SEAM were dropped on 27 verified findings and do not come back without new
> evidence.
>
> **Lives in:** `.Workflow/agent-workflows/observations/`, `.claude/hooks/session-capture.sh`,
> `.github/workflows/audit.yml`, `release-on-prd-close.yml`, `ratify-release.yml`. ADR-0016 through
> ADR-0020.

The transcript lens is probably the highest-yield item on this page, and it now has a corpus to be
written against — capture landed, and the `cleanupPeriodDays: 30` clock that was destroying a day of
corpus per day has stopped. Backfill salvaged 11 sessions against 841 from the era that ran a
recorder, which is the honest price of the three months without one.

### The coverage ledger

| # | Evidence lives in | What looks at it here |
|---|---|---|
| 1 | The tree at HEAD | Lane 06 — typecheck, lint, test |
| 2 | A single diff | Lane 07, the diff lens, and the violation lens |
| 3 | Recurrence across diffs | The coupling lens, and the proposed lens's two-site gate |
| 4 | The transcript | The transcript lens; write-on-surprise at the end of every run (lane 05) |
| 5 | The runtime | Lane 06; lane 04's acceptance tests, moved ahead of the code |
| 6 | The tracker | Lane 09's close gate; lane 07's conformance reviewer |
| 7 | **Absence** — what should exist and doesn't | **The parity counter**, below |
| 8 | **Drift** — this was true and stopped being | The spec lens, the decision-log lens, and the backwards question |
| 9 | **The owner's behaviour** — corrected, reverted, asked twice | **The correction counter**, below |
| 10 | **Across repos** — not a repo rule, a rule | **The cross-repo counter**, below |

Drawing this ledger is what produced the counters. Rows 1–6 were already watched two and three times
over, by four Opus lenses and two whole review lanes; rows 7, 9 and 10 had nothing at all — and
every one of them is **countable**, which is to say free. That is the taxonomy's own finding pointed
at this design: *the current system spends models on everything it already covers and counts nothing
in the places it doesn't. The dreamboat is not more model passes.*

### The three free counters

| Counter | Fires on | Counts | Sees |
|---|---|---|---|
| **Parity** | A slice published, beside its siblings | A structural shape its sibling units have and it does not. Absence is only ever visible by comparison | 7 |
| **Correction** | A session ends; a commit reverted, or added and deleted the same day | Collin's corrections, and same-day reversals — a labelled failure sitting in `git log`, judged already by a human, free to read | 9 |
| **Cross-repo** | A finding recorded, in any repo | The same slug arriving at a second site in a second repo. C3's candidate trigger, applied across the estate | 10 |

**A fourth candidate is flagged rather than built.** ADR-0013 scopes the close gate to a close marked
`completed`, which leaves one way past it: closing a delivered ticket as *not planned*. It is class 6
and **countable**, which by this section's own argument makes it free. The count is `not_planned`
closes on issues that carry `## Acceptance criteria`. It waits behind the three above because they
have volume and it should have none; the first time it has any is the finding.

None of the three spends a model, and all three can run on every push: counting produces no commits,
so it cannot feed on its own output. A count is also recomputed rather than stored, so nothing a
counter says can go stale — which is the defect that made 43% of Lumaria's four weeks of inbox
findings dead on arrival.

**The cross-repo counter is the mechanism C5's originating question asked for** — *"this repo owns
the skills so when it makes changes like that which should effect our other repos how do we catch
that without fail?"* It is also the only thing on this page whose value grows with the **estate**
rather than with the pipeline, which is what turns §11's scope question from a blocker into a
sequencing question: it is worth building at two repos and worth more at twenty.

It is also the carrier for a machinery defect found outside this repo. ADR-0009 rules that such a
defect is filed here, and a run dispatched into another repo has no write path back — so until one
exists, the run records the defect in its own output and the counter walks it home. That makes the
counter load-bearing rather than merely cheap, and it is the reason move 8a's cross-repo half should
not wait on the rest of that row. It has nothing to count until a second repo is in scope, so it is
built and left idle rather than built late.

**Every lens and counter produces issues, never notifications.** The brief is the only thing that
reaches the owner.

**Everything that claims to catch something is asked whether it ever did**, at the event that would
add another of its kind — the generalisation of
[ADR-0003](docs/adr/0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md). That is
the lenses and counters here, and it is also **the lint rules and the ADRs**, which is where blocker
3's evidence actually lives: 36 rules from 5 standards passes and 30 ADRs in a month, not one of
them ever asked. A lens audit that covers only lenses retires the blocker for the newest thing in
the estate and leaves the oldest untouched. **Retires blocker 3** on that condition, and only on it.

**Cut:** the Foundry's cold-user walkthrough and persona panel. Both need a deployed product with
users; nothing in the estate has one today. They come back the day a repo does — as a lens on
preview deploy, not as a nightly cron.

## 7 · Taste

Taste cannot be delegated, but the **expensive part** of it can. Originating an opinion from a blank
screen is slow; reacting to something concrete is instant. Every mechanism here converts the first
into the second. This is where `GOAL.md`'s "visual and spatial verdicts" boundary lives — #127's
cleanest finding was that the best-performing month was the one where the human held the eval loop.

1. ⬤ **owner · Freeze the system, allow only composition.** Direction picked once, on a canvas, then frozen
   into tokens and a component library. After that, agents compose only from what exists — a new
   colour, spacing value or font size is a `design/request` issue, and the design-system lint in the
   gauntlet is what makes the freeze real rather than aspirational.
2. ⬤ **owner · Variants for anything novel.** Three real versions, all deployed, owner points. The highest-
   bandwidth taste input that exists, because recognising is the thing prose is worst at capturing.

**Deliberate omission:** no agent pre-answers taste questions in the owner's voice from a corpus of
his past decisions. It encodes preferences he has outgrown, he rubber-stamps its guesses, and drift
compounds invisibly under his name. Same data, opposite direction: use the log to flag
contradictions, never to answer.

## 8 · The governor and the brief

**The owner is the constraint. Feeding a constraint faster does not help.** *(C7.)*

Two hard limits, both enforced at dispatch, both deterministic code rather than an agent:

| Limit | Rule |
|---|---|
| **Queue depth** | More than ~7 decisions waiting → dispatch stops entirely |
| **WIP** | Hard slot count per lane, enforced at dispatch, not guidance |

**There is no third limit.** A daily spend ceiling was struck —
[ADR-0024](docs/adr/0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md): the
pipeline runs on the Claude subscription rather than metered API billing, so there is no unit to
budget in. The real ceiling, if one ever binds, is the subscription's own rate limits, and those
announce themselves at the point of use.

Work started but not reviewed does not sit still: trunk moves underneath it, it rebases badly, its
assumptions expire, and re-doing it eventually costs more than building it did. Excess parallelism
converts money directly into rot.

**Decisions expire.** Anything queued more than five days is re-read before it is shown again, and
withdrawn rather than repeated if the world moved past it. Coming back from two weeks away means a
short current queue, not forty stale questions about a version that no longer exists.

⬤ **owner · the brief** is the only thing permitted to reach the owner. It reads everything that happened,
writes sixty seconds of English, and batches decisions **by topic** so five related questions get
answered at once instead of five context switches. It publishes as a page and pushes one
notification.

**Its window is the only time-shaped thing in the system, and it originates nothing.** The brief is a
release valve on a queue that events filled: an empty queue produces nothing and pushes nothing.
That is the whole content of ADR-0004, and it is what keeps the ship-a-lot-then-vanish-for-a-week
case free.

---

## 10 · Build order

**The moves live as issues**, each blocked-by the ones it waits on —
[ADR-0026](docs/adr/0026-the-build-order-and-the-filed-open-questions-live-as-issues.md). The
current state of the roadmap is
[the `build-order` label](https://github.com/collod873/claude-workflow/issues?q=is%3Aissue+label%3Abuild-order),
which updates itself when work closes. What stays here is why the order is the order.

**Feedback, then repair, then refusal** —
[ADR-0011](docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md). This is *not*
`GOAL.md` §4's order, and an earlier draft claimed it was: blocker 5 sat at move 1 while blocker 1
waited. Blocker 5 is retired in two halves at opposite ends of the list — the free venues first, the
refusal at trunk last — because a gate with nothing behind it parks work rather than stopping it,
and parked work drains onto the owner. The fixer is the only thing in the design that clears a red
without the owner, which is why branch protection waits on the lane that builds it.

**Branch protection costs money and needs a pull request.** This repo is private on a Free account,
so protection is a purchase (~$4/month), not a setting — the API answers `403 Upgrade to GitHub
Pro`. And it has never opened a pull request: work lands by local merge and a direct push to `main`,
which protection forbids. Whatever drives lane 05 by then has to open a PR and let it auto-merge on
green, which is lane 05's shape anyway.

**The bootstrap has an expiry.** Until lane 05 runs on a runner, work on this repo is driven from the
workstation, which ADR-0002 forbids. That is a scaffold, and it expires the moment lane 05 lands.
Until then: **this repo does not grow files to serve era-6 skills.**

**Honest accounting.** The middle of this list is weeks where the owner is *more* in the loop, not
less, and it will not feel like leverage. The free venues were the exception and the reason they went
first: they cost an afternoon, spend nothing, and every hour after them is an hour of agent work that
corrects itself instead of arriving on his desk. The out-of-the-loop dividend beyond that comes
entirely from the boring eighty percent; the parts he cares most about stay his forever. And the
ceiling: this system is bounded by spec quality, not by agent capability — true today, still true
when the models are twice as good, which is the best argument for spending the hour at the top of the
pipeline rather than the bottom.

## 11 · Open questions

Each needs a decision before the lane it blocks can be built. They are **not all the same kind**,
and C2 says the difference is the whole point. An ⬤ **owner** question is about destination, scope
or spend — his to answer, and nobody else's. A **measured** question has a right answer that no one
currently holds the number for, and handing it to him as a choice is the sizing quiz commit
`68b071f` deleted, rebuilt in a document that claims to forbid it.

**Filed.** These live as issues; this list carries the pointer and nothing else (ADR-0026).

| Question | Kind |
|---|---|
| [Whether `contract.json` returns, and what an installer covers](https://github.com/collod873/claude-workflow/issues/82) | measured |
| [How many refuters lane 07 ships with](https://github.com/collod873/claude-workflow/issues/83) — three is a guess, and there is no measured false-alarm rate to size it against | measured |
| [How the governor sizes concurrency, and what the fixer's cap buys](https://github.com/collod873/claude-workflow/issues/84) — the ~7 queue cap and the 5-day expiry are inherited from the Foundry draft and have never been measured against this owner's actual answer rate | measured |
| [Whether an unread document gets deleted automatically](https://github.com/collod873/claude-workflow/issues/85) | measured |
| [What makes an acceptance test immutable, and how a spec change re-enters them](https://github.com/collod873/claude-workflow/issues/78) | measured |

**Not yet filed.**

1. ⬤ **How far does the pipeline spread, and in what order?** *Owner — deferred, not open.* Ruled
   2026-08-23: **this repo and nothing else** until the machine runs here. A second repo is not a
   scope decision waiting on an argument, it is a distraction from a pipeline that has three of nine
   lanes built, and every hour spent porting a venue to another codebase is an hour the lanes above
   do not get. So this page tracks one repo, and other repos appear on it only as evidence.
   The question re-opens on its own terms once lane 05 runs on a runner — that is the first moment
   there is anything worth spreading. The standing recommendation for that day is unchanged and
   cheap: **the gauntlet and the cross-repo counter only**, both free or nearly so, both the parts
   C5's originating question actually asked for, and neither needing a spec lane to exist. Full
   pipeline stays opt-in per repo, on evidence that ideas arrive there.
2. **Does the acceptance lane apply to non-code work?** *Measured, then owner — and not yet live.*
   This repo is code, so lane 04 has a `tests/acceptance/` to make immutable and the question does
   not bite. It bites the moment a repo without one is in scope: a 3D-printing or electrical ticket
   has nothing to freeze, and lane 04 is the load-bearing gate — so such a repo gets a different
   gate or it does not get the pipeline. Question 1 settles this on its way past, and question 1 is
   deferred, so this one is too.
3. **The sweep's kill rate has never been measured** (lane 01). *Measured.* Three model stages spend
   before a line exists, on an idea that may be killed. The stage-1 refusal bounds it and the whole
   chain is under a dollar — but the kill rate is the number that says whether the shaper is earning
   its stage.
4. **Write-on-surprise is uncalibrated** (lane 05). *Measured.* A bar set at "surprise" with no
   measured rate either floods `CONTEXT.md` or never fires, and only §6's backwards question will
   say which.
5. **Nothing counts gate bypass** (lane 06). *Measured.* Every venue below Actions is bypassable and
   nothing counts how often an agent routes around one. It is countable, therefore free, and the
   counter belongs in §6.
6. **Intake templates are per-repo copies** (lane 00). *Measured.* GitHub cannot centralise defaults
   for a private estate. At two repos that is a file; at twenty it is `/sync-skills`, which ADR-0027
   deletes for exactly this reason. Bounded by question 1 and by nothing else.
7. **Lane 08's merge warden is unspecified.** *Measured.* What a semantic-conflict finding looks
   like, and what the warden does *instead* of merging.

**Ruled, and no longer open.** The seam picker's placement (lane 03's Binds); the daily spend ceiling
(ADR-0024); the short path's availability to features (ADR-0007); write-on-surprise's home
(ADR-0008); where a machinery defect is filed (ADR-0009); what a decision sheet contains and when the
shaper refuses (ADR-0028 through ADR-0031, and §01 above).
