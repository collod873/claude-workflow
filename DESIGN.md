# The design

**Drafted:** 2026-08-23 · **Status:** the target. What the machine is, drawn from
[`GOAL.md`](GOAL.md) rather than from the skills that exist today.

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
- **Sized to one operator and four live repos**, not to a SaaS product with users. Anything with no
  repo to attach to is cut and named as cut.
- **Every lane carries the constraint it answers to**, and the blocker it retires.

---

## 0 · How to read this

Each lane names the **event** that fires it, the **refusal** it makes before spending model time,
and its **cost**. A lane with no event is not a lane. A row marked **⬤ owner** is a point where
Collin is required — there are five, and reducing that number is the whole project.

Status marks: **live** (built, running), **partial**, **absent**.

The scoring rule: a proposed lane is held against C1–C7 in `GOAL.md` §2. A lane that fails a
constraint is not a smaller lane; it is a different goal, and it does not get built.

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

Nine lanes. A work item passes through them in order. **⬤ owner** marks the five points where
Collin is required.

### 00 · Intake — *absent*

> **Fires on:** the owner filing an issue. Nothing else in the system is human-initiated.

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

**Scope: this repo only**, until there is evidence about which repos ideas actually arrive for.
Adding another is a copied file. Note that defaults cannot be centralised — GitHub requires a
public `.github` repository for default community health files, which does not cover a private
estate.

### 01 · Shape — *absent*

> **Fires on:** the `idea` label. **Refuses:** at stage 1, an idea that already exists or that an
> ADR has already ruled on — the chain stops there and never spends the shaper.

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
review** (lanes 06–07). It is available to defects only — a *feature* that looks small still takes
the long path, because that is exactly where the ceremony was earning its keep.

### 02 · Spec — *absent on a runner* (`/to-spec` exists, local)

> **Fires on:** `approved`. **Refuses:** an idea whose adversary comments have not been answered.

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

> **Fires on:** a slice published. **Refuses:** a criterion the spec does not determine — that is a
> spec defect, and the correct output is a `spec/gap` issue, not an invented test.

| Role | Model | Count | Does |
|---|---|---|---|
| Acceptance author | Opus | 1 per slice, isolated | Writes tests **from the spec only**, with no access to an implementation — because none exists yet. Each test names the criterion it proves, verbatim. Merged to trunk **before** any implementer is dispatched |

**Then the load-bearing part:** CI refuses any implementation PR that modifies a file under
`tests/acceptance/`. An implementer that cannot pass a test cannot quietly rewrite it — it can only
fail, escalate, and land in the queue as blocked.

This is the single highest-value item on this page. It is **W2 made structural** — the thing that
checks is never the thing that built — where era 6's `close-gate.py` is the weak form of the same
idea, because the closing record it reads is authored by the agent being judged. It is also the
mechanism that makes the whole out-of-the-loop premise safe: without it, the fleet's output is
unverifiable, which makes it worthless, which puts the owner back in the loop reading diffs.

### 05 · Build — *absent on a runner* (`/implement`, `/drain` exist, local — see §2)

> **Fires on:** `ready` **and** a free slot under the governor's cap. **Refuses:** dispatch when the
> owner's decision queue is full (§8).

| Role | Model | Count | Does |
|---|---|---|---|
| Implementer | Sonnet | 3–6 concurrent, isolated checkout | Brief is the ticket, the seam manifest, the module's `CONTEXT.md`, and the failing tests — **not** the repo. An implementer that reads broadly couples broadly. Needing to read another module means the interface is wrong, which is a `seam/question` issue, not its call to fix |
| Fixer | Sonnet | 1 per red PR, **max 3 attempts** | Attempts to green a failing build, then labels `blocked`, writes what it tried, and stops. Uncapped fixers are how you find out on Sunday that something ground against a wall for eleven hours |

Concurrency sized to one operator's review rate, not to available compute — see §8.

### 06 · Verify — *partial* (`verify.yml` exists but refuses nothing)

> **Fires on:** every push and PR. **Refuses:** the merge.

**Retires blocker 5** — the only unambiguous regression in the six-month record: 12 broken commits
reached `main` in five days, all genuine breakage, zero infra flake.

The gauntlet, in Actions, where the agents it judges cannot reach it:

| Gate | Status |
|---|---|
| Typecheck, lint, test | **live** — but advisory. `verify.yml` runs after the push has landed |
| Branch protection + required checks | **absent.** This is the whole fix, and it is an afternoon |
| Acceptance tests, immutable by the implementation | absent — lane 04 |
| Contract tests against the seam manifest's shapes | absent |
| Visual regression, design-system lint, seeded database | absent, and dormant until a repo has a UI |

**Every defect that escapes to the owner adds a gate.** The gauntlet grows for the life of the
project or it decays relative to the codebase. That growth is *not* grooming under C4 — a gate is
added at the moment a defect proves it missing, by the event that proved it, never on a review
cycle.

### 07 · Review — *absent*

> **Fires on:** CI green. **Refuses:** nothing — this lane produces findings, not verdicts.

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

**Retires blocker 1, structurally.** Era 6's gate is a PreToolUse hook, so a commit-keyword close
(`Closes #704`) never reaches it and a crashing rail fails open unseen. Moving the gate to the
tracker closes that by construction: `issues.closed` fires no matter *how* the issue was closed, and
an Action that errors is a red run, not a silent pass. A gate that cannot be routed around is the
precondition for stepping back at all.

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
| Sub-issues published | Acceptance author, one per slice |
| Acceptance tests merged | Slice gets `ready`; waits for a free slot |
| A slot opens (a ticket closed, or the queue drained) | Implementer dispatched into an isolated checkout |
| CI red | Fixer, 3 attempts, then `blocked` and silence |
| CI green | Review fleet fans out; every finding gets 3 refuters |
| PR approved | Enters the single merge queue |
| Merged to trunk | Drift lens on the touched modules; coupling counter incremented |
| Issue closed | The close gate runs — and cannot be bypassed |
| An ADR or decision comment is recorded | Consistency lens reads it against the whole log |
| A session ends | Transcript captured, then read (blocker 4) |
| Nth landing in a module since its last read | Coupling lens |
| Owner comments on a queued decision | The lane waiting on that answer resumes, within the minute |
| **The brief window opens, and the queue is non-empty** | The brief publishes and pushes once. Empty queue → silence |

That last row is the only time-shaped thing in the system, and it originates nothing — see §8 and
ADR-0004.

## 6 · The standing lenses

Five things get read while nobody is watching, and **only one of them is code.** Each is attached to
the event that makes it non-vacuous, which is what distinguishes a lens from the cadence ADR-0029
rejected.

| Lens | Model | Fires on | Reads for |
|---|---|---|---|
| **Diff** | Opus | CI green | Defects and spec conformance — lane 07. Catches almost nothing else |
| **Transcript** | Opus | Session end, batched | The moment an agent **guessed at intent and moved on** — hedge language before a consequential choice, a requirement restated in weaker terms, an assumption stated once and never revisited. Correct-looking code with a wrong premise leaves fingerprints in the transcript that are invisible in the diff |
| **Decision log** | Opus | An ADR or ruling recorded | Contradiction: *"you ruled in March that X, this week you ruled Y — one of these is stale."* It never pre-answers on the owner's behalf |
| **Spec** | Haiku | A merge touching a module | Drift. A lying spec is worse than no spec, because every agent downstream believes it forever |
| **Coupling** | Opus, high effort | N landings in a module since its last read | Duplicated concepts, three implementations of one idea, a module that has quietly grown a second responsibility. Output is a small number of ranked refactor issues |

The transcript lens is probably the highest-yield item on this page and it is **blocked on blocker
4**: capture died 2026-05-21, and `cleanupPeriodDays: 30` means every day without a recorder
permanently destroys a day of corpus. It matters *more* under autonomy — when nobody is watching,
the transcript is the only record of what went wrong.

**Every lens produces issues, never notifications.** The brief is the only thing that reaches the
owner.

**Every lens is asked whether it ever fired**, at the event that would add another lens of its
kind — the generalisation of [ADR-0003](docs/adr/0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md).
**Retires blocker 3:** 36 lint rules and 30 ADRs exist and not one has been asked whether it caught
anything, because nothing in the estate points backwards.

**Cut:** the Foundry's cold-user walkthrough and persona panel. Both need a deployed product with
users; nothing in the estate has one today. They come back the day a repo does — as a lens on
preview deploy, not as a nightly cron.

## 7 · Taste

Taste cannot be delegated, but the **expensive part** of it can. Originating an opinion from a blank
screen is slow; reacting to something concrete is instant. Every mechanism here converts the first
into the second. This is where `GOAL.md`'s "visual and spatial verdicts" boundary lives — #127's
cleanest finding was that the best-performing month was the one where the human held the eval loop.

1. **Freeze the system, allow only composition.** Direction picked once, on a canvas, then frozen
   into tokens and a component library. After that, agents compose only from what exists — a new
   colour, spacing value or font size is a `design/request` issue, and the design-system lint in the
   gauntlet is what makes the freeze real rather than aspirational.
2. **Variants for anything novel.** Three real versions, all deployed, owner points. The highest-
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

**The brief** is the only thing permitted to reach the owner. It reads everything that happened,
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

Ordered by `GOAL.md` §4, because nothing further down is optional for anything above it.

| # | Move | Retires | Cost |
|---|---|---|---|
| 1 | **Branch protection + required checks** on this repo and Lumaria | Blocker 5 | An afternoon |
| 2 | **Close gate as an Action** on `issues.closed` (lane 09) | Blocker 1 | Days. The logic exists; the venue changes |
| 3 | **Session capture**, at session time, stored durably | Blocker 4 | Days — and every day it waits destroys a day of corpus permanently |
| 4a | **Intake** (lane 00) — two issue forms and the `idea` label | The desk keystroke | An afternoon |
| 4b | **Shape** (lane 01) — sweep, shaper, refuter, and the sheet | The blank-screen approve | Days |
| 5 | **Acceptance lane** (04) + the immutability rule in CI | The premise itself | Weeks. The unglamorous one, and skipping it is the reliable way to fail |
| 6 | **Spec on a runner** (lane 02) | Blocker 2 | Weeks |
| 7 | **Build + integrate** (lanes 05, 08) — implementer, fixer, warden | Blocker 2 | Weeks |
| 8 | **Lenses + the backwards question** (§6) | Blocker 3 | Ongoing, event-attached |
| 9 | **Governor + brief** (§8) | C7 | Last. It has nothing to govern until 5–7 land |

**The bootstrap has an expiry.** Until move 7 lands, work on this repo is driven by era-6 `/drain`
from the workstation, which ADR-0002 forbids. That is a scaffold, and it expires the moment lane 05
runs on a runner. Until then: **this repo does not grow files to serve era-6 skills.**
[#34](https://github.com/collod873/claude-workflow/issues/34)'s second fix — adding
`.claude/contract.json` and `docs/agents/issue-tracker.md` here so `/drain` can read them — is
declined on that basis.

**Honest accounting.** Moves 1–4 are weeks where the owner is *more* in the loop, not less, and it
will not feel like leverage. The out-of-the-loop dividend comes entirely from the boring eighty
percent; the parts he cares most about stay his forever. And the ceiling: this system is bounded by
spec quality, not by agent capability — true today, still true when the models are twice as good,
which is the best argument for spending the hour at the top of the pipeline rather than the bottom.

## 11 · Open questions

Each needs a decision before the lane it blocks can be built. None is a question the owner cannot
answer.

1. **Where does the seam picker live** — lane 02, so the interface contract exists before slicing
   (the Foundry), or lane 03 where it is built today? No constraint decides it; a measurement might.
2. **What is the daily spend ceiling** (§8)? A plan-tier question before it is an engineering one,
   and the governor cannot be built without a real number. ~$1,661 API-equivalent over 28 days is
   the only figure on record.
3. **Which repos are in scope?** The lanes assume Lumaria + this repo, but the estate is **20+
   repos**, not four — PWPP-Projects and 3D-Printing are not the only others. Intake is scoped to
   this repo alone until there is evidence about where ideas actually arrive. Do the rest get the
   full pipeline, only the gauntlet, or nothing?
4. **Does the acceptance lane apply to non-code work?** Lumaria is code. A 3D-printing or electrical
   ticket has no `tests/acceptance/` to make immutable, and lane 04 is the load-bearing gate.
5. **Is there a tenth lane for the machinery's own defects?** agent-skills
   [#134](https://github.com/collod873/agent-skills/issues/134) asks the same thing and is still
   open: where does a run file a defect it finds in the run itself, without sweeping its own landing?
   The candidate rule, unruled: **the machine may file defects against itself but never features** —
   a defect has a failure that already happened, a feature is an opinion about what would be better,
   and opinions are where August's 82% machinery share came from.
6. **Do agent-authored observations get a document type of their own?** [ADR-0005](docs/adr/0005-accepting-a-shaped-idea-is-what-files-its-adrs.md)
   covers rulings made at shaping time. It does not cover what an implementer *learns* mid-run. The
   proposed bar is **write-on-surprise** — at the end of every run, one question: *what did you learn
   that, had you known it at the start, would have changed what you did?* Nothing means nothing gets
   written. Where that lands (`docs/findings/`, the module's `CONTEXT.md`, an ADR) is unruled.
7. **Does an unread document get deleted automatically?** The generalisation of
   [ADR-0003](docs/adr/0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md) to
   prose: ask a finding whether it was ever loaded into a context where it changed an outcome, at
   the event that would add another of its kind, and delete it if never. This is the only version of
   pruning that survives C4, and it is only safe if it can never touch something the owner wrote —
   which depends on question 6.
