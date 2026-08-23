# The design

**Drafted:** 2026-08-23 · **Scored:** 2026-08-23 against `GOAL.md` §2 — the grid and its nine open
cells are [§12](#12--the-scorecard) · **Last landed:** 2026-08-23, moves 0–1b (lane 06's free
venues) · **Scope:** this repo only, ruled 2026-08-23 — see [§11 Q3](#11--open-questions) ·
**Status:** the target. What the machine is, drawn from [`GOAL.md`](GOAL.md) rather than from the
skills that exist today.

`GOAL.md` says what the system is *for*. `INDEX.md` says what has been *built*. This says what the
machine *is* — every edge from an idea to a closed ticket, what event fires it, what it refuses, and
where the owner is required. It is the map a proposal gets held against, and the reason
"we already have a skill for that" stops being an argument: the map was drawn before the skills were
consulted.

Based on the structure of [The Owner's Foundry](https://claude.ai/code/artifact/c6ca3d6b-49f0-48cc-bf83-5d026e323c6d)
(agent-skills [#125](https://github.com/collod873/agent-skills/issues/125)), which is the only
document in the estate that draws the whole pipeline as a state machine. The Foundry is a draft that
has never been scored against anything — it is one of the four issues
[#128](https://github.com/collod873/agent-skills/issues/128) flags as cross-referenced inside a
70-second window by one session, two of which were substantially wrong once a number got attached.
Everything below is the Foundry re-derived against C1–C7, with three sets of changes:

- **Every clock is gone.** See [ADR-0004](docs/adr/0004-a-clock-may-release-a-batch-but-may-never-originate-work.md).
  The Foundry runs six cadences; C3 and ADR-0029 forbid them. Each is re-attached to the event that
  makes it non-vacuous, which turns out to be a better trigger in every case.
- **Sized to one operator and one repo — this one**, not to a SaaS product with users. Anything with
  no repo to attach to is cut and named as cut. Other repos in the estate appear here only as
  *evidence*: a measured number, a mechanism worth stealing, a failure worth not repeating. None of
  them is a target of work on this page until this repo runs, and §11 Q3 is where that gets revisited.
- **Every lane carries the constraint it answers to**, and the blocker it retires.

---

## 0 · How to read this

Each lane names four things. A lane missing any of them is not a lane:

- **Fires on** — the event. There is no other way in.
- **Refuses** — what it turns away before spending model time.
- **Cost** — model stages per unit of work, and owner minutes. This is the only form in which C1's
  test (*what does this add to the smallest unit of real work?*) can be answered, so it is stated
  per lane rather than summarised anywhere.
- **Sees** — which evidence classes the lane can observe, numbered against the ten-class taxonomy in
  [`finding-what-goes-wrong.md`](https://github.com/collod873/agent-skills/blob/main/docs/research/finding-what-goes-wrong.md)
  §4. C5 is a coverage constraint, and coverage that is not enumerated is coverage that is assumed.
  A lane that produces work rather than findings says **—**, which is a real answer.

Status marks: **live** (built, running), **partial**, **absent**.

A row marked **⬤ owner** is a point where Collin is required. There are five, and reducing that
number is the whole project. Two are in the lanes (01, 02); three are outside them — the two taste
calls in §7 and the brief in §8 — and all five are marked where they occur.

The scoring rule: a proposed lane is held against C1–C7 in `GOAL.md` §2. A lane that fails a
constraint is not a smaller lane; it is a different goal, and it does not get built. **This document
is a proposal and does not exempt itself** — §12 runs every lane against all seven and shows its
work.

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
not faster, and watching is what consumes the decision budget — the actual scarce resource. It is
also the thing happening today: issues [#33](https://github.com/collod873/claude-workflow/issues/33)
and [#34](https://github.com/collod873/claude-workflow/issues/34) are era-6 `/drain` running on the
workstation against this repo, in direct violation of ADR-0002. That is a bootstrap, and §10 gives
it an expiry.

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

### 00 · Intake — *absent*

> **Fires on:** the owner filing an issue. Nothing else in the system is human-initiated.
>
> **Cost:** no model, no owner minutes — a form submit at a red light. · **Sees:** — (it records;
> finding is not its job)

**There is no capture agent.** The ingress is a GitHub issue form — `.github/ISSUE_TEMPLATE/` —
opened from the mobile app. One required field, *"What's the idea?"*, and the form applies the
`idea` label so the label is never something to remember. Two templates: **Idea**, and **Defect**
for the problem noticed while out and about, which files with `bug` and skips lane 01.

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

### 01 · Shape — *absent*

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
| Shaper | Opus | 1 stage | Restates the idea as work, then walks the decision tree — proposing N decisions each with a recommended answer and the alternatives it rejected. Reads the idea, the sweep's results, `CONTEXT.md`, `CODING_STANDARDS.md` and the ADRs and issues the sweep surfaced. **Never free-roams the codebase** |
| Refuter | Sonnet | 1 stage | Attacks the **recommendations**, not the idea. Reports only what survives; silent when it agrees |
| ⬤ **owner** | — | 2 min, batched | `approved`, `parked`, `killed`, or a comment requesting a change |

**The output is a decision sheet, not a critique.** This is what makes the accept a real click:
approving a bare one-liner asks the owner to originate an opinion, and §7 is the whole argument for
converting that into reacting to something concrete. The sheet carries the restatement, the prior
art, the decisions with recommendations, and a **mark on each load-bearing assumption** — the ones
where a different answer would change other decisions on the page. That mark does double duty: it
is also the first of the three ADR tests, *hard to reverse*.

**The scarce resource is the length of what the owner reads**, not the money — the whole chain is
under a dollar per idea. So the sheet is capped at a phone screen: restatement ≤ 1 paragraph,
≤ 5 decisions, ≤ 2 lines each, plus surviving refutations.

**Accepting the sheet is what files the ADRs** and any term the shaper had to coin —
[ADR-0005](docs/adr/0005-accepting-a-shaped-idea-is-what-files-its-adrs.md),
[ADR-0006](docs/adr/0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md). Lane 02 then
cites those rulings rather than restating them, which is what keeps a follow-up ticket from
re-deciding something already settled.

That accept is **W5 — agents draft, the owner signs** — as a mechanism rather than a maxim: the
signature is a label, and it is the same click that starts the work. It is also the first half of
**W4**, because the ruling lands in `docs/adr/` next to the code it will govern at the moment it is
made, not whenever somebody remembers to write it down.

**The shaper may refuse to shape.** More than ~3 load-bearing marks means it does not understand
the idea well enough, and the honest output is *"needs a live session"* — the same instinct as
§02's *a spec with zero open questions is suspect*, pointed the other way.

**A change request re-runs the shaper, capped at 2 rounds**, then it posts as-is and the owner rules
or kills. Uncapped is the fixer mistake in a new place.

**The refuter is on probation.** It is held to §6's backwards question at the event that would add
another agent to this lane: if it has never surfaced a survivor, it dies. A third agent asked
*"do these look good?"* answers yes almost always — that is the pc-build failure, an agent judging
its own kind. Asked to **kill** them, silence is the good outcome.

**C1 forces the sizing.** The Foundry runs three adversaries plus a synthesiser on every idea; four
Opus sessions against a one-line fix is exactly the era-4 death (~7 plan steps for ~3 edits).

**What this lane cannot do is get surprised.** It only ever surprises itself, so its failure mode is
a confident, coherent sheet resting on a wrong premise — which is precisely what the transcript lens
in §6 exists to catch. The assumption marks are the reviewable form of that, and they are the
lane's only defence.

### 01a · The short path

A defect carries a failure that already happened; a feature carries an opinion about what would be
better. The sheet ends with a **route recommendation**, and the owner's accept takes it or a
one-word override sends it long. That is C2's shape — machine judgement with a reviewable
checkpoint, never a human quiz. Commit `68b071f` deleted a sizing quiz for asking the owner
senior-dev questions; making him the sizer here would rebuild it.

**The short path may skip spec, slice and acceptance-authoring. It may never skip the gauntlet or
review** (lanes 06–07), and more than ~3 load-bearing assumption marks sends it long regardless — a
shaper that does not understand an idea well enough to shape it cannot route it either.

**It is available to features as well as defects** —
[ADR-0007](docs/adr/0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md). An earlier
draft reserved it for defects, reasoning that a small-looking feature is exactly where the ceremony
earns its keep. Nothing in the record supports that, and C1 says the opposite: no era was ever
replaced for producing bad output, and era 4 died spending ~7 plan steps on ~3 edits in 1 file.
The two errors are not symmetric, which is the whole argument. A wrong **short** route sends a
feature to the gauntlet without a spec — visible, because lanes 06–07 still run, and recoverable by
re-shaping. A wrong **long** route buys era 4's overhead and leaves no trace anywhere, because
nothing records the ceremony an item did not need.

### 02 · Spec — *absent on a runner* (`/to-spec` exists, local)

> **Fires on:** `approved`. **Refuses:** an idea whose adversary comments have not been answered.
>
> **Cost:** 2 Opus stages; **5–15 owner minutes**, batched — the most expensive owner touch in the
> system, and the one that pays for itself. · **Sees:** —

| Role | Model | Count | Does |
|---|---|---|---|
| Spec author | Opus | 1, cloud | Opens a PR adding a spec. Two non-negotiables: acceptance criteria **quote the owner's words**, and every place it had to invent intent becomes a numbered open question rather than a silent assumption |
| Spec critic | Opus | 1, on PR open | Hunts only for underspecification — sentences admitting two implementations, criteria that cannot be observed. It does **not** propose fixes; proposing lets it paper over the ambiguity it exists to surface |
| ⬤ **owner** | — | 5–15 min, batched | Answer the open questions. This is the one place where going slower makes you faster |

**A spec that ships with zero open questions is treated as suspect** — it guessed silently. This is
C2 done correctly: the machine asks about *intent*, which the owner is the only one who can answer,
and never asks a sizing or architecture question, which he cannot.

### 03 · Slice — **live**

> **Fires on:** the `prd` label. **Refuses:** a PRD that already has sub-issues; a PRD that is
> itself a sub-issue; a missing `CLAUDE_CODE_OAUTH_TOKEN`.
>
> **Cost:** 3 Opus stages per spec, no owner minutes. · **Sees:** —

| Role | Model | Count | Does |
|---|---|---|---|
| Seam sweep | Opus | 1 stage | Emits the seam manifest — the shared shapes the batch needs, one line each |
| Slicer | Opus | 1 stage | Draws the ticket graph against rules it can be graded on |
| Auditor + publisher | Opus + code | 1 stage | Grades a graph it did not author, then hands its own plan to the deterministic publisher — one sub-issue per slice, every `dependsOn` a native blocked-by edge, read back to verify |

The only lane fully built. `.Workflow/agent-workflows/to-tickets/`, fired by `.github/workflows/to-tickets.yml`.

**Open question:** the Foundry places the seam picker in lane 02, at spec time, so the interface
contract exists before slicing. Here it runs at slice time. Neither placement follows from a
constraint; the built one keeps its place until something argues otherwise. See §11.

### 04 · Acceptance — *absent*

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

### 05 · Build — *absent on a runner* (`/implement`, `/drain` exist, local — see §2)

> **Fires on:** `ready` **and** a free slot under the governor's cap. **Refuses:** dispatch when the
> owner's decision queue is full (§8).
>
> **Cost:** 1 Sonnet per slice, plus up to 3 fix attempts on red. · **Sees:** — while it runs;
> class 4 at the end of it, via write-on-surprise below

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

**W3 is already carried, upstream.** Physical disjointness is the slicer's job in lane 03, which is
live and does it today; that is what makes 3–6 concurrent implementers safe to run at all. Lane 08
is the merge-time complement for the conflict disjointness cannot prevent, not a replacement for it.

### 06 · Verify — **live below Actions**, refusing only at push

> **Fires on:** every edit, every turn end, every push, every PR — one venue each. **Refuses:** the
> edit, the turn, the push, the merge, respectively.
>
> **Cost:** no model at the first three venues, Actions minutes at the fourth. The cheapest lane on
> the page and the one that retires a measured regression. · **Sees:** class 1 (the tree at HEAD)
> and class 5 (the runtime)

**Retires blocker 5** — the only unambiguous regression in the six-month record: 12 broken commits
reached `main` in five days, all genuine breakage.

**The failure this lane was drawn against is an assignment, not an absence.** The estate's habit was
to put every mechanism that can refuse where it runs no checks, and every check where it can refuse
nothing — [`verification-boundaries-2026-08.md`](docs/research/verification-boundaries-2026-08.md)
measured it: **every mechanism that runs tests is advisory or after the fact, and every mechanical
mechanism runs no tests.** This repo started there too, with a `verify.yml` that ran everything
after the push had already landed on `main` and no hooks at all.
[ADR-0010](docs/adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md) inverts that
assignment, and the inversion costs no money.

The gauntlet, by venue. A check sits at the earliest one whose budget it fits:

| Venue | Budget | Carries | Status |
|---|---|---|---|
| **In the turn** — `PostToolUse` on Edit/Write | <1s | typecheck, and lint the touched file, fed back as tool output | **live**, ~0.7s |
| **Turn end** — `Stop` | <10s | typecheck, lint, unit suite | **live**, ~2.0s |
| **On push** — husky, self-installing via `"prepare"` | <60s | typecheck, lint, unit suite, boundary rules | **live**, ~2.1s, the first venue that refuses |
| **In Actions** — on the PR | <10min | integration, seeded database, anything needing a runner; acceptance tests (lane 04); contract tests against the seam manifest | `verify.yml` live but advisory; branch protection absent and paid |
| **Overnight** | unbounded | broad sweeps, visual regression, flake quarantine re-runs | absent, and dormant until a repo has a UI |

All four live venues call one runner, `bin/gauntlet`, which takes the venue as its argument. A check
defined twice drifts; the venue chooses only the scope and the failure mode.

**Every check fits every venue here, and that is a fact about this repo's size rather than a
principle.** The suite is ~1.7s and typecheck ~0.7s, so the earliest-venue rule puts all three at
`PostToolUse` — except the suite, which is held at turn end because the in-turn venue fires on every
edit rather than every turn. When a check stops fitting a budget it moves down a venue and the venue
reports why: `bin/gauntlet` times itself against the budgets in this table and says so when it is
over, which is the only thing that will ever tell us to split them.

The self-installing trick is stolen verbatim from `course-video-manager`: `"prepare": "husky"` in
`package.json` plus a frozen-lockfile install in every workflow means the hook installs itself on the
runner and in any fresh clone, so an agent's commits pass the same gate the owner's do. Fail-closed
enforcement with no Actions job behind it.

**The three below Actions fail open; the push venue fails closed.** A hook that cannot run its
checks — no node on PATH, no `node_modules` — stays silent and lets the turn through, because a
convenience venue that wedges every turn in the repo is worse than the defect it was hunting. The
push venue refuses instead, because there is a human standing there who can fix it and the next
thing downstream is `main`.

**Why earliest wins is the cost of the repair, not the cost of the check.** A type error caught
in-turn is fixed by the implementer that caused it, same turn, context still hot — free. The same
error caught in Actions costs a cold fixer run reconstructing what the implementer already knew. By
a reviewer: a review, a fixer and a re-review. By the owner: the premise. Each venue is a filter, so
the expensive venues stop seeing failures, which is where the throughput comes from.

**Every defect that escapes to the owner adds a gate — at the lowest venue that could have caught
it.** The gauntlet grows for the life of the project or it decays relative to the codebase. That
growth is *not* grooming under C4 — a gate is added at the moment a defect proves it missing, by the
event that proved it, never on a review cycle. Adding every escape to Actions by default is how the
gauntlet becomes the bottleneck it exists to prevent.

**The flake precondition. No venue is promoted to refusing above a flaky check** — crewops ADR-0003:
*a flaky gate trains `--no-verify` and is worse than a slow one.* This repo's suite was green and
~1.7s when the venues landed, so the precondition was satisfied rather than worked for.

The reference case for what it is guarding against, and the shape to watch for here: elsewhere in
the estate, ~14 of 26 CI failures over 30 days were one file, always the same two cases, failing on
whether `jq` was on the runner's PATH. Half the red was environment flake in the meta-layer. That is
why `bin/node-on-path.sh` exists and why the gauntlet's "could not run" is a third exit code rather
than a failure: an environment problem reported as a finding is the whole mechanism by which a repo
learns to ignore its gates.

### 07 · Review — *absent*

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
missed here.

**Not an agent's job.** Scale, cost-to-run and architectural fragility fail silently and late, and
neither the owner nor an agent can verify an agent's judgement on them. That is a contract
engineer for a half day, twice a year. A line item, not a gap to engineer around.

### 08 · Integrate — *absent*

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

This is the merge-time complement to W3, which era 5 (ADR-0017, registry codegen) and era 6
(ADR-0007, file claims) both implement at authoring time. Authoring-time disjointness prevents
textual conflict; nothing in either era prevents semantic conflict.

### 09 · Close — *absent on a runner* (`close-gate.py` exists, local PreToolUse)

> **Fires on:** `issues.closed`. **Refuses:** the close — reopens the issue and comments why.
>
> **Cost:** no model where the closing record parses; 1 Haiku where it does not. · **Sees:** class 6
> (the tracker — promised vs delivered)

**Retires blocker 1, structurally.** Era 6's gate is a PreToolUse hook, so a commit-keyword close
(`Closes #704`) never reaches it and a crashing rail fails open unseen. Moving the gate to the
tracker closes that by construction: `issues.closed` fires no matter *how* the issue was closed, and
an Action that errors is a red run, not a silent pass. A gate that cannot be routed around is the
precondition for stepping back at all.

This is **W1** — *a gate that errors at the moment of the action* — moved to the one venue the
agents it judges cannot reach. Era 2's `checklist-reminder.py` is the same idea and is still running
five systems later; what changes here is only the venue, which is the entire difference between a
gate and a suggestion.

---

## 5 · The trigger map

Nothing runs on a clock. Every row is an event. *(C3, and
[ADR-0004](docs/adr/0004-a-clock-may-release-a-batch-but-may-never-originate-work.md).)*

| Event | Fires |
|---|---|
| Owner files an issue from the template | The `idea` label goes on → the sweep fires within the minute |
| Sweep finds no prior art | Shaper, then refuter. A duplicate or an existing ruling stops the chain instead |
| Owner comments a change request on a sheet | Shaper re-runs, at most twice |
| Label `approved` | The sheet's ADRs and terms are filed; then spec author, critic |
| Spec PR merged | The `prd` label goes on → **lane 03, live today** |
| Sub-issues published | Acceptance author, one per slice — and the parity counter, beside the siblings |
| A merged edit to a spec that already has acceptance tests | Acceptance author re-fires, affected slices only |
| Acceptance tests merged | Slice gets `ready`; waits for a free slot |
| A slot opens (a ticket closed, or the queue drained) | Implementer dispatched into an isolated checkout |
| CI red | Fixer, 3 attempts, then `blocked` and silence |
| CI green | Review fleet fans out; every finding gets 3 refuters |
| PR approved | Enters the single merge queue |
| Merged to trunk | Drift lens on the touched modules; coupling counter incremented |
| Issue closed | The close gate runs — and cannot be bypassed |
| An ADR or decision comment is recorded | Consistency lens reads it against the whole log |
| A session ends | Transcript captured, then read (blocker 4); corrections counted |
| A commit is reverted, or added and deleted the same day | Correction counter — a failure already labelled by whoever reverted it |
| A finding is recorded, in any repo | Cross-repo slug match |
| A run hits a defect in the machinery | Filed as a `bug` in **this** repo, whichever repo the run was in (ADR-0009) |
| Nth landing in a module since its last read | Coupling lens |
| Owner comments on a queued decision | The lane waiting on that answer resumes, within the minute |
| **The brief window opens, and the queue is non-empty** | The brief publishes and pushes once. Empty queue → silence |

That last row is the only time-shaped thing in the system, and it originates nothing — see §8 and
ADR-0004.

## 6 · The standing lenses and counters

Eight things get read while nobody is watching, and **only one of them is code.** Five spend a
model; three only count. Each is attached to the event that makes it non-vacuous, which is what
distinguishes a lens from the cadence ADR-0029 rejected.

**Sees** numbers the evidence class each one can observe, against
[`finding-what-goes-wrong.md`](https://github.com/collod873/agent-skills/blob/main/docs/research/finding-what-goes-wrong.md)
§4. C5 is a coverage constraint; the ledger below is how it gets scored rather than asserted.

| Lens | Model | Fires on | Reads for | Sees |
|---|---|---|---|---|
| **Diff** | Opus | CI green | Defects and spec conformance — lane 07. Catches almost nothing else | 2 |
| **Transcript** | Opus | Session end, batched | The moment an agent **guessed at intent and moved on** — hedge language before a consequential choice, a requirement restated in weaker terms, an assumption stated once and never revisited. Correct-looking code with a wrong premise leaves fingerprints in the transcript that are invisible in the diff | 4 |
| **Decision log** | Opus | An ADR or ruling recorded | Contradiction: *"you ruled in March that X, this week you ruled Y — one of these is stale."* It never pre-answers on the owner's behalf | 8 |
| **Spec** | Haiku | A merge touching a module | Drift. A lying spec is worse than no spec, because every agent downstream believes it forever | 8 |
| **Coupling** | Opus, high effort | N landings in a module since its last read | Duplicated concepts, three implementations of one idea, a module that has quietly grown a second responsibility. Output is a small number of ranked refactor issues | 3 |

### The coverage ledger

| # | Evidence lives in | What looks at it here |
|---|---|---|
| 1 | The tree at HEAD | Lane 06 — typecheck, lint, test |
| 2 | A single diff | Lane 07, and the diff lens |
| 3 | Recurrence across diffs | The coupling lens |
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

None of the three spends a model, and all three can run on every push without ADR-0029's problem:
counting produces no commits, so it cannot feed on its own output. A count is also recomputed rather
than stored, so nothing a counter says can go stale — which is the defect that made 43% of Lumaria's
four weeks of inbox findings dead on arrival.

**The cross-repo counter is the mechanism C5's originating question asked for** — *"this repo owns
the skills so when it makes changes like that which should effect our other repos how do we catch
that without fail?"* It is also the only thing on this page whose value grows with the **estate**
rather than with the pipeline, which is what turns §11's scope question from a blocker into a
sequencing question: it is worth building at two repos and worth more at twenty.

It is also the carrier for a machinery defect found outside this repo. ADR-0009 rules that such a
defect is filed here, and a run dispatched into another repo has no write path back — so until one
exists, the run records the defect in its own output and the counter walks it home. That makes the
counter load-bearing rather than merely cheap, and it is the reason move 8a's cross-repo half should
not wait on the rest of that row. It has nothing to count until a second repo is in scope, which is
question 3, so it is built and left idle rather than built late.

The transcript lens is probably the highest-yield item on this page and it is **blocked on blocker
4**: capture died 2026-05-21, and `cleanupPeriodDays: 30` means every day without a recorder
permanently destroys a day of corpus. It matters *more* under autonomy — when nobody is watching,
the transcript is the only record of what went wrong.

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

Three hard limits, all enforced at dispatch, all deterministic code rather than an agent:

| Limit | Rule |
|---|---|
| **Queue depth** | More than ~7 decisions waiting → dispatch stops entirely |
| **WIP** | Hard slot count per lane, enforced at dispatch, not guidance |
| **Spend** | Checked *at dispatch* against the day's budget. Over budget pauses the commodity lane first, then everything but the lenses |

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

Its window is time-shaped and its contents are not: **the brief is a release valve on a queue that
events filled, and an empty queue produces nothing and pushes nothing.** That is the whole content
of ADR-0004, and it is what keeps the ship-a-lot-then-vanish-for-a-week case free.

---

## 9 · What this cuts

The point of drawing the map first. Every era-6 verb, held against the lanes above:

| Verb | Lands on | Verdict |
|---|---|---|
| `/to-tickets` | Lane 03 | **Ported.** Live, on a runner |
| `/to-spec` | Lane 02 | **Port.** Currently local-only, which makes it a keystroke gate on every unit of work |
| `/implement` | Lane 05 | **Port**, narrowed. Its brief becomes ticket + seam manifest + failing tests, not the repo |
| `/grilling` | Local session, §2 | **Keep, unported.** Grilling needs the owner's answers by construction — an unattended grilling agent grills itself. Lane 01 replicates the part that *is* automatable (walk the tree, recommend on each) and escalates here when it can't |
| `/triage` | Lane 00/01 boundary | **Absorbed.** Capture files, adversaries shape. A separate triage verb is a third name for the same edge |
| `/drain` | — | **Delete.** A batch worker with worktrees, a foreman and a merge loop *on the workstation* is ADR-0002's exact prohibition. Lanes 05 and 08 are what it was for: the governor dispatches, the warden serialises. Its three open defects ([#33](https://github.com/collod873/claude-workflow/issues/33)–[#35](https://github.com/collod873/claude-workflow/issues/35)) are defects in a thing that does not survive the map |
| `/standards-pass` → `/ratify` → `/standards` | §6, the lens audit | **Absorbed.** ADR-0003 already ruled that a rule is audited at the event that adds another rule. Generalise it and the three-verb chain is one lens |
| `/converge` | — | **Delete.** Bringing a machine back to the GitHub backups is only necessary because state lives on a machine. §1 forbids that |
| `/sync-skills` | — | **Delete.** Vendoring an upstream skill tree and re-applying deltas is a grooming obligation with ~60 rows of divergence to maintain. C4 |
| `/wayfinder` | Local session, §2 | **Keep, unported.** Destination and scope are named in `GOAL.md` as where the human deliberately stays. It should stay a local, human-fired verb — it is not an edge |
| `/ask-matt` | — | **Delete.** An entry point that recommends which flow fits exists because there are eleven flows. There are nine lanes and the label picks |

**Five of eleven verbs do not survive.** Not one of them is bad; each answers a question this map
answers differently or does not have. That is the test working — and it is only available because
the map was drawn before the inventory was read.

## 10 · Build order

Ordered by what unblocks what. That is **not** `GOAL.md` §4's order, and an earlier draft claimed it
was: blocker 5 sat at move 1 while blocker 1 waited. Blocker 5 is now retired in two halves at
opposite ends of the list — the free venues first, the refusal at trunk last — for the reason in
[ADR-0011](docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md): **feedback, then
repair, then refusal.** A gate with nothing behind it parks work rather than stopping it, and parked
work drains onto the owner.

| # | Move | Retires | Cost |
|---|---|---|---|
| 0 | ✅ **Quarantine the flake** — the precondition for every gate below | — | **Nothing to do.** The suite here is green and ~1.7s; the precondition was met, not worked for. It becomes a real move the first time a check goes red for an environment reason |
| 1a | ✅ **The free venues** (lane 06) — typecheck and lint in the turn, the whole gauntlet at turn end, the same on push, self-installing via `"prepare": "husky"` | Most of blocker 5, and it is where the throughput is | Landed. `bin/gauntlet` plus two hooks and a `pre-push`. No model spend, no plan change |
| 1b | ✅ **Narrow `verify.yml`'s triggers** to what the free venues no longer cover | Actions minutes — the estate is at 2,022/month against a 2,000 cap | Landed. `push` on `main` only, `paths-ignore` for Markdown, and it calls `bin/gauntlet push` so a check cannot drift between venues |
| 2 | **Close gate as an Action** on `issues.closed` (lane 09) | Blocker 1 | Days. The logic exists; the venue changes |
| 3 | **Session capture**, at session time, stored durably | Blocker 4 | Days — and every day it waits destroys a day of corpus permanently |
| 4a | **Intake** (lane 00) — two issue forms and the `idea` label | The desk keystroke | An afternoon |
| 4b | **Shape** (lane 01) — sweep, shaper, refuter, and the sheet | The blank-screen approve | Days |
| 5 | **Acceptance lane** (04) + the immutability rule in CI | The premise itself | Weeks. The unglamorous one, and skipping it is the reliable way to fail |
| 6 | **Spec on a runner** (lane 02) | Blocker 2 | Weeks |
| 7 | **Build + integrate** (lanes 05, 08) — implementer, fixer, warden | Blocker 2 | Weeks |
| 8a | **The three free counters** (§6) — parity, correction, cross-repo | C5's rows 7, 9, 10 — the classes nothing was watching | Days each, no model spend. Parity and cross-repo can land beside anything above them; the correction counter waits on move 3 |
| 8b | **Model lenses + the backwards question** (§6), asked of the lint rules and ADRs too | Blocker 3 | Ongoing, event-attached |
| 9 | **Governor + brief** (§8) | C7 | Last. It has nothing to govern until 5–7 land |
| 10 | **Branch protection + required checks** on this repo | The rest of blocker 5 — the agent that routes around the free venues | An afternoon of configuration and **$4/month.** Protected branches do not exist on a private repo under the Free plan; the API answers `403 Upgrade to GitHub Pro`. Waits on move 7's fixer, which is the thing that clears a red without the owner |

**Move 10 has two dependencies the earlier draft did not name.** It costs money — this repo is
private on a Free account, so it is a purchase, not a setting. And it has never opened a pull
request: work lands by local merge and a direct push to `main`, which protection forbids. Whatever
drives lane 05 by then has to open a PR and let it auto-merge on green. That is lane 05's shape
anyway, which is why the move waits for it rather than forcing an interim.

**The bootstrap has an expiry.** Until move 7 lands, work on this repo is driven by era-6 `/drain`
from the workstation, which ADR-0002 forbids. That is a scaffold, and it expires the moment lane 05
runs on a runner. Until then: **this repo does not grow files to serve era-6 skills.**
[#34](https://github.com/collod873/claude-workflow/issues/34)'s second fix — adding
`.claude/contract.json` and `docs/agents/issue-tracker.md` here so `/drain` can read them — is
declined on that basis.

**Honest accounting.** Moves 2–4 are weeks where the owner is *more* in the loop, not less, and it
will not feel like leverage. Moves 0–1 were the exception and the reason they went first: they cost
an afternoon, spend nothing, and every hour after them is an hour of agent work that corrects itself
instead of arriving on his desk. The out-of-the-loop dividend beyond that comes entirely from the
boring eighty percent; the parts he cares most about stay his forever. And the ceiling: this system is bounded by
spec quality, not by agent capability — true today, still true when the models are twice as good,
which is the best argument for spending the hour at the top of the pipeline rather than the bottom.

## 11 · Open questions

Each needs a decision before the lane it blocks can be built. They are **not all the same kind**,
and C2 says the difference is the whole point. An ⬤ **owner** question is about destination, scope
or spend — his to answer, and nobody else's. A **measured** question has a right answer that no one
currently holds the number for, and handing it to him as a choice is the sizing quiz commit
`68b071f` deleted, rebuilt in a document that claims to forbid it.

1. **Where does the seam picker live** — lane 02, so the interface contract exists before slicing
   (the Foundry), or lane 03 where it is built today? *Measured, not owner.* No constraint decides
   it and it is not a destination call. The built placement keeps its place until a slice fails in a
   way that names the answer.
2. ⬤ **What is the daily spend ceiling** (§8)? *Owner.* A plan-tier question before it is an
   engineering one, and the governor cannot be built without a real number. ~$1,661 API-equivalent
   over 28 days is the only figure on record.
3. ⬤ **How far does the pipeline spread, and in what order?** *Owner — deferred, not open.* Ruled
   2026-08-23: **this repo and nothing else** until the machine runs here. A second repo is not a
   scope decision waiting on an argument, it is a distraction from a pipeline that has three of nine
   lanes built, and every hour spent porting a venue to another codebase is an hour the lanes above
   do not get. So this page tracks one repo, and other repos appear on it only as evidence.
   The question re-opens on its own terms once lane 05 runs on a runner — that is the first moment
   there is anything worth spreading. The standing recommendation for that day is unchanged and
   cheap: **the gauntlet and the cross-repo counter only**, both free or nearly so, both the parts
   C5's originating question actually asked for, and neither needing a spec lane to exist. Full
   pipeline stays opt-in per repo, on evidence that ideas arrive there.
4. **Does the acceptance lane apply to non-code work?** *Measured, then owner — and not yet live.*
   This repo is code, so lane 04 has a `tests/acceptance/` to make immutable and the question does
   not bite. It bites the moment a repo without one is in scope: a 3D-printing or electrical ticket
   has nothing to freeze, and lane 04 is the load-bearing gate — so such a repo gets a different
   gate or it does not get the pipeline. Question 3 settles this on its way past, and question 3 is
   now deferred, so this one is too.
5. **Does an unread document get deleted automatically?** *Measured.* The generalisation of
   [ADR-0003](docs/adr/0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md) to
   prose: ask a finding whether it was ever loaded into a context where it changed an outcome, at
   the event that would add another of its kind, and delete it if never. This is the only version of
   pruning that survives C4. It used to hang on an unruled question about where agent-authored
   observations live; it no longer does. The safety condition — that pruning can never reach
   something the owner wrote — is ADR-0006's signing line.

**Ruled while this page was being scored.** Three things that sat here as open questions are now
records, and the lanes above reflect them rather than proposing them:

- [ADR-0007](docs/adr/0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md) — the
  shaper routes every item, so the short path is not defects-only. §01a.
- [ADR-0008](docs/adr/0008-a-run-ends-by-writing-what-surprised-it-into-the-module-s-co.md) — a run
  ends by writing what surprised it into the module's `CONTEXT.md`, or writing nothing. §05, and it
  is what gives W6 a home in the machine instead of a line in this list.
- [ADR-0009](docs/adr/0009-the-machine-may-file-defects-against-itself-but-never-featur.md) — the
  machine may file defects against itself but never features, and a machinery defect is filed **in
  this repo whichever repo the run was working in**. There is no tenth lane; agent-skills
  [#134](https://github.com/collod873/agent-skills/issues/134) is answered. §00 and §6.

---

## 12 · The scorecard

`GOAL.md` §2 says each constraint is testable — *a design either satisfies it or it doesn't* — and
§0 says a proposed lane gets held against all seven. This document is a proposal. Asserting
compliance in prose while never running the grid is how the map ends up with the same blind spot as
the thing it replaced.

**✓** satisfies · **⚠** open, named below · **—** the constraint does not bear on this lane

| | C1 speed | C2 answerable | C3 event | C4 grooming | C5 coverage | C6 sessions | C7 batched |
|---|---|---|---|---|---|---|---|
| **00** Intake | ✓ | ✓ | ✓ | ⚠ | — | — | ✓ |
| **01** Shape | ⚠ | ✓ | ✓ | — | — | — | ✓ |
| **01a** Route | ✓ | ✓ | ✓ | — | — | — | ✓ |
| **02** Spec | ⚠ | ✓ | ✓ | — | — | — | ✓ |
| **03** Slice | ✓ | — | ✓ | — | — | — | — |
| **04** Acceptance | ✓ | — | ✓ | ✓ | ✓ | — | — |
| **05** Build | ✓ | — | ✓ | — | ⚠ | — | ✓ |
| **06** Verify | ✓ | — | ✓ | ✓ | ⚠ | — | — |
| **07** Review | ⚠ | — | ✓ | — | ✓ | — | ✓ |
| **08** Integrate | ✓ | — | ✓ | — | ✓ | — | — |
| **09** Close | ✓ | — | ✓ | ✓ | ✓ | — | — |
| **§6** Lenses + counters | ✓ | — | ✓ | ✓ | ⚠ | — | ✓ |
| **§7** Taste | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| **§8** Governor + brief | ✓ | ✓ | ✓ | ✓ | — | — | ⚠ |
| **§1–2** Substrate | ✓ | — | ✓ | ✓ | — | ✓ | ✓ |

### C1's arithmetic

The per-lane costs exist so this can be computed rather than argued. For **one line of change**:

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

### The nine ⚠ cells

Named so that "scored against C1–C7" has a residue rather than a verdict:

1. **00 / C4** — intake templates are per-repo copies, and GitHub cannot centralise defaults for a
   private estate. At two repos that is a file; at twenty it is `/sync-skills`, which §9 deletes for
   exactly this. Bounded by question 3 and by nothing else.
2. **01 / C1** — three model stages spend before a line exists, on an idea that may be killed. The
   stage-1 refusal bounds it and the whole chain is under a dollar, but **the sweep's kill rate has
   never been measured**, and that number is what says whether the shaper is earning its stage.
3. **02 / C1** — 5–15 owner minutes is the largest single owner cost in the system. It is on the
   long path only, which is now the whole load-bearing job of ADR-0007's routing.
4. **05 / C5** — write-on-surprise is real class-4 coverage but is **uncalibrated**. A bar set at
   "surprise" with no measured rate either floods `CONTEXT.md` or never fires, and only §6's
   backwards question will say which.
5. **07 / C1** — the most expensive lane per unit, and **three refuters is a guess.** There is no
   measured false-alarm rate to size it against; C7 is the argument for having refuters at all, not
   for having three.
6. **§6 / C5** — classes 7, 9 and 10 now have mechanisms **on paper**. Nothing is built, nothing is
   measured, and class 8 is covered by two halves that arrive in different moves.
7. **§8 / C7** — the ~7 queue cap and the 5-day expiry are inherited from the Foundry draft and have
   **never been measured against this owner's actual answer rate**, which is the only number that
   makes either of them right.
8. **§11 Q2 / C7** — the spend ceiling is unruled, and the governor cannot be built without it.
9. **06 / C5** — every venue below Actions is bypassable. `--no-verify` skips the push and commit
   hooks; a `PostToolUse` hook is fed back as tool output, and an agent may read it and proceed
   anyway. Until move 10 there is **no venue an agent cannot route around**, and nothing counts how
   often one does. ADR-0011 names this as the cost of putting refusal last; §6 has no counter for it
   yet, and one belongs there.

Six of the nine are the same shape: **a number nobody has measured yet.** That is the honest state
of a design drawn before the machine exists, and it is what §6's backwards question is for — every
one of them is a question asked at an event, not on a review cycle.
