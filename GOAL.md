# The goal

**Compiled:** 2026-08-21 · **Status:** the charter. Everything else in this repo is evidence for it
or work toward it.

`INDEX.md` says where everything is. `DESIGN.md` says what the machine *is* — every edge, its
event, its refusal. This says what it is all *for*. When a proposal arrives — a skill, a hook, a
connector, an eighth era — it gets scored against §2. A proposal that fails a constraint is not a
smaller version of the goal; it is a different goal.

---

## 1. The end state

> **Describe work once and have it ship — correctly, without starting it, watching it, or being
> asked questions the owner can't answer — and the machine that does it costs almost nothing to
> keep alive.**

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

**C1 · Ship speed beats correctness ceremony.**
No era was ever replaced for producing bad output. Every one was replaced when per-unit overhead
stopped being worth it — era 4 spent ~7 plan steps on ~3 edits in 1 file. *(Eras artifact, F1.)*
**Test:** what does this add to the smallest unit of real work?

**C2 · Never ask a question the owner can't answer.**
*"/to-tickets stops and asks me questions at the end and I dont even really know the answers anyway
I cant determine what looks right im not a senior dev."* Cockpit designed a sizing quiz in April
for this exact reason; commit `68b071f` deleted it in August because the questions "were senior-dev
calls a human maintainer can't actually answer better than the breakdown's own author." Replaced by
an audit agent. *(F7.)*
**Test:** machine judgement with a reviewable checkpoint — never a human quiz.

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

### Where the human deliberately stays

Named as a boundary, not a gap. Automating these makes the result measurably worse:

- **Visual and spatial verdicts.** #127's cleanest finding — Video-Generation was the best-performing
  month *because* the human held the eval loop; pc-build was the worst because the agent both
  produced and judged.
- **Destination and scope**, including the wayfinder ticket budget. The record backs this one hard:
  ADR-0002 is a destination call where Collin overrode the recommendation outright — *"I DONT WANT
  IT ON MY COMPUTER"* — and that override became the ruling.

**Struck: vocabulary.** Era 5's ADR-0026 and era 6's `seeded-doc-router.py` were read as *agents own
code, the human owns `CONTEXT.md` / `CODING_STANDARDS` / skills / `CLAUDE.md`*. The record does not
support it. Across 34 ADRs and two glossaries in the surviving transcript window, Collin originated
3; there is **no instance of a proposed ADR or glossary term being rejected or rewritten**, and two
agent-flagged invitations to reverse went unanswered and still stand as written. W5 is restated
below. See [ADR-0006](docs/adr/0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md).

---

## 3. The tension worth keeping in view

**The AFK premise was already bought once and returned.** Sandcastle existed so Collin could label
something and walk away. Measured across the era boundary in Lumaria — the one repo where both
models ran on the same codebase — **both eras land ~85% of commits inside waking hours**, and the
current model still commits at 02:37 via background drain workers. What actually changed was *where
the human sits*: outside the loop applying labels, versus inside the session at 6.4 prompts per
session. The pipeline's founding justification was never really tested by the pipeline.

So the goal is not *"work happens while I sleep."* It is **"nothing waits on me to fire it, and I
never have to check its homework."**

---

## 4. What actually blocks it today

Ordered. Nothing further up the list is optional for anything below it.

1. **Two fail-open holes — one retired, one open.** *(Split 2026-08-25; it read as wholly open
   until then.)* A fail-open gate in an unattended system is not a gate, which is why this is the
   precondition for stepping back at all.
   - ~~**Commit-keyword closes (`Closes #704`) never reach the PreToolUse gate.**~~ **Retired
     structurally, not patched, by `b5fd535`.** The close gate is now an Action on
     `issues.closed` (`.github/workflows/close-gate.yml`), and that event fires no matter *how* an
     issue was closed — keyword, phone, web UI. An Action that errors is a red run rather than a
     silent pass, so the crash half cannot recur at this venue either. ADR-0013, ADR-0014;
     ADR-0021 stands the workstation hook down for this repo. **This repo only** — the era-6
     estate still runs the PreToolUse hook and still has the hole.
   - **Open.** **83 rows in each of two logs** are rails crashing (`SELECT_ITEMS is not defined`,
     `HEX_COLOR_WHOLE is not defined`, `Cannot read properties of undefined (reading 'rules')`),
     all from the one shared `mirror.mjs`, failing open and unseen. That file lives in Lumaria and
     is untouched. *(Re-measured 2026-08-23; the figure here was ~7 until then.)*
2. **Nothing in the system can start work.** All ten pipeline verbs are
   `disable-model-invocation: true`; ~34 dispatches a day, almost none of it judgement a human
   holds. This — not model capability, and not verification volume — is the ceiling.
   *(Issue [#128](https://github.com/collod873/agent-skills/issues/128).)*

   **What the close gate actually measures, corrected 2026-08-23.** This line used to read
   "verification quality measured fine at ~8% UNMET closes." That number does not reproduce.
   `close-gate.log` is 558 rows: **125 refusals, 22.4%** — triple the figure once on record, which
   [#128](https://github.com/collod873/agent-skills/issues/128) had graded *Counted, trust this*.
   But the composition is the finding: `no-closing-record` 78, `bad-evidence-shape` 15,
   `no-range-or-no-diff` 9, `missing-acceptance-criteria` 8, `criteria-count-mismatch` 3 — and
   **`unmet-criterion` exactly once in 558.** The gate is an active *compliance* mechanism and is
   not theatre. It is not a *correctness* one, and nothing should be built on a claim that it is.
3. **No mechanism points backwards.** 30 ADRs in a month, 9 amending an earlier one; 36 lint rules
   from 5 standards passes, and **not one has been asked whether it caught anything.**
   `CODING_STANDARDS.md` has exactly one exit — *mechanised* — which requires building another rule
   first, so the doc can only grow.

   **What is actually missing, corrected 2026-08-25.** Not the mechanism. Spec #36 slices 3–4
   landed the VIOLATION and PROPOSED lenses, the auditor entrypoint, the SHA-range diff helper,
   the release-scope helper and the PR composer — all of it in `.Workflow/agent-workflows/`, all
   of it tested. What is missing is the **connector**: nothing fires the auditor, so it is library
   code with no caller. That is specced as
   [#63](https://github.com/collod873/claude-workflow/issues/63), and unbuilt. A reader acting on
   the old wording would build the thing that is already built.

   *The connector is also wider than "nothing fires it," and #63 carries the reason:* the corpus is
   written but never pushed, so a runner cannot see its input and the auditor is **ineligible** for
   the only venue ADR-0002 allows — not merely un-triggered. Capture records no SHA range, only the
   PROPOSED lens is wired (ADR-0019 measured the unreachable one at 93% valuable), and nothing
   produces a release batch or writes the ratification records the memory reads back.
4. ~~**No session-time capture.**~~ **Retired 2026-08-25.** A `SessionEnd` hook is registered
   **globally** in `~/.claude/settings.json` — by absolute path, at this repo's
   `.claude/hooks/session-capture.sh` — so every session on this machine is recorded, not only
   sessions in this repo. Recording is not executing work, so ADR-0002 does not reach it. Landed
   as spec [#36](https://github.com/collod873/claude-workflow/issues/36) slices 1–2;
   `~/.claude/session-capture.log` recorded ten captures on the day it landed and
   `Knowledge-Base/raw/sessions/` has grown past its frozen 841. The `cleanupPeriodDays: 30` clock
   this blocker was about has stopped running.

   *Why it was a blocker:* the conversation spine is ~1.3% of a transcript (~18KB, flat) —
   ~500KB/day. Every day without a recorder permanently destroyed a day of corpus, and any
   pass-time audit run six weeks later reported a clean sweep on evidence that no longer existed.
   It matters *more* under autonomy: when nobody is watching, the transcript is the only record of
   what went wrong. Backfill recovered **11 sessions** — all the prune had left of the gap.
5. **The pre-merge gate is gone.** The only unambiguous regression in the whole six-month record —
   12 broken commits reached `main` in five days, all genuine `unit`/`build` breakage, zero infra
   flake.

---

## 5. Assets to build from

Six mechanisms were kept, ported, or independently re-derived across era boundaries. Anything built
next starts from these rather than rediscovering them. Full treatment in
[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0) §05.

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
  the seven recurring failures (F1–F7) and six durable wins (W1–W6). Source:
  [`artifacts/seven-workflow-eras.html`](artifacts/seven-workflow-eras.html)
- `agent-skills` issues [#128](https://github.com/collod873/agent-skills/issues/128) (the connector
  argument) and [#125](https://github.com/collod873/agent-skills/issues/125) (the fleet-architecture
  question, and the Foundry draft)
- `General-Repo/agentic-os-design.md` — the six frictions and eight operating principles, 2026-07-06
- `General-Repo/handoff-agentic-os-controlplane-2026-07-07-premise-locked.md` — the adoption law and
  the five locked decisions
- `General-Repo/lumaria-shipping-model-vs-sandcastle-2026-08-21.md` — the A/B behind §3
- Local session transcripts, 2026-07-22 onward — the direct quotes in §1 and §2
- [`INDEX.md`](INDEX.md) — where all of the above lives
