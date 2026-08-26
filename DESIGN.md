# The design

**The target.** What the machine *is* — every edge from an idea to a closed ticket, what event fires
it, what it refuses, and where the owner is required. [`GOAL.md`](GOAL.md) says what the system is
*for*.

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

The scoring rule is `GOAL.md` §2's, and a lane is what it scores here: a lane that fails a constraint
is not a smaller lane, it is a different goal, and it does not get built. Scoring is also an ⬤ owner
point — whether a mechanism exists at all is the owner's call
([ADR-0047](docs/adr/0047-the-shape-of-the-machine-is-an-owner-point-agents-do-not-jud.md)) — but it
is not one of the five below, which count where the owner is required per work item. **This document
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
| **Sonnet 5** | Implementation of specified work, refutation, fixers | Bounded by a spec and a test suite — the ceiling is the spec, not the model |
| **Opus 5** | Spec authoring, seam selection, slicing, audit, adversarial review, the standing lenses | Being subtly wrong is expensive and invisible. Low volume, high consequence |

Reasoning effort moves on the same axis: mechanical stages low, refuters and the coupling lens high.

---

## 4 · The lanes

Nine lanes. A work item passes through them in order. **⬤ owner** marks a point where Collin is
required — **two of the five are here**, in lanes 01 and 02. The other three are the two taste calls
in §7 and the brief in §8, marked there.

### 00 · Intake

> **Fires on:** an issue filed through `.github/ISSUE_TEMPLATE/`, which applies `idea` or `bug` at
> creation. Nothing else in the system is human-initiated.
>
> **Refuses:** nothing, ever. A capture that refuses loses ideas, which is the one thing this lane
> exists to prevent, and the blank issue stays enabled for the same reason. It also never
> *dispatches* — a filed idea is a captured observation, not approved work.
>
> **Cost:** no model, no owner minutes — one field at a red light.
>
> **Sees:** — (it records; finding is not its job)
>
> **Binds:**
> — **The owner's words are stored verbatim and nothing edits them.** That is what makes it safe for
> lane 01 to restate them: the original is always there to check the interpretation against. Held by
> a test that fails on any issue-body writer entering the repo, in whichever language it arrives.
> — **One required field, and lane 01 inherits everything this door does not ask.** Urgency, scope
> and what it touches arrive undecided by construction. A field added here is a question asked at
> the worst possible moment, and a door the owner routes around captures nothing.
> — **Ingress is a GitHub object from the first moment**, so §1's substrate rule costs this lane
> nothing.
> — **A session may file an idea only when the owner explicitly says so, and that capability is
> written down nowhere else.** No agent may be primed to volunteer ideas of its own — F2 is the
> system becoming its own biggest customer, and an invitation in `CLAUDE.md` is read at the start of
> every session.
> — **A defect in the machinery is the one exception**, filable by any run unasked and **always into
> this repo whichever repo the run was working in**
> ([ADR-0009](docs/adr/0009-the-machine-may-file-defects-against-itself-but-never-featur.md)).
> Defects only, never features: a lane that misfires while working on a product is not that
> product's bug, and filing it beside that product's bugs buries it where nobody who can fix it is
> looking.
> — **The templates are per-repo copies and cannot be centralised.** GitHub serves default community
> health files only from a *public* `.github` repository, which a private estate does not have. At
> two repos that is a copied file; where it stops being one is §11's question 6.
>
> **Lives in:** `.github/ISSUE_TEMPLATE/`, the `idea` and `bug` labels, and
> `.Workflow/agent-workflows/intake/intake.test.ts`. ADR-0009.

**Two doors are not built.** The form above is the micro door. The other two enter at lane 02 and
wait on it — they are distinguished by how much context the owner has already built:

| Door | When | What enters the system | Next lane |
|---|---|---|---|
| **Tactical** — local `/grill-with-docs` session | At the desk, single-session alignment | The session ends aligned and publishes a GitHub issue with the grilled decisions. The owner invokes `/to-spec` directly while context is hot — **no handoff to a runner**, because the session already holds the nuance and serialising it to an issue loses signal | 02 (Spec, in-session) |
| **Macro** — `/wayfinder` map | Multi-session domain exploration | A closed Wayfinder Map issue (e.g. [Lumaria #751](https://github.com/collod873/Lumaria/issues/751)) carrying ADR rulings, filed sub-issues, and scoped boundaries. Closing the map or applying a `to-spec` label triggers the cloud spec author | 02 (Spec, headless) |

**All three doors produce the same downstream object**: a GitHub issue carrying enough decided
context for the lane above it to work from without interviewing the owner.

### 01 · Shape

> **Fires on:** the `idea` label, and a non-bot comment on an issue still carrying it — the fourth
> owner verb, a change request, capped at 2 re-runs after which the sheet stands as posted.
>
> **Refuses:** at stage 1, an idea that already exists or that an ADR has already ruled on — the
> chain stops there and never spends the shaper. The sweep translates what it found into a verdict
> grammar and a *deterministic* gate decides, so a verdict citing the wrong kind of thing refuses
> nothing ([ADR-0014](docs/adr/0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md)).
> It refuses again at stage 2, with *"needs a live session"*, when the decision tree will not close
> under five decisions — the sheet's own cap, not a new number
> ([ADR-0029](docs/adr/0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md)).
>
> **Cost:** 3 model stages — Haiku sweep, Opus shaper, Sonnet refuter — under a dollar per idea,
> plus one Haiku re-sweep on the round the shaper spends one. ⬤ **owner** — **2 owner minutes**,
> batched, and the same click starts the work.
>
> **Sees:** — (prior art is not an evidence class; its input is an opinion, not an artifact. This
> lane cannot get surprised, which is why the transcript lens exists)
>
> **Binds:**
> — **The sheet is five sections with caps, and anything that does not fit is cut, never appended.**
> Restatement ≤ 1 paragraph; prior art ≤ 3 lines, each a link plus why it bears on this idea, with
> `none found` a legal line; decisions ≤ 5; surviving refutations ≤ 3 and **absent** when the
> refuter is silent, never `none`; route 1 line. The scarce resource is the length of what the owner
> reads, not the money. The one cap that refuses rather than cuts is the decision count, because
> truncating hides the signal the cap exists to raise.
> — **Every decision may carry a mark, and the mark names the thing that moves** — another decision
> on the sheet, or an ADR, a shipped lane's contract, a file. A mark that names nothing is stripped
> mechanically ([ADR-0028](docs/adr/0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)),
> so the test needs no judgement at check time. The mark is also the first of the three ADR tests,
> which is what decides which rulings get filed at accept.
> — **Accepting is what files the ADRs and coins the terms**
> ([ADR-0005](docs/adr/0005-accepting-a-shaped-idea-is-what-files-its-adrs.md),
> [ADR-0006](docs/adr/0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md)), and they
> land on `main` at that moment
> ([ADR-0051](docs/adr/0051-the-accept-commits-its-rulings-straight-to-main-because-a-pu.md)). **Lane
> 02 cites those rulings rather than restating them**, which is what keeps a follow-up ticket from
> re-deciding something already settled — and it is why a ruling has to exist before the spec does.
> — **All four owner verbs are labels**, never comment prose: `approved`, `parked`, `killed`, and
> `go-long` / `go-short` alongside the accept. A label is something a gate can fire on. `parked`
> drops `idea` and **nothing ever re-raises it**; `killed` closes the issue `not planned`, becoming
> prior art the stage-1 refusal reads.
> — **A re-run posts a new comment; editing in place is forbidden.** ADR-0006 stakes a prediction on
> this lane — if the override rate on sheets resembles the 73-of-81 rate from mid-work questions,
> *the sheet is at fault* — and that number is only computable if the earlier rounds survive to be
> compared against what the owner actually did.
> — **The shaper runs with no search tools at all**
> ([ADR-0030](docs/adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md)), which is
> enforced by its toolbelt rather than by its prompt, so the sweep's reading list is fetched and
> injected in full. It may emit **one** re-sweep request, and if that comes back empty it marks the
> affected decision and writes the sheet anyway.
> — **The sweep reads this repo only**
> ([ADR-0050](docs/adr/0050-the-sweep-reads-this-repo-only-the-cross-repo-title-sweep-wa.md)). A
> cross-repo title sweep needs a credential the estate has not decided the shape of, and a search
> that silently returns nothing would put a false `none found` on the one section that can pre-empt
> the whole sheet.
> — **A refusal is cleared by a comment**
> ([ADR-0052](docs/adr/0052-a-comment-clears-a-stage-1-refusal-because-the-change-reques.md)), from
> the same budget as a change request. That is the clearing path
> [ADR-0011](docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md) requires before
> anything is promoted to refusing. **The share of refusals cleared this way is what says whether the
> sweep is refusing correctly** — a bare kill rate cannot, since it reads the same on a sweep that
> refuses everything. It is a sizing measurement living in ADR-0052, not a counter and not a §11 entry
> ([ADR-0066](docs/adr/0066-a-number-lives-in-an-adr-or-in-a-counter-row-never-in-the-op.md)).
> — **Only a broken run is red.** A refusal, a refuse-to-shape and a spent change-request budget all
> comment on the issue and exit 0. Kills are this lane's expected traffic, and a red run for the
> expected case is how red stops meaning anything.
> — **The refuter is on probation, and the probation is a count.** At the 20th sheet posted with zero
> surviving refutations the counter files an issue proposing its deletion, and never deletes the
> stage itself ([ADR-0031](docs/adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md)).
> This is §6's backwards question discharged for this lane.
>
> **Lives in:** `.Workflow/agent-workflows/shape/`, fired by `.github/workflows/shape.yml` and
> `.github/workflows/shape-accept.yml`. ADR-0005, ADR-0006, ADR-0007, ADR-0028 through ADR-0031,
> ADR-0050 through ADR-0052.

### 01a · The short path

> **Fires on:** the route the sheet recommends, taken at the accept — or the owner's one-word
> override, `go-long` / `go-short`, applied alongside `approved`
> ([ADR-0007](docs/adr/0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md)). The
> shaper routes **every** item, features as well as defects; making the owner the sizer would
> rebuild the quiz commit `68b071f` deleted.
>
> **Refuses:** a short route on a sheet where **more than half the decisions carry a mark** — a
> shaper guessing at that much of an idea cannot route it either. The threshold is a fraction rather
> than a flat count because a flat 3 waves through a two-decision sheet with both marked (ADR-0029,
> amending ADR-0007's original ~3). The override goes one way only: marks promote a route to long,
> and nothing ever demotes one to short.
>
> **Cost:** none of its own. It selects between §0's two paths — 7 model stages and one owner touch,
> or 13+ and two. · **Sees:** —
>
> **Binds:**
> — **The short path may skip spec, slice and acceptance-authoring. It may never skip the gauntlet or
> review** (lanes 06–07). Those are the lanes that catch regressions, not the lanes that prevent
> scope creep, and being unguarded is the one thing this path is never allowed to be.
> — **Below it is a direct path that skips lanes 01 through 04 entirely** — a defect or UI tweak the
> owner can hold in one session, 1–3 files, no concurrency, no multi-module coordination. He edits,
> and the gauntlet and review still run on the PR. It never passes through this lane at all, which
> is why it is bound here rather than triggered here.
> — **The two misroutes are not symmetric, and this is the only thing holding the line on the
> expensive one.** A wrong short route is visible, because lanes 06–07 still run, and recoverable by
> re-shaping. A wrong long route buys era 4's overhead and leaves no trace anywhere, because nothing
> records the ceremony an item did not need. **The share of items routed long is the number to
> watch**, and it is a guess until sheets exist to count.
>
> **Lives in:** `.Workflow/agent-workflows/shape/sheet.ts`, and the route the accept records.
> ADR-0007, ADR-0029.

### 02 · Spec

> **Fires on:** any of the three triggers below, plus `spec/gap` from lanes 04 and 07
> ([ADR-0034](docs/adr/0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md)) and a
> non-bot comment on a spec still carrying open questions.
>
> **Refuses:** an idea whose surviving refutations have not been answered; a map that is not
> `wayfinder:dest-spec`, or that still has open child tickets or a non-empty **Not yet specified**.
>
> **Cost:** 2 Opus stages; **5–15 owner minutes**, batched — the most expensive owner touch in the
> system, and the one that pays for itself, but **conditional**: it fires only where the count below
> is non-zero. · **Sees:** —

`/to-spec` exists but is local-only, which makes it a keystroke gate on every unit of work. Move 6
puts it on a runner.

| Role | Model | Count | Does |
|---|---|---|---|
| Spec author | Opus | 1, cloud | Publishes the spec as a `PRD:` issue. Two non-negotiables: acceptance criteria **quote the owner's words**, and every place it had to invent intent becomes a numbered open question rather than a silent assumption. It does **not** sketch seams — lane 03 owns those |
| Spec critic | Opus | 1, **in the same chain**, before publication | Hunts only for underspecification — sentences admitting two implementations, criteria that cannot be observed. It does **not** propose fixes; proposing lets it paper over the ambiguity it exists to surface. What it finds becomes more open questions |
| ⬤ **owner** | — | 5–15 min, batched, **only when the count is non-zero** | Answer the open questions. This is the one place where going slower makes you faster |

**Three triggers, one prompt, a collector each.** They differ only in where the decided context
already lives, so the difference is in the collector and never in a second prompt — a check defined
twice drifts (§06). Each collector assembles the same **Decided context**: the owner's words
verbatim, the decisions and their reasons, the rulings already filed, the boundaries, and the guesses
still open. [ADR-0058](docs/adr/0058-lane-02-is-one-prompt-with-a-collector-per-trigger-and-a-pay.md).

| Trigger | Event | The collector reads | Surface |
|---|---|---|---|
| An accepted sheet | `approved` on an issue carrying `idea` | The idea body verbatim, the latest `decision-sheet:v1` marker, and the accept's marker | Cloud (Actions) |
| A closed map | `to-spec` on a `wayfinder:dest-spec` map | The map body, then one level down its Decisions-so-far links — preferring the durable record a gist names over its resolution comment | Cloud (Actions) |
| The owner, in session | `/to-spec` in a live grill | Nothing. The conversation **is** the decided context | Local session |

**The accept's marker carries what it filed.** §01 requires this lane to cite rulings rather than
restate them, and the ADR numbers are assigned at accept time and appear nowhere on the sheet. So
`ACCEPTED_MARKER` carries the paths it filed, the terms it coined and the route it recorded —
otherwise the collector parses rendered markdown, which is the failure `marker.ts` exists to prevent.

**Closing a map does not fire this lane.** Roughly half of all maps carry `wayfinder:dest-decision`
and end on the decision alone, and a map stopped at its ticket budget also closes — handing that on
would present a truncated map as a finished one. The label is the decision; the close is not.
[ADR-0059](docs/adr/0059-a-closed-map-reaches-lane-02-by-its-to-spec-label-never-by-b.md).

**Why the tactical door stays local.** Serialising a live grill to an issue so a runner can read
it back is lossy compression that pays double tokens for less signal. The owner is already sitting
there; one more prompt costs seconds. The cloud path exists for the cases where the owner is
*not* sitting there — a Wayfinder Map closed yesterday, or a shaped idea approved from the phone.
**One prompt file, two callers**: the local one passes the live conversation where the cloud one
passes the collected payload.

**The author reads the repo through an allow list.** `Read`, `Grep`, `Glob` and nothing else — no
`Bash`, no web, no issue search, no subagent. It may read the codebase without limit, including
`docs/adr/`, because a spec written against code it cannot see is unbuildable; it may not reach a
**second source of intent**, because inventing intent is this lane's named failure and intent is not
in the codebase. An allow list rather than lane 01's deny list, because a deny list fails open on
whatever tool the CLI gains next.
[ADR-0060](docs/adr/0060-the-spec-author-reads-the-repo-through-an-allow-list-and-can.md). The
in-session author is bound by the owner's presence instead, which is only sound while that door stays
local.

**Everything it cannot settle becomes a numbered open question** —
[ADR-0061](docs/adr/0061-everything-lane-02-cannot-settle-becomes-a-numbered-open-que.md). Three
feeders, one form, no new labels:

| What the author hit | Becomes |
|---|---|
| It had to invent intent | A numbered open question |
| A ruling it was handed is wrong, or two conflict | A question **naming the ADRs**. Answering it is what files the amendment — the same act as an accept, one lane later, and three lanes before ADR-0005's work-merge path |
| The sheet marked a decision and the accept filed no ADR for it | A question carrying the mark's target **verbatim** |

**A spec that ships with zero open questions is treated as suspect** — it guessed silently. This is
C2 done correctly: the machine asks about *intent*, which the owner is the only one who can answer,
and never asks a sizing or architecture question, which he cannot. For the sheet trigger the
suspicion is now **arithmetic**: the sheet's decisions carrying a mark and no `adrTitle`, minus the
open questions naming a mark, is zero. The map and in-session triggers carry no marks, so there it
stays the critic's judgement.

**The gate is a count, and the label is not the trigger.**
[ADR-0062](docs/adr/0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md). `prd`
means *this is a spec* and no longer means *slice it*. At zero unanswered open questions the job
applies `sliceable` and sends a `repository_dispatch`; lane 03 fires on the dispatch, because a label
applied by the built-in `GITHUB_TOKEN` starts no workflow run (ADR-0054). The label is written first
and is the durable trace that a dispatch was owed — a spec carrying `sliceable` with no sub-issues and
no completed run is a lost dispatch, and countable. A model writes the questions; a deterministic rule
counts them, which is ADR-0014's seam and what makes an automatic dispatch safe.

**Answering is the go signal, and the rounds are uncapped.** A non-zero count is the only thing that
reaches the owner; his comment re-runs the chain, which folds the answers in and recomputes. §01 caps
change requests at 2 because the owner is asking the shaper to try again — here the machine asked, and
a cap would park a spec he is actively working on.

### 03 · Slice

> **Fires on:** a `repository_dispatch` from lane 02, sent when a spec's open-question count reaches
> zero ([ADR-0062](docs/adr/0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md)).
> Until move 6 lands it fires on the `prd` label, which is what the shipped workflow still carries —
> and which is why a published spec currently slices itself before the critic or the owner has read
> it.
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
> — Physical disjointness is drawn here, which is what makes concurrent implementers safe to run at
> all — and since ADR-0039 leaves no concurrency dial, the slices this lane cuts *are* lane 05's
> concurrency. That is **W3**, and lane 08 is its merge-time complement rather than a
> replacement.
> — Every `dependsOn` is published as a native blocked-by edge and read back to verify, so the
> dependency graph is a GitHub object rather than a field in a file.
>
> **Lives in:** `.Workflow/agent-workflows/to-tickets/`, fired by
> `.github/workflows/to-tickets.yml`. [ADR-0012](docs/adr/0012-a-stage-s-output-block-is-the-outermost-span-and-the-payload.md).

### 04 · Acceptance

> **Fires on:** a slice published, **or a merged edit to a spec that already has acceptance tests** —
> re-firing for the slices whose tests name a criterion the spec no longer carries verbatim
> ([ADR-0033](docs/adr/0033-a-spec-edit-re-fires-acceptance-for-every-slice-whose-test-n.md)).
> **Refuses:** a criterion the spec does not determine — that is a spec defect, and the correct
> output is a `spec/gap` issue, not an invented test.
>
> **Cost:** 1 Opus per slice. · **Sees:** class 5 (the runtime) and class 6 (promised vs delivered),
> both moved earlier — the tests exist before the code does

| Role | Model | Count | Does |
|---|---|---|---|
| Acceptance author | Opus | 1 per slice, isolated | Writes tests **from the spec only**, with no access to an implementation — because none exists yet. Each test names the criterion it proves, verbatim — which is **W4's endpoint**, documentation a test suite can fail on. Merged to trunk **before** any implementer is dispatched |

**Then the load-bearing part, and it is not the diff check.** The acceptance job checks
`tests/acceptance/` out of `main`'s **tip** before it runs, so whatever an implementation PR did to
those files never reaches the verdict. It *also* refuses a PR with a non-empty diff under the
immutable set — but that refusal is the **alarm**, not the guarantee: it tells us an implementer
reached for its own report card. [ADR-0032](docs/adr/0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md).

**The immutable set is closed, not approximate.** `tests/acceptance/**` is no boundary on its own —
`vitest.config.ts` carries an explicit `include` allowlist, so an implementer can leave every test
byte-identical and delete one line to stop them running, and an imported helper or fixture is the
same hole one level down. The same hole exists one level *up*: on a `pull_request` event GitHub runs
the workflow file **from the pull request**, so an implementer that touches no test at all can
delete the acceptance job and the restore never executes. So the set is **the directory, the
runner's config, and `.github/`**, and an acceptance test **may not import anything outside its own
directory**. The cost is duplication in that tree; the gain is that the path filter is complete and
the restore above restores everything the tests depend on.

**Restoring from trunk is only a guarantee if the instruction to restore also comes from trunk.** So
the implementer opens its PR and then sends a `repository_dispatch`, which fires verification from
**the default branch's** workflow file unconditionally — the judging definition is never a file
inside the thing being judged.
[ADR-0054](docs/adr/0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md). The
forcing fact underneath is that an event caused by the built-in `GITHUB_TOKEN` starts no workflow run
at all, which kills the whole family of workarounds — opening a PR, labelling it after, opening it
already labelled — since the rule is about the token and not the event. `repository_dispatch` is one
of the two documented exceptions, and three workflows here already run on it.

**There is no exemption, and therefore no identity to forge.** The re-entry PR would have had to
modify `tests/acceptance/`, and a label or a branch prefix is a convention any agent with
`issues:write` satisfies by typing — so the check would have had to read **author identity**, and
this lane would have needed its own credential. It doesn't, because **lane 04 opens no pull request**:
it commits its tests straight to `main` from the job that wrote them, which is
[ADR-0051](docs/adr/0051-the-accept-commits-its-rulings-straight-to-main-because-a-pu.md)'s ruling
applied to a second lane. The rule is then absolute — *no pull request may change the immutable set,
nobody is exempt* — and an absolute rule has no attack surface to defend. One principal,
`github-actions[bot]`, no App, no machine account, no new secret.
[ADR-0053](docs/adr/0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md).

**The lane pays for the missing PR by gating its own push.** A pull request would have run CI on the
tests before they landed; a push means a broken batch reddens every in-flight implementer at once,
across the whole PRD. The signal is **not** green — these tests are supposed to fail before an
implementation exists — it is **every test collected, and every failure an assertion rather than an
import or syntax error**. That separates correct-and-red from broken, mechanically.

**No credential is referenced by a job a pull request can trigger.** The model-spending lanes fire on
`issues` and `repository_dispatch` and run trunk's workflow file; the immutability job is a diff and
needs no secret. This is what makes a repository secret safe here, since a private Free repo cannot
have environment secrets with protection rules — that is the same purchase as branch protection. A
missing credential **refuses** (§03's precedent), and the immutability job additionally may never be
*skipped*, whatever is absent: a check that skips is fail-open, which is not a gate.

**Immutable is not frozen, and the difference is where the grooming would have hidden.** A spec that
legitimately changes would otherwise strand its tests with nobody permitted to touch them, and
"someone updates the acceptance tests" is exactly the maintenance obligation C4 refuses to build. So
`tests/acceptance/` has **one author — this lane — and one way to re-enter it:** a merged edit to
the spec re-fires the acceptance author for the affected slices only, on a push of its own, before
any implementer resumes (ADR-0033's "PR of its own" is amended to a push by ADR-0053, for the reason
that lane opens no PRs at all). **"Affected" is a grep, not a judgement:** every test names its criterion
verbatim, so a slice is affected when a test it owns names a criterion string the spec no longer
carries. A criterion *added* with no test naming it is a re-slice, and routes to lane 03 (ADR-0033).
The thing that checks is still never the thing that built, no matter how many times the spec moves.

**An in-flight implementer needs no special handling.** The regenerated tests merge to trunk, its
open PR goes red against them — which is what restoring from tip rather than the merge base buys —
and the fixer takes it as an ordinary red.

**`spec/gap` has a reader: lane 02's spec author.** Where the spec and a test disagree and neither is
obviously wrong, the **spec wins by construction** — the test was authored from it and nothing else,
so the disagreement is a defect in the test or an ambiguity in the spec, and neither is the
implementer's to settle. It files `spec/gap`, a blocked-by edge lands on its slice, the spec author
amends, and the merged amendment fires the re-entry above. The owner sees it only when the spec
author refuses, and then through the brief (§8) like anything else. **An implementer that cannot pass
a test is not a separate escalation** — it is a red PR, which is the fixer's trigger, and the fixer's
no-progress exit then `blocked` is the whole path.
[ADR-0034](docs/adr/0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md).

This is the single highest-value item on this page. It is **W2 made structural** — the thing that
checks is never the thing that built — where era 6's `close-gate.py` is the weak form of the same
idea, because the closing record it reads is authored by the agent being judged. It is also the
mechanism that makes the whole out-of-the-loop premise safe: without it, the fleet's output is
unverifiable, which makes it worthless, which puts the owner back in the loop reading diffs.

**It runs at the Actions venue** — lane 06 binds that, along with the 10-minute budget it has to fit.
The immutability check is its own job in `verify.yml`, fired on the implementer's
`repository_dispatch`, running **before** the gauntlet: it is a diff test costing a second, and it
invalidates the run beneath it.

**A run judges one slice, not the PRD.** Every slice's tests land on trunk before any implementer is
dispatched, so a run that executed all of them would redden every parallel PR until the last slice
shipped. The job runs **only the tests naming this slice's criteria** — which is the same grep
ADR-0033 already relies on, since every test names its criterion verbatim.

**A dispatch that never arrives looks like a check that hasn't finished.** That is #41's failure
class, and it binds lane 08: the merge actor requires a *completed* verification run, which is
stronger than "no red check."

**It refuses from the day it ships, and ADR-0011 does not hold it back** — the ADR is amended to say
so. The only thing that can violate this check is a dispatched implementer, so it has no traffic
until lane 05 exists and ships alongside its own violator; and ADR-0011's failure mode is a refusal
that *parks* work because clearing it needs reasoning nobody automated, where the repair here is
`git checkout main -- tests/acceptance/`. Enforcement is not branch protection, which is move 10 and
costs money — lane 05 auto-merges on green and lane 08's warden merges, so the **merge actor** reads
the check and a red refuses without it.

### 05 · Build

> **Fires on:** `ready`. **Refuses:** nothing — there is no dispatch gate
> ([ADR-0039](docs/adr/0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)).
>
> **Cost:** 1 Sonnet per slice, plus up to 3 fix attempts on red. · **Sees:** — while it runs

`/implement` and `/drain` exist locally. `/implement` is ported and narrowed by this lane; `/drain`
does not survive the map — [ADR-0027](docs/adr/0027-six-of-era-6-s-eleven-verbs-do-not-survive-the-map-and-two-s.md).

| Role | Model | Count | Does |
|---|---|---|---|
| Implementer | Sonnet | one per ready slice, isolated checkout | Brief is the ticket, the seam manifest, the module's `CONTEXT.md`, and the failing tests — **not** the repo. An implementer that reads broadly couples broadly. Needing to read outside that brief is an interface defect, but it **reads on and records what it read** rather than blocking ([ADR-0042](docs/adr/0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md)) |
| Fixer | Sonnet | 1 per red PR | Attempts to green a failing build. **Stops when it stops making progress** — same failing test, same error, twice — and in any case at **3 attempts**; then labels `blocked`, writes what it tried, and stops ([ADR-0041](docs/adr/0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)). Uncapped fixers are how you find out on Sunday that something ground against a wall for eleven hours |

**The fixer is what unlocks the last move.** It is the only thing in the design that clears a red
without the owner, so nothing may be promoted to refusing before it exists —
[ADR-0011](docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md), and the reason branch
protection sits at move 10 rather than move 1. Move 10's timing rides on the fixer **existing**, not
on what its cap is, so ADR-0041 does not move it.

**There is no concurrency dial.** Implementer count is however many ready disjoint slices lane 03
cut, absorbed by lane 08's single serialised merge. A WIP number would duplicate both
([ADR-0039](docs/adr/0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)).

**A seam question does not block.** The implementer reads what it needs, carries on, and records that
it went outside its brief and which module it read. **The count is the finding, and it is about lane
03, not lane 05** — a rising count says the seam manifest is systematically wrong, which no
per-implementer refusal would ever have surfaced. Nothing downstream watches coupling: the seam lens
was dropped (ADR-0019, one finding in 28 sessions, stale), and `CODING_STANDARDS.md` carries no rule
for the violation lens to fire on. That same evidence is why blocking does not earn its cost.

**A run does not write what surprised it.** Write-on-surprise is struck before it is built —
[ADR-0043](docs/adr/0043-write-on-surprise-does-not-ship-the-transcript-auditor-alrea.md), replacing
ADR-0008's ruling. There are no module `CONTEXT.md` files to write to, the bar is uncalibrated, and
its failure mode compounds: `CONTEXT.md` is loaded into every future brief by construction, so a
wrong bar degrades every subsequent run permanently. W6 is carried by the transcript auditor, which
runs at session end over a corpus already captured and is measured at 70% valuable. **What is lost is
the fast loop** — a run's learning now reaches the owner at release rather than the next implementer
directly, and the signal to revisit is implementers rediscovering the same thing about one module.

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
> move 10 there is **no venue an agent cannot route around**. What counts how often one does is the
> **bypass counter** (§6), and it counts one event only — a commit reaching `main` with a tree
> `bin/gauntlet push` refuses. A red tree mid-session is not a bypass; it is a legitimate state, and
> the harm exists only where the red survives to trunk
> ([ADR-0063](docs/adr/0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md)).
> — **`verify.yml` distinguishes a finding from a broken runner in its step names**, not in its logs:
> `Gauntlet` for exit 1, `Gauntlet could not run` for exit 2. The third exit code is excluded from the
> bypass count by construction rather than by a reader inferring it from a string the gauntlet happens
> to print — which would be this section's own *defined once* rule broken by its own counter
> (ADR-0063).
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

> **Fires on:** CI green. **Refuses:** a finding that names no `path:line` in the diff, or that
> restates a rule a green gate already enforces — before any model reads it
> ([ADR-0036](docs/adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md)). The
> lane produces findings rather than verdicts, so it refuses nothing about the PR itself.
>
> **Cost:** 2 Opus per PR, plus **at most 1 Sonnet per surviving finding**. · **Sees:** class 2 (a
> single diff) and class 6 (spec conformance)

| Role | Model | Count | Does |
|---|---|---|---|
| Correctness reviewer | Opus | 1 per PR | Hunts defects, not style. Style is the linter's job and arguing about it in review is pure noise |
| Conformance reviewer | Opus | 1 per PR | Reads the **spec first, then the diff** — an agent that reads the implementation first will rationalise it. Scoped to **the part of the spec no acceptance test encodes**, because lane 04 already answered the rest in the CI run this lane fires on. Code diverging from a clear spec is a review finding; a spec that is silent or wrong is **`spec/gap`**, fired at lane 02 ([ADR-0038](docs/adr/0038-lane-07-s-conformance-reviewer-files-spec-gap-where-the-spec.md)) |
| Refuter ×1 | Sonnet | **1 per surviving finding** | Tries to **kill** the finding. At N=1 there is no majority, so it is a veto — which is why a refusal must **name its reason**, and one that names nothing is stripped mechanically and the finding survives ([ADR-0035](docs/adr/0035-lane-07-ships-with-one-refuter-and-a-refusal-that-names-no-r.md)) |

The refuter is not a quality mechanism — it is the **queue-length mechanism**. C7 caps the owner's
queue at ~7; a review layer with no filter fills that cap with noise in a day, and the next round of
alarms gets trusted less. A false alarm that reaches the owner costs more than a caught bug missed
here.

**Three refuters was a guess, and the number that retired it already existed.** ADR-0019's graded
corpus — 27 findings judged by the owner — puts this estate's agent-finding noise rate at **22%
worthless**, which at this repo's PR volume is roughly one noise finding every second PR against a
queue cap of ~7. The two things that actually moved that corpus from 26% valuable to 70% were
neither of them a model: fixing the lens's **input**, and adding a free **deterministic** gate. The
refusal above is that second lesson; the single refuter is what is left once arithmetic has done the
work it can do.

**The direction of change is grow, and the counter is two-sided.** A second refuter is proposed at
**3** surviving findings the owner closed `not planned` or left untouched for five days; the fleet's
deletion is proposed at **20** findings with zero ever refuted
([ADR-0037](docs/adr/0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)). Both
file an issue and never act. The asymmetry is deliberate: adding a refuter is a prompt edit, and
ADR-0019 dropped two whole lenses on a one-finding sample for exactly that reason, while deleting a
filter is the direction where being wrong is expensive and silent.

**This is §01's probation, inverted.** Lane 01's refuter fires by *adding* a surviving refutation to
the sheet; lane 07's fires by *removing* a finding from the queue. Silence is the good outcome per
item in both, and the bad outcome in aggregate in both — which is why ADR-0031 gave lane 01 a count
silence could not satisfy forever, and why lane 07 inherits it. The one difference is the second
threshold: lane 01's refuter can only fail by being silent, lane 07's can also fail by killing
everything.

**Not an agent's job.** Scale, cost-to-run and architectural fragility fail silently and late, and
neither the owner nor an agent can verify an agent's judgement on them. That is a contract
engineer for a half day, twice a year. A line item, not a gap to engineer around.

### 08 · Integrate

> **Fires on:** PR approved. **Refuses:** a merge whose gauntlet has not been re-run against current
> trunk.
>
> **Cost:** no model — deterministic, serialised. · **Sees:** nothing. It is a merge queue, not a lens
> ([ADR-0040](docs/adr/0040-lane-08-merges-without-a-model-and-the-semantic-conflict-cla.md))

| Role | Model | Count | Does |
|---|---|---|---|
| Merge warden | none | **exactly 1, serialised** | Rebase, re-run the full gauntlet against current trunk, merge, deploy preview. Builds fan out; merges do not |

**It spends no model and holds nothing.** The class it was built for is the **semantic** conflict git
merges cleanly: two PRs that both compile, both pass, and together mean the product has two ways to
do one thing — `formatDate()` in one, `dateToString()` in the other. Neither reviewer catches it,
because each saw one diff.

**That class goes to the proposed lens instead.** Its two-site gate (ADR-0019) already fires on *the
same thing at two places*, is measured at 55% valuable across 27 graded findings, costs nothing
beyond the transcript audit already running, and ships in move 8b. The warden's only unique
contribution was **timing** — the lens deliberately waits for the second site, so it always fires
once the duplicate is in trunk. That left two coherent designs and no middle: *hold and file*, which
is genuinely earlier but parks work that only the owner can clear (ADR-0011, the same ground that
deleted the governor); or *merge and file*, which fires at the identical moment the lens does and
adds a model call for nothing. Ruled: **neither — no warden model.**

**The bet is that the lens catches it one release later.** If duplicated work starts landing in trunk
and the lens is not surfacing it, this is the decision to revisit; the evidence is in the release
batches, which are already stored.

This is still the merge-time complement to W3, which lane 03 implements at authoring time.
Authoring-time disjointness prevents textual conflict; the serialised merge prevents the rebase race.
Semantic conflict is watched after the fact rather than at the gate.

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
> — **A close the gate never saw is reconciled afterwards, not watched for live** — the reconciler
> below ([ADR-0048](docs/adr/0048-the-close-gate-s-reconciler-rides-session-end-because-a-cron.md)).
>
> **Lives in:** `.github/workflows/close-gate.yml`, `close-gate-reconcile.yml`,
> `.Workflow/agent-workflows/close-gate/`. ADR-0013, ADR-0014, ADR-0021, ADR-0022, ADR-0023,
> ADR-0048.

**The venue's own hole, and what closes it.** `issues.closed` fires no matter *how* an issue was
closed — but only if Actions is up to receive it, and GitHub does not replay an event a workflow
missed. A close that lands during an outage produces no run, no verdict and no `close-refused`, and
is indistinguishable from a close that passed. So a **reconciler** asks, after the fact, the one
question that stays answerable from durable state: *which completed closes have no gate run?* What
it finds it reopens, with a comment saying no verdict exists — not that the record was bad — and the
normal repair path takes it from there. It applies no label: `close-refused` means an open refusal
(ADR-0023), and a close nobody read is not a refused one.

This is not [#41](https://github.com/collod873/claude-workflow/issues/41)'s watchdog and does not
retire it. This failure is Actions not running workflows, so anything firing *during* it would be
down with it; a reconciler only has to run *after*, which is what makes being asleep through the
outage cost it nothing.

That "during vs after" is a property of *this* failure, not a requirement on every mechanism —
[ADR-0049](docs/adr/0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md) says why,
and #41's watchdog rides the same dispatch for it. The distinction that generalises is whether the
evidence outlives the failure: a missed `issues.closed` is gone, because GitHub never replays one, so
the close gate has to reconstruct. A run that executed nothing is not — the run object and its job
count sit in the Actions API for ninety days, and reading them an hour later is no worse than reading
them as they appeared.

It **spends no model**, recomputes rather than stores — no cursor, no ledger, so nothing it says can
go stale and a reopened issue simply is not a closed one next time — and it **gets no §6 row**. §6 is
lenses and counters: things that read and file. This acts, on the gate's own behalf, and belongs to
lane 09's contract rather than beside the mechanisms that watch it. Same reasoning that keeps the
back-stamp off that table.

Its ceiling is declared where it is implemented: the link between a close and the run that judged it
is a **correlation** (the run's display title and its creation time), not a fact the gate stamped, so
two same-titled issues closed inside one window can let one run vouch for both. The stamp is the
upgrade and it is strictly more work; the correlation is what shipped.

**Retires blocker 1, structurally.** The venue is what does it: `issues.closed` fires no matter *how*
an issue was closed — keyword, phone, web UI — and an Action that errors is a red run rather than a
silent pass. A gate that cannot be routed around is the precondition for stepping back at all.

---

## 6 · The standing lenses and counters

Twelve things get read while nobody is watching. Seven spend a model; five only count. Each is
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

**`built` here now means run.** It did not until 2026-08-26. Both lenses were built in #63 and
wired to a dispatch the hook never sent, so every `Audit` run — fourteen of them — skipped, and a
skipped run is green ([#107](https://github.com/collod873/claude-workflow/issues/107)). The first
execution is
[run 32996383308](https://github.com/collod873/claude-workflow/actions/runs/32996383308): VIOLATION
read the range against both ratified entries and found nothing, PROPOSED returned four findings,
all four held single-site by the gate below, and the note landed on `refs/notes/observations`. The
column above is a claim about execution, and that run is what now supports it.

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
| 4 | The transcript | The transcript lens — the only class-4 mechanism, since write-on-surprise is struck ([ADR-0043](docs/adr/0043-write-on-surprise-does-not-ship-the-transcript-auditor-alrea.md)) |
| 5 | The runtime | Lane 06; lane 04's acceptance tests, moved ahead of the code |
| 6 | The tracker | Lane 09's close gate; lane 07's conformance reviewer |
| 7 | **Absence** — what should exist and doesn't | **The bypass counter** and **the lost-dispatch counter**, below |
| 8 | **Drift** — this was true and stopped being | The spec lens, the decision-log lens, the backwards question, and **the missing-trailer counter** — the only one of the four that both exists and files (ADR-0067) |
| 9 | **The owner's behaviour** — corrected, reverted, asked twice | **The `not_planned` counter**, below |
| 10 | **Across repos** — not a repo rule, a rule | **The cross-repo counter**, below |

Drawing this ledger is what produced the counters. Rows 1–6 were already watched two and three times
over, by four Opus lenses and two whole review lanes; rows 7, 9 and 10 had nothing at all — and
every one of them is **countable**, which is to say free. That is the taxonomy's own finding pointed
at this design: *the current system spends models on everything it already covers and counts nothing
in the places it doesn't. The dreamboat is not more model passes.*

**That finding is why the counters exist; it is no longer what admits one.** The same sentence became
the section's admission bar and, having no stopping condition, took it from three counters to ten in
four days — so the bar below replaced it (ADR-0064), and answering rows 7, 9 and 10 turned out to
take four counters of which only one is one of the original three (ADR-0065).

### The free counters

**What admits one.** A counter names an **event** that happens on its own, a **count** at which it
acts, the **issue** it files, and the **action** that issue proposes — and before it is built it is
measured against the history it would have read
([ADR-0064](docs/adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)). *Countable,
therefore free* is retired: it was an argument about compute, and compute was never the constraint —
counting is free, the issue it files is not. A number that names no action is not a counter at all;
see **Sizing measurements** below.

This section read "the three free counters" and the table grew to ten in four days on the retired
argument. Applying the bar cut two and moved four out
([ADR-0065](docs/adr/0065-parity-and-correction-do-not-survive-their-own-history-so-se.md)). A fifth
was admitted the same day — the missing-trailer check, which had left §6 attached to a mechanism that
files nothing
([ADR-0067](docs/adr/0067-the-missing-trailer-check-is-a-counter-because-it-files-wher.md)). Five
remain, and each row states its own contract:

| Counter | Fires on | At | Files, proposing | Sees |
|---|---|---|---|---|
| **Bypass** | `verify.yml` completing on a push to `main` | 3 | Bring move 10 forward. Counts runs whose failed step is `Gauntlet` — a tree that reached trunk that the free venues would have refused. Not the code: **the gate not having run** | 7 |
| **`not_planned` closes** | A lane 07 finding issue closing | 3 grow · 20 delete | Add a refuter, or delete the fleet — the tracker (class 6) crossed with the owner's behaviour (class 9) | 6 × 9 |
| **Cross-repo** | A finding recorded, in any repo | 2 — the second site | File here a machinery defect found elsewhere. C3's candidate trigger, applied across the estate | 10 |
| **Lost dispatch** | A spec published carrying `sliceable` | 1 | Name a PRD that carries the label with no sub-issues and no completed slicing run — a `repository_dispatch` that never arrived | 7 |
| **Missing trailer** | An ADR or research note committed to `main` | 1 | Write the trailer, or state it is not a supersession. An ADR carrying a supersession verb and a link to a lower-numbered ADR but no `Amends:` trailer; a `docs/research/` note with no `Resolves:` field | 8 |

**Cut: parity and correction**, on their own history rather than on argument (ADR-0065). Correction
reads reverts and same-day add-and-delete; across **175 commits** this repo has **zero** of each — an
empty set over both halves of its trigger. Parity compares a slice's shape to its siblings' at the
moment the slicer publishes them, and across the **34 sibling slices** in this repo's four sliced PRDs
that shape is uniform because `file-issue ticket` **refuses** a body without it — which
[ADR-0036](docs/adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md) already
refuses as a finding a green gate covers. Read instead at the pull-request level it has no corpus at
all: this repo has opened zero PRs, ever. Neither row goes dark — the bypass counter holds row 7 and
`not_planned` holds row 9, and both are specified where these two never were.

**The cross-repo counter's remit shrank when
[ADR-0055](docs/adr/0055-a-lane-ships-as-a-reusable-workflow-and-a-second-repo-carrie.md) landed.**
Lanes are called rather than copied, so machine drift across repos cannot happen in the half this
section was written about, and `regenerate && diff` covers what copying survives (ADR-0057). The
defect-carrier half is now the whole job, and it is the only mechanism on row 10.

**Sizing measurements are not counters and get no row here.** Four numbers this design named produce
nothing and reach nobody: the share of red PRs reaching `blocked`
([ADR-0041](docs/adr/0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)),
out-of-brief reads by module
([ADR-0042](docs/adr/0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md)), PR wait
time at the merge
([ADR-0039](docs/adr/0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)), and the
share of specs dispatching at a zero open-question count
([ADR-0062](docs/adr/0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md)). Each is
the query that would say its own decision was wrong, so it lives in the ADR that made that decision
and nowhere else. A row here is read as coverage, and four rows nobody will ever query is C5 asserted
rather than scored.

**The brief does not exist yet, and that blocks nothing.** Every counter's reader is the owner via
the brief (move 9, unbuilt) — but the tracker is already a reader: 72 issues closed at a median 1.5 h,
roughly thirty items cleared a day. The brief **batches by topic**; it does not originate, and an
unbatched counter is not an unread one. Nothing below waits on move 9.

**The bypass counter reads what is already being produced.**
[ADR-0063](docs/adr/0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md). Measured
2026-08-26: of 34 `verify.yml` runs on `main`, **four failed at the Gauntlet step** — roughly one push
in nine arriving red, produced continuously since 2026-08-23 and read by nobody. It files an issue at
**three**, proposing that **move 10 be brought forward**, which is the only repair §06 names for this
class; a declined proposal re-proposes only when the count has grown. It fires the day it ships, and
that is the finding rather than a mis-set threshold.

It is **one-sided and needs no delete trigger**, which no other counter here can say: move 10 makes
its class structurally impossible, so its probation is discharged by a build landing rather than by a
zero count (ADR-0031's shape, satisfied without a second number). Its success condition is its own
deletion.

Two things it deliberately does not see. **The session corpus cannot carry the in-turn bypass** —
`spine.ts` drops tool traffic and harness-injected entries by design, so the gauntlet's block message
appears in 22 raw transcripts and **0 of 1,522 captures** — and the raw transcripts that do hold it are
machine-local, which ADR-0002 rules out on both clauses. And a red tree that never reaches `main` is
not counted at all: a red suite mid-task is a legitimate state, so there is one counter here and not
two.

**The `not_planned` counter is row 9's mechanism — lane 07 gave it a job.** ADR-0013 scopes the close
gate to a close marked `completed`, which leaves one way past it: closing a delivered ticket as *not
planned*. The count is `not_planned` closes on issues that carry `## Acceptance criteria` — and crossed with class
9, the owner's own behaviour, that same count is what sizes lane 07's refuter fleet
([ADR-0037](docs/adr/0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)): a
surviving review finding closed `not planned`, or **left untouched for five days**, is a false alarm
that reached him. Five days is a plain duration, not a reference to §8's deleted expiry — and it is
better grounded now than when it was inherited: the longest this repo has ever taken to close an
issue is 47.1 h, so untouched-at-five-days is ~2.5× the worst observed and genuinely anomalous. It
ships with [move 7a](https://github.com/collod873/claude-workflow/issues/99) rather than with the
counters above, because it is that lane's only evidence that its filter is sized right.

**The lost-dispatch counter is the absence one level further out than the run watchdog can see.**
[#41](https://github.com/collod873/claude-workflow/issues/41)'s watchdog keys on a run that executed
**zero jobs** — it reads runs. A `repository_dispatch` that never arrived produces no run at all, so
a run-reading sweep has nothing to find, and the only surviving trace is a spec carrying `sliceable`
with no sub-issues and no completed slicing run. It fires at **1**, because a single lost dispatch is
a defect rather than a trend. Its reader is the owner, like every other counter here: ADR-0062 ruled
`sliceable` a **durable trace rather than a trigger**, so no mechanism consumes it and none can be its
reader. It rides move 8d, the other row-7 counter and the other reader of run metadata.

None of them spends a model, and each can run on every push: counting produces no commits, so it
cannot feed on its own output. A count is also recomputed rather than stored, so nothing a counter
says can go stale — which is the defect that made 43% of Lumaria's four weeks of inbox findings dead
on arrival. The bypass counter reads run *metadata* for the same reason: a step name is recomputed
state, where the log line separating exit 1 from exit 2 is a string `bin/gauntlet` happens to print
and nothing guards — a second copy of a fact the runner already holds (ADR-0063).

**The cross-repo counter is the mechanism C5's originating question asked for** — *"this repo owns
the skills so when it makes changes like that which should effect our other repos how do we catch
that without fail?"* It is also the only thing on this page whose value grows with the **estate**
rather than with the pipeline, which is what turns §11's scope question from a blocker into a
sequencing question: it is worth building at two repos and worth more at twenty.

It is also the carrier for a machinery defect found outside this repo. ADR-0009 rules that such a
defect is filed here, and a run dispatched into another repo has no write path back — so until one
exists, the run records the defect in its own output and the counter walks it home. **That is now the
whole job** (ADR-0065): after ADR-0055 there is no sync contract to drift, because lanes are called
rather than copied, and `regenerate && diff` covers the copied half. Being the carrier is what makes
it load-bearing rather than merely cheap, and it is the reason it survived a bar that cut the two
counters it was originally listed beside. It has nothing to count until a second repo is in scope, so
it ships with [move 12](https://github.com/collod873/claude-workflow/issues/114) — the move that
supplies its precondition — rather than early and idle or late.

**Every lens and counter produces issues, never notifications.** The brief is the only thing that
reaches the owner.

**Everything that claims to catch something is asked whether it ever did**, at the event that would
add another of its kind — the generalisation of
[ADR-0003](docs/adr/0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md). That is
the lenses and counters here, and it is also **the lint rules and the ADRs**, which is where blocker
3's evidence actually lives: not one of them has ever been asked. *(Count them rather than reading a
number here — the `rules` blocks in `eslint.config.js`, and `ls docs/adr/0*.md | wc -l`. This paragraph carried
"36 rules and 30 ADRs", an era-6 figure that was never this repo's; #85 corrected it to 44 ADRs on
2026-08-26 and it was 63 by the end of the same day. A hand-stamped count is the grooming obligation
C4 bans, in the paragraph that complains about unpaid audits.)* A lens audit that covers only lenses
retires the blocker for the newest thing in the estate and leaves the oldest untouched. **Retires
blocker 3** on that condition, and only on it.

**For a counter, that event is the admission of the next counter** — ADR-0064. Admitting one asks
every counter already here whether it has filed an issue since it shipped, and a zero-count counter is
deleted in the same commit with the finding as the reason. ADR-0003's own shape: a rule's audit rides
`/standards-pass`, the event that adds a rule. Nothing is scheduled, nothing is groomed, and the
admission bar and the backwards question are one event rather than two — which is what
[ADR-0031](docs/adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) requires of
anything on probation. An unbuilt counter is asked the same question **backwards**, against the
history it would have read; that is what cut parity and correction, and what admitted the bypass
counter with a backlog of four.

**What it does when the answer is no is not deletion.** Ruled 2026-08-26,
[ADR-0044](docs/adr/0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md) through
[ADR-0046](docs/adr/0046-the-backwards-question-writes-rather-than-reports-so-it-need.md). "Unread"
is not observable — the session corpus records `Read:` lines but caught only 3 of this repo's ADRs
in 876 captures, and misses `cat`, `grep`, always-on context and subagent reads. The signal that
*does* discriminate is the citation graph, and it finds the **superseded** records, which must
survive. So for prose the act is a **back-stamp**: a `Status: superseded by ADR-NNNN` line derived
from an `Amends:` trailer the successor writes. Deletion survives only where an exit already exists
— the lint rules, and `CODING_STANDARDS.md`'s *mechanised*.

The back-stamp is **not a counter and gets no row above**: §6's counters file issues that reach the
owner through the brief, and this one commits a repair nobody receives. It ships as its own move,
blocked by nothing, and ADR-0064's admission bar does not reach it — a bar whose test is *what issue
does it file* has nothing to ask a mechanism that files none. What that ruling took from it instead
is the operational shape of the backwards question, now pointed at the counters themselves.

**Move 8c carries two mechanisms and only one of them is that.** The back-stamp writes a
`Status:` line from a trailer that exists; the **missing-trailer check** finds a supersession whose
trailer does not, and it cannot write anything, because the fact it needs is the fact that is absent.
So it files, and it is the fifth counter above
([ADR-0067](docs/adr/0067-the-missing-trailer-check-is-a-counter-because-it-files-wher.md)). The two
travelled out of this section together because they read the same trailer graph. Measured on
2026-08-26: **2 of 66** ADRs carry an `Amends:` trailer, **27** carry a supersession verb and a link
to a lower-numbered ADR without one, and `docs/research/` went from two-of-seven to **three-of-nine**
documents with no issue pointer — a backlog that grew while the field stayed unbuilt. `bin/new-adr`
still has no `--amends` flag; ADR-0045 mandated one, and it ships with move 8c as the counter's
repair path.

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

## 8 · The brief

**The owner is the constraint. Feeding a constraint faster does not help.** *(C7.)*

**There is no governor.** It had three limits and none survive —
[ADR-0039](docs/adr/0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md). A daily
spend ceiling went first (ADR-0024): the pipeline runs on the Claude subscription rather than metered
API billing, so there is no unit to budget in. The queue-depth stop and the WIP cap went with it, on
this repo's own first 100 issues:

| | |
|---|---|
| Median time to close, 72 closed | **1.5 h** |
| p90 | 44.3 h |
| Maximum | **47.1 h** |
| Ever reached the 5-day expiry | **none** |
| Peak simultaneous open | **23** — 3× the ~7 cap, no observable stall |

The owner clears roughly thirty items a day and has never been the bottleneck; a cap sized to his
review rate is sized against a constraint that has never bound. **Decisions no longer expire**
either — a five-day re-read guards an event 100 issues say does not happen, which is what
[ADR-0031](docs/adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) rules
against. If his answer latency changes, the same query says so, for free, with nothing built.

**Concurrency was never a dial.** Two things already bound implementer count: the number of ready
disjoint slices lane 03 cut, and lane 08's single serialised merge that absorbs them. **The
serialised merge is the real throughput ceiling and is now load-bearing** — it stays serialised
because parallel wardens cannot see each other's merges, and if it binds, that shows up as PR wait
time, which is countable.

Work started but not reviewed still rots: trunk moves underneath it, it rebases badly, its
assumptions expire. That cost is caused by the serialised merge, so it belongs at the merge —
capping dispatch to avoid it was treating the symptom at the wrong end.

**Runner minutes are not an input.** Ruled by the owner 2026-08-26: the rolling-30-day Actions figure
in `docs/research/actions-billing-2026-08.md` could not be reproduced against a source, and if the
allowance is ever actually hit, that is the moment to rethink and not before. Nothing here is sized
against Actions minutes.

**C7 is unchanged.** What did not survive is the Foundry's *mechanism* for it. C7's test is *how many
times a day does this interrupt?*, and the brief answers that alone, being the only thing permitted
to reach the owner.

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

**No number lives here** —
[ADR-0066](docs/adr/0066-a-number-lives-in-an-adr-or-in-a-counter-row-never-in-the-op.md), amending
ADR-0026, which moved the build order and the filed questions out and left the unmeasured numbers
behind. A number belongs to a decision or to a mechanism: to a decision, and it is a **sizing
measurement** living in that decision's ADR; to a mechanism, and it is a **counter** with all four
fields in §6. There is no third home, so there is nowhere here for one to be parked. That is what
struck questions 3 and 6 below.

**Filed.** These live as issues; this list carries the pointer and nothing else (ADR-0026). None
open.

**Not yet filed.** Two, and they are one deferred owner decision wearing two hats.

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
3. ~~**The sweep's kill rate has never been measured** (lane 01).~~ **Struck** — it was the wrong
   number. The cost half dissolves on ADR-0024, and a bare kill rate cannot tell a correct kill from
   an over-refusal. What discriminates is **the share of stage-1 refusals cleared by a comment**,
   which lives in
   [ADR-0052](docs/adr/0052-a-comment-clears-a-stage-1-refusal-because-the-change-reques.md), the
   ruling it would falsify
   ([ADR-0066](docs/adr/0066-a-number-lives-in-an-adr-or-in-a-counter-row-never-in-the-op.md)).
4. ~~**Write-on-surprise is uncalibrated** (lane 05).~~ **Retired** — the mechanism is struck
   before it was built, so there is nothing left to calibrate
   ([ADR-0043](docs/adr/0043-write-on-surprise-does-not-ship-the-transcript-auditor-alrea.md)).
5. ~~**Nothing counts gate bypass** (lane 06).~~ **Ruled** — a bypass is a red tree reaching `main`,
   counted from `verify.yml`'s failed step names, filing at three and retired by move 10
   ([ADR-0063](docs/adr/0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md)). It
   was never unmeasured: four of 34 runs had already recorded it.
6. ~~**Intake templates are per-repo copies** (lane 00).~~ **Dissolved** —
   [ADR-0057](docs/adr/0057-the-installer-derives-every-list-it-acts-on-and-overwrites-o.md) put
   `.github/ISSUE_TEMPLATE/` on the installer's **Wires** list, derived and overwritten on re-run.
   It does not degrade with repo count, so twenty repos never need `/sync-skills`
   ([ADR-0066](docs/adr/0066-a-number-lives-in-an-adr-or-in-a-counter-row-never-in-the-op.md)).
7. ~~**Lane 08's merge warden is unspecified.**~~ **Retired** — there is no such finding and no
   such warden. The lane spends no model and the semantic-conflict class goes to the proposed lens
   ([ADR-0040](docs/adr/0040-lane-08-merges-without-a-model-and-the-semantic-conflict-cla.md)).

**Ruled, and no longer open.** The seam picker's placement (lane 03's Binds); the daily spend ceiling
(ADR-0024); the short path's availability to features (ADR-0007); write-on-surprise's home
(ADR-0008); where a machinery defect is filed (ADR-0009); what a decision sheet contains and when the
shaper refuses (ADR-0028 through ADR-0031, and §01 above); how many refuters lane 07 ships with
(ADR-0035 through ADR-0038); **the governor, which does not ship at all** (ADR-0039), and with it
the ~7 queue cap, the WIP cap and the five-day decision expiry; **lane 08's model** (ADR-0040); the
fixer's exit (ADR-0041); what a seam question does (ADR-0042); **write-on-surprise, struck**
(ADR-0043); **whether an unread document gets deleted — it does not, and the act is a back-stamp**
(ADR-0044 through ADR-0046, and §6 above); **how far lane 01's sweep reads** (ADR-0050), where an
accept's rulings land (ADR-0051), and what clears a stage-1 refusal (ADR-0052); **how the machine
reaches a second repo — a lane is called, never copied** (ADR-0055), **what makes the check contract
survivable — it is generated and the gauntlet runs it** (ADR-0056), and what an installer covers
(ADR-0057); **what lane 02's spec author reads, what it may reach, and what dispatches the slicer**
(ADR-0058 through ADR-0062, and §02 above); **what a gate bypass is, and what counts it** (ADR-0063,
and §6 and §06 above); **what admits a counter, and what a number that names no action is instead**
(ADR-0064 and ADR-0065); **where a number lives — an ADR or a counter row, never this list** (ADR-0066,
amending ADR-0026), and **that the missing-trailer check is a counter** (ADR-0067).
