# The goal

**Compiled:** 2026-08-21 · **Trimmed:** 2026-09-01 · **Status:** the charter. Everything else in
this repo is evidence for it or work toward it.

Point-in-time measurements are not carried here — a number true in August reads as current state a
month later. A blocker states what is open and what closes it; the count that sized it stays in the
ADR or research note that measured it. §3 was removed and its number is not reused
([ADR-0025](docs/adr/0025-design-md-carries-no-lane-status-a-shipped-lane-collapses-to.md)).

The tracker and the code say what the machine *is* — every edge, its event, its refusal. This says
what it is all *for*. When a proposal arrives — a skill, a hook, a connector, an eighth era — it gets scored
against §2. A proposal that fails a constraint is not a smaller version of the goal; it is a
different goal.

---

## 1. The end state

> **Describe work once and have it ship — correctly, without starting it, watching it, or being
> asked questions the owner can't answer — and the machine that does it costs almost nothing to
> keep alive.** Not *work happens while I sleep*: **nothing waits on the owner to fire it, and he
> never has to check its homework.**

The AFK premise was bought once and returned. Across the era boundary in Lumaria — the one repo
where both models ran on the same codebase — both eras land ~85% of commits inside waking hours.
What changed was *where the human sits*, not what hour the work runs, which is why the end state is
worded around who fires it.

Sourced from what Collin has said repeatedly, not from what a system was designed to do:

| Said | When |
|---|---|
| *"i want it to just run without human whats the problem? Does it need a real human decision on anyhting??"* | 2026-08-21 |
| *"the end goal is for me to ship new code and new work extremely fast, but we want to catch gaps and standards problems"* | 2026-08-21 |
| *"Do I even need to be in the loop at all or after it bounces through enough unbiased agents and checks things can just self resolve?"* | 2026-08-21 |
| *"I am trying to weigh heavier automation and less of me than anything else"* | 2026-08-21 |
| *"the dreamboat automated machinery that just covers everything"* | 2026-08-21 |
| *"In dreamland, gh 125 type stuff sounds the best to me"* | 2026-08-21 |
| *"I dont even want manual solver tbh just unattended"* | 2026-07-28 |

The 08-21 lines are one session in `agent-skills` that produced issues
[#123](https://github.com/collod873/agent-skills/issues/123)–[#135](https://github.com/collod873/agent-skills/issues/135).
Local transcripts only begin 2026-07-22 (the WSL cut), so nothing conversational survives from
eras 1–5 — the earlier evidence is the design docs and the git record instead.

---

## 2. The seven constraints

Each one recurs across multiple eras with different technology each time, which is what makes them
properties of the operator and the work rather than of any one system. Each is testable: a design
either satisfies it or it doesn't.

**A proposal answers all seven tests in writing. An unanswered test is a failed one.**

**C1 · Ship speed beats correctness ceremony.**
No era was ever replaced for producing bad output. Every one was replaced when per-unit overhead
stopped being worth it — era 4 spent ~7 plan steps on ~3 edits in 1 file. *(Eras artifact, F1.)*
**Test:** model stages and owner minutes added to the smallest unit of real work, stated as numbers.

**C2 · Machine judgement with a reviewable checkpoint, never a human quiz.**
*"/to-tickets stops and asks me questions at the end and I dont even really know the answers anyway
I cant determine what looks right im not a senior dev."* Cockpit designed a sizing quiz in April
for this exact reason; commit `68b071f` deleted it in August because the questions "were senior-dev
calls a human maintainer can't actually answer better than the breakdown's own author." Replaced by
an audit agent. *(F7.)*
**Test:** which questions does this put to the owner, and could he answer each better than the thing
that asked?

**C3 · Event-driven, never a clock.**
*"i dont want a time based cadence, that doesnt make sense because i might ship a lot of work at
once then be away for a week."* ADR-0029 independently rejected periodic triggers — *"still work the
maintainer did not ask for, only less often"* — and rejected per-landing too. The candidate trigger
on record: a shape appearing at a **second site**.
**Test:** what real event fires this, and is it silent when there's nothing to say?

**C4 · Zero grooming.**
The adoption law from Collin's own postmortems: *passive, event-driven things that come to him
survive every purge; anything requiring an active ritual, a new home base, or a grooming obligation
dies by ~month 3 regardless of quality.* Reinforced by F2 — the system becomes its own biggest
customer: 1,365 of Sandcastle's 2,120 orchestration runs were no-ops; era 6's machinery share of
file touches went 63% (July) → **82%** (August).
**Test:** does this need maintenance to stay true? Then it doesn't get built.

**C5 · Complete coverage — nothing falls through silently.**
*"This repo owns the skills so when it makes changes like that which should effect our other repos
how do we catch that without fail?"* The dreamboat framing is about coverage, not about any single
trigger: *"its not this or that, its heres things that its possible to find and how do we design the
dreamboat."*
**Test:** which evidence class does this see, and what still has no mechanism looking at it?
(`agent-skills/docs/research/finding-what-goes-wrong.md` is the taxonomy — ten classes, four
uncovered.)

**C6 · Short, disposable sessions.**
*"I like to get through claude sessions fast on my computer and not have the same session sitting a
long time and context rotting."*
**Test:** does this lengthen a session or end one?

**C7 · The owner stays the decider, batched.**
Not "no human" — *bounded* human. The Foundry's durable contribution is the interface, not the
fleet: one push, decisions grouped by topic, a hard cap around 7 in the queue, anything queued past
~5 days re-read and withdrawn rather than repeated, and a governor that stops dispatch when the
queue is full. *(Issue [#125](https://github.com/collod873/agent-skills/issues/125).)*
**Test:** how many times a day does this interrupt?

> **The constraint stands; the Foundry's mechanism for it does not** — the queue cap, the five-day
> expiry and the governor were struck on measurement
> ([ADR-0039](docs/adr/0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)), and
> the batched digest with them
> ([ADR-0131](docs/adr/0131-the-owner-s-batched-digest-does-not-ship-the-tracker-is-what.md)). The
> tracker is what reaches the owner.

### The owner points

Named as a boundary, not a gap. Automating these makes the result measurably worse:

- **Visual and spatial verdicts.** #127's cleanest finding — Video-Generation was the best-performing
  month *because* the human held the eval loop; pc-build was the worst because the agent both
  produced and judged.
- **Destination and scope**, including the wayfinder ticket budget. The record backs this one hard:
  ADR-0002 is a destination call where Collin overrode the recommendation outright — *"I DONT WANT
  IT ON MY COMPUTER"* — and that override became the ruling.
- **The shape of the machine** — which mechanisms exist, where agents sit, where a check goes. The
  measured asymmetry: agents kept the governor alive for five days and it died to one owner
  question; across the same window twenty owner touches were rubber-stamps and five were
  engagements, and **all five killed a mechanism.** Agents are reliable at building the thing and
  unreliable at asking whether it should exist, because the thing under review is their own work —
  which is W2 pointed at the design rather than at the code.
  [ADR-0047](docs/adr/0047-the-shape-of-the-machine-is-an-owner-point-agents-do-not-jud.md).

**Struck: vocabulary.** Never a boundary — the record never once exercised it. W5 states what
replaced it, [ADR-0006](docs/adr/0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md)
rules it.

---

## 4. What actually blocks it today

Ordered. Nothing further up the list is optional for anything below it.

1. **Two fail-open holes — one retired, one open.** A fail-open gate in an unattended system is not
   a gate, which is why this is the precondition for stepping back at all.
   - ~~**Commit-keyword closes never reach the PreToolUse gate.**~~ Retired by `b5fd535`, which
     moved the gate to an Action on `issues.closed`. ADR-0013, ADR-0014, ADR-0021. **This repo
     only** — the era-6 estate still runs the hook and still has the hole.
   - **Open.** The shared `mirror.mjs` rails crash and fail open, unseen. That file lives in
     Lumaria and is untouched, so nothing here closes it.
2. **Nothing in the system can start work.** All ten pipeline verbs are
   `disable-model-invocation: true`, so every dispatch is a human firing it. This — not model
   capability, and not verification volume — is the ceiling.
   *(Issue [#128](https://github.com/collod873/agent-skills/issues/128).)*

   **What the close gate actually measures.** It is an active *compliance* mechanism and is not
   theatre; `unmet-criterion` is the rarest refusal it writes by an order of magnitude. It is not a
   *correctness* gate, and nothing should be built on a claim that it is.
3. **No mechanism points backwards.** Every ADR, every lint rule, every `CODING_STANDARDS.md` entry
   — and **not one has been asked whether it caught anything.** That file has exactly one exit —
   *mechanised* — which requires building another rule first, so it can only grow.

   *Half of this is retired.* Specs [#36](https://github.com/collod873/claude-workflow/issues/36)
   and [#63](https://github.com/collod873/claude-workflow/issues/63) built and wired the VIOLATION
   and PROPOSED lenses — `.Workflow/agent-workflows/observations/` carries them.

   **The open half, now decided and half built.** The question is ruled — ADR-0044 through ADR-0046
   — and a ruling retires nothing, so this blocker closes on **two builds**, not on the decision. One
   has landed:
   - ~~**The back-stamp**, which points the question at the ADRs.~~ Retired 2026-08-26 by
     `.Workflow/agent-workflows/watchdog/back-stamp.ts` and `back-stamp-walk.ts`, wired by
     `.github/workflows/back-stamp.yml`: a push to `main` touching `docs/adr/` recomputes the whole
     supersession graph from the `Amends:` trailers successors carry and commits
     a `Status: superseded by ADR-NNNN` line onto every predecessor missing one. There was nothing
     to delete — every ADR is cited, and the only signal that discriminates finds the *superseded*
     ones, which must survive because the amendment chain is the record — so the act is a pointer
     onto the stale record, not a deletion. The trailer it reads is itself now watched: a supersession asserted in
     prose without one is the **missing-trailer counter**'s finding, and
     `bin/new-adr --amends NNNN` writes it. ADR-0044 through ADR-0046, ADR-0067.
   - **ADR-0003's lint audit**, which points it at the rules and is **ruled but unbuilt** —
     `/standards-pass` does not implement it, and `/ratify`'s "zero hits against the repo as it
     stands" is a static tree scan rather than a question about history.

     *Narrowed at the other end, 2026-08-31.* [ADR-0124](docs/adr/0124-a-lint-rule-is-ratified-only-by-reproducing-its-own-evidence.md)
     makes a rule prove it catches something **at birth**: the ratifier lane
     (`.Workflow/agent-workflows/ratify/`) runs every authored rule against the tree as it stood
     before that finding's fixes, and a rule that cannot flag the two sites that warranted it is
     demoted to a prose entry. So a landed rule now starts with evidence it caught something, and
     what ADR-0003's audit still owes is the question about *history* — whether it kept catching
     things. That half is unbuilt.

     *And `CODING_STANDARDS.md` gained its second exit.* The file "can only grow" was true while
     the sole exit was *mechanised*. [ADR-0123](docs/adr/0123-the-owner-signs-by-not-reverting-and-a-revert-writes-decline.md)
     adds *reverted*: the owner deletes an entry or switches a rule off, and a push-triggered
     detector (`.github/workflows/decline-on-revert.yml`) reads that as a decision and writes the
     declined memory that keeps the finding from coming back.
4. ~~**No session-time capture.**~~ Retired 2026-08-25 by spec #36 slices 1–2. ADR-0018, ADR-0020.
5. **The pre-merge gate — mostly retired, and the rest is accepted.** Retired by the gauntlet and its
   four venues; `bin/gauntlet` and [ADR-0010](docs/adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)
   carry the contract, and
   [`docs/research/actions-billing-2026-08.md`](docs/research/actions-billing-2026-08.md) carries the
   regression that justified it.

   *The open half, and it stays open:* the free venues below Actions refuse only at push, and
   `--no-verify` still gets past that. Closing it needed branch protection — a $4/month purchase on
   a private Free account — and that purchase is declined
   ([ADR-0071](docs/adr/0071-branch-protection-is-declined-so-move-10-retires-and-its-cou.md)).
   So this half is not "bought" but **accepted**: the bypass counter measures how often it costs
   something and no longer proposes anything about it.

---

## 5. Assets to build from

Six mechanisms were kept, ported, or independently re-derived across era boundaries. Anything built
next starts from these rather than rediscovering them. Full treatment in
[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0) §05.

**Test:** which of W1–W6 does this re-derive, and why is the new version better than the one on
record?

| | |
|---|---|
| **W1** | A gate that errors at the moment of the action. *Docs require a reader; a gate requires nothing but a trigger.* Era 2's `checklist-reminder.py` is still live |
| **W2** | The thing that checks is never the thing that built |
| **W3** | Prevent conflicts at authoring time, not at merge time (physical disjointness) |
| **W4** | Decisions live next to the code they govern — endpoint: documentation a test suite can fail on |
| **W5** | Agents draft, the owner signs — restated 2026-08-23 from *agents own code, the human owns vocabulary*, which 34 ADRs of record never once exercised. [ADR-0006](docs/adr/0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md) |
| **W6** | Write the autopsy while it still stings |

---

## Sources

Everything above is traceable. Deepest reads, in order:

- [Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0) —
  the seven recurring failures (F1–F7) and six durable wins (W1–W6)
- `agent-skills` issues [#128](https://github.com/collod873/agent-skills/issues/128) (the connector
  argument) and [#125](https://github.com/collod873/agent-skills/issues/125) (the fleet-architecture
  question, and the Foundry draft)
- `General-Repo/agentic-os-design.md` — the six frictions and eight operating principles, 2026-07-06
- `General-Repo/handoff-agentic-os-controlplane-2026-07-07-premise-locked.md` — the adoption law and
  the five locked decisions
- `General-Repo/lumaria-shipping-model-vs-sandcastle-2026-08-21.md` — the A/B behind §1's
  waking-hours finding
- Local session transcripts, 2026-07-22 onward — the direct quotes in §1 and §2
