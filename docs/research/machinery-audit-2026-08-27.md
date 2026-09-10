# Machinery audit, 2026-08-27

Unprompted: no issue preceded this note

Three read-only audits of the pipeline's judgment mechanisms, run the same way the checker was
audited earlier today (#160): measure per-use cost and payoff from the last 30 days of transcripts
and hook logs, read the code and ADRs, then a separate skeptic argues from `~/.claude/VALUES.md`.
Nothing here was edited or filed by the audits themselves. Each section is the audit's own verdict,
verbatim.

## Corrections after review (same day)

Collin challenged B's step-2 verdict; re-measuring from the audit's own extracted runs found it
mis-measured, and spot-checks of A and C's load-bearing claims followed. Read the sections below
with these on top:

- **B, step 2 (seam sweep): verdict RETRACTED.** The claim "8 of 10 runs wrote the manifest after
  slicing or never" measured when the *formatted manifest text* appeared, not when the sweep's
  findings reached the foreman. In every run where the graph-JSON write is identifiable (8/10) the
  sweep finished 4–20 minutes **before** slicing began. Of ~3,555 identifiers the sweeps named, 480
  (13%) appear in the published ticket graphs: real propagation, low ratio. That is not a delete
  number; it says the payoff was never measured properly. The honest test is a parallel trial: run
  `/to-tickets` on one spec with and without step 2 and diff the graphs. Step 5's verdict (keep the
  judgment, move disjointness / path-resolution / outward-edge checks into `publish-issue-graph`)
  was not challenged and its numbers were not re-measured.
- **C, item 11 (eslint-mirrors "rewrite, don't patch"): ALREADY DONE.** The 122 `error` rows are
  real hook crashes (ReferenceErrors inside the mirror), but Lumaria #792 landed 2026-08-26 15:16
  and the last crash is 2026-08-26 18:39; 0 crashes in the 332 runs since, and the log now carries a
  distinct `could-not-run` verdict. Keep watching `grep -c could-not-run`; nothing to build.
- **C, item 10 (Workflow contract `stop` slot vacuous): CONFIRMED.** `gauntlet-hook.mjs:64` exits
  0 silently with no hook payload on stdin; `contract.json` points `stop.cmd` at that shim
  (`.claude/hooks/gauntlet.sh stop`) instead of `bin/gauntlet stop`. Every bare run of the stop
  slot has checked nothing. One-line fix stands.
- **A, "your call / say go" (74 fires): roughly corroborated.** A narrower independent grep of
  assistant turns finds 57 in the same window across the same repos. Order of magnitude holds;
  the 20% agreement rate was not re-measured.
- Everything else in A, B, C is **unverified** beyond the audit's own report. Treat numbers there
  as the agent's claim, not established fact, until someone re-measures the one they're about to act on.

## Summary

| Audit | Finding | Recoverable |
|---|---|---|
| A, human checkpoints | Grilling is the work (44% of rounds change something); the waste is 74 ad-hoc "your call / say go" prompts (20% agreement) and 74 single-question grilling rounds | ~14 h/month of Collin's time |
| B, `/to-tickets` steps 2+5 | Seam sweep: delete (manifest written after slicing or never in 8/10 runs, no consumer). Audit: keep the judgment, move disjointness / path-resolution / outward-edge checks into `publish-issue-graph` as hard failures | ~4 min of a 19.9 min run |
| C, never-fired sweep | 9 deletions (two validate-bash guards at 37% / 69% false positive, 9 dead macOS wirings, 9 echo advisories, 2 Lumaria guards with 0 hits ever, 24 lint slugs). 3 outages disguised as green: Workflow `stop` slot vacuous (184/184), eslint-mirrors 122 crashes fail-open, log-stop-failure logs wrong fields | ~120 forced re-runs/month; 184 fake greens |

Cross-cutting: the one buried risk is the close-gate tracker stand-down; Workflow's closes are
judged by a YAML copy that had already drifted from the Python when the stand-down was written.

Companion findings from the same day: #160 (closing is a script, not a subagent), #174 (drain frees
a slot at green gate, 1.25 effective parallelism against a budget of 3).

---

# Audit A: Human checkpoints

2026-08-27 · 30 days · 493 sessions · 36,593 turns · 1,394 assistant→Collin exchanges

**Hypothesis: "most checkpoints are gates that catch nothing." Falsified for the pipeline's real
checkpoints. True for exactly one thing: the ad-hoc "your call" prompt, which isn't a skill at all.**

| Checkpoint | Fires | Agreement (bare yes) | Median wait | Verdict |
|---|---|---|---|---|
| `/grilling` rounds | 221 rounds / 701 q | **44%** (per-q 42.5%) | 166s | **Keep**: it changes something more often than not |
| Terminal 3 bullets (`/grilling`, `/to-spec`) | 46 | **67%** | 138s | **Convert**: keep bullets, drop the wait |
| `/tdd` seam confirm | ~8 (low conf) | **88%** (7/8) | 125s | **Remove**: asks him to judge what he says he can't |
| `/wayfinder` own stop-and-ask | **2** in 78 maps | 50% | ~130s | **Keep**: ~4 min/month, nothing to recover |
| `/triage` fuzzy / `## Question` | **0** | n/a | 0 | **Not a checkpoint**: CI label, no human waits |
| `/to-tickets` → `/drain` | 20 runs, 3 in-session | 70% in-session | 8s/22s/32s | **Keep mechanism, fix the prose** |
| "your call / say go" (ad-hoc) | **74** | **20%** | 172s | **Remove**: the whole finding |

Totals: 344 distinct fires (~11.5/day), 41% bare approval, 59% changed something.

## The reasoning

**Grilling is not overhead, it's the work.** 44% of rounds change something, and the per-question rate
(42.5%, n=186) matches, so it isn't one dissent poisoning a round. The changes are information only
he holds: *"I dont use knowledge base anymore. I dont read it."* · *"engineering and video generation
arent setup with current setup."* That is ADR-0027's own test (does the human hold what the record
doesn't) passing, not failing. There is no auto-take-the-rec version: converted, grilling becomes an
agent arguing with itself, and the invented decisions land in the map's Decisions-so-far and then the
PRD, where nothing downstream can tell them from elicited ones. Value 1's fresh-session test is what
breaks: a map of invented decisions resumes perfectly and is wrong. **The real defect: 74 of 221
rounds were single-question.** The skill says ask the whole frontier at once. A third of rounds
drip-feeding one decision is the un-batched pattern value 2 forbids; that's where grilling's
recoverable time actually is, and it's a composition fix, not a gate change.

**The three bullets are a receipt, not a gate, but the Cost bullet is where money shows up.** 67%
agreement, modal answer one word ("Go", "Confirmed"). By the time it fires, grilling just ended, so
every human-held fact was elicited minutes ago. But the 15 that changed are money and taste arriving
late: *"registering on the App Store would be cheaper than these card readers"* · *"Flip it."* Keep the
bullets, write them into the issue/PRD in the same breath, end the turn. Don't idle on "Go."

**`/tdd` seams: one catch in 30 days, and it's a contradiction.** `to-spec` says "Do NOT interview the
user" and then interviews him eleven lines later; ADR-0030 already moved the authoritative seam call to
`/to-tickets`. Three places, three rules, one decision (value 10). A seam is a codebase fact plus a
stated preference: value 2 forbids both asking what the code can answer and asking him to judge what
he isn't qualified to judge (*"I cant determine what looks right im not a senior dev"*).

**"Your call" is the one real problem.** 74 fires, 9.4 capped hours, lowest agreement (20%) and the
slowest median (172s), exactly what value line 151 predicts for options without a rec. The 80%
"changed" is not the gate catching errors, it's Collin repairing a malformed question. *"Your call on
Q1: delete, or keep user-invoked?"* is a repo fact. *"Your call only if you care: archive the
Knowledge-Base repo?"* announces its own irrelevance (value 16) and got answered with `/to-tickets`,
him routing past it. No skill file, no ADR, no provenance.

**The headline hours are inflated and I'm flagging my own audit for it.** 117 of the 146 raw hours are
18 gaps where he was asleep or working. Capped at 30 min/fire it's 35.3h, and 20.8h of that is grilling
= the work. Honest recoverable: **~14 h/month**, nearly all of it checkpoints 7 and 2.

**Free fix found along the way:** four stale `deferred, needs-human` spots contradict ADR-0027,
`CONTEXT.md:195` (the glossary every downstream skill reads, still teaching that a human inbox exists)
and `standards-pass/SKILL.md:37,159,167`, where line 37 is a functional bug that will hold pass issues
open that `/ratify` is entitled to close. Fix by deletion.

## What changes / cost / risk

- **Changes:** ban bare "your call"/"say go" in the skills repo: a question is well-formed only if
  it's business/money/taste/scope, carries a rec, and names what was checked to rule out an in-repo
  answer; else take the rec and report it as a flag. Drop the wait on the terminal bullets (keep the
  bullets, write them durably). Delete `/tdd`'s seam confirmation. Delete the 4 stale `deferred` lines.
- **Cost:** ~14 h/month of his time recovered, plus 46 + 74 fewer session stalls. Edits touch
  `to-spec`, `tdd`, `standards-pass`, `CONTEXT.md`, and 2 UPSTREAM.md contract rows.
- **Risk:** low. Seam errors were already designed to surface in `standards-pass`; a wrong bullet is a
  tracker edit away. The one live risk is the phrasing rule being read as "stop asking" and eroding
  grilling; the rule must name grilling as exempt.

## Where the skeptic changed the design

1. **Killed the audit's own premise on grilling.** I came in expecting to convert it; 44% + the
   self-argument failure mode says keep it untouched and fix round composition instead.
2. **Reframed checkpoint 7's low agreement.** I read 20% as "it catches things." The skeptic read the
   examples and showed the changes are Collin repairing bad questions, so the measured benefit is the cost.
3. **Rejected the read agent's "compensating flag" on `/tdd` seams.** The absorber already exists
   (`standards-pass`); adding a recorded-seam field nobody consumes dies to value 5 on arrival.
4. **De-double-counted `/wayfinder`.** 146 "fires" were 127 grilling rounds + 17 bullets already
   counted. Its own gate is n=2, ~4 min/month, so value 3 can't indict that.
5. **Struck `/triage` from the audit** (n=0, a CI label, never a human wait) and **defended
   `/to-tickets`**: 10 of 20 runs ending the session *is* him leaving to review on GitHub (value 4
   verbatim), not skipping. Only the sentence describing it is wrong.
6. **Split `config-audit` three ways** instead of keep/kill: secrets keep (irreversible, value 22),
   architectural keep (value 4's named carve-out), cross-project convert (value 24 already decides it).

**He'd push back on:** the 145.9h headline (value 16, inventing a problem; 117h of it is him asleep);
any suggestion that grilling time is overhead (value 14, since he named the mode); and the length of this
report. The two-sentence version: *74 "your call" prompts are the agent outsourcing thinking; fix the
phrasing rule upstream, and delete 4 stale `deferred` lines while you're in there. Everything else
earns its keep.*

---

# Audit B: `/to-tickets` steps 2 (seam sweep) and 5 (audit)

2026-08-27 · n=10 runs (both steps landed 2026-08-21; 21 `/to-tickets` runs in 30d, only 10 with these steps)

Median run: **19.9 min, $24.77**. Steps 2+5 = **8.6 min of 19.9 (43% of wall clock)**.

---

## Step 2, seam sweep: **DELETE the sweep, keep the prefactor rule**

**Cost.** 3.8 min wall, $11.51 = 43% of run cost, the largest line item. Scales linearly with fan-out: 1 agent $1.61 → 10 agents $31.45. Manifest text is injected into every ticket body and every worker window; one run shipped 61 lines, several 300+ chars (value 9's real constraint, spent by the thing claiming to protect it).

**Payoff.** Near zero.
- **8 of 10 runs wrote the manifest after slicing, after publish, or never.** The mechanism did not actually run in 80% of runs, and those runs shipped anyway.
- 5 of 10 runs produced **zero** prefactor tickets. 6 of the 12 that exist came from one run.
- Of the 27 terms the sweep *coined*: 12 (44%) cited by a worker, **8 (30%) never appear anywhere again**. The headline 62% citation rate is inflated by ordinary repo paths a worker touches regardless. Two coined seams clearly propagated (`BillableBasis`, `getCloseoutGate`), and both propagated because they became **tickets**, not manifest lines.
- **No mechanical consumer exists.** `docs/agents/ticket-format.md` has no seam section; `bin/ticket_shape.py` doesn't validate one; drain's "seam ledger" is built from scratch off worker return lines and never reads this. The two seam mechanisms are disconnected.

**Decision.** Delete the per-slice fan-out and the manifest (value 5: burden of proof is on keeping it; value 1: its terminal state is prose in a run report, not durable). Keep ADR-0030's prefactor-at-the-graph-root and lands-with-its-first-consumer rules; those are ordinary ticket mechanics and cost nothing per run. Let step 4 draft a prefactor when the drafting agent sees a shared helper, which is what already happened in the 5 runs that produced none and shipped fine.

**Explicitly not:** "run one sweep agent instead of ten." Value 5 names that anti-pattern ("let's make the checker cheaper"). Delete or keep.

---

## Step 5, audit: **KEEP the judgment half, move the mechanical half into `publish-issue-graph`**

**Cost.** 4.8 min, $2.21 = 9% of run cost. Cheapest thing in the skill.

**Payoff.** Real. 106 flags across 10 runs; **84 (79%) changed the published graph**, ~42 structurally (merge/split/re-edge). Two catches that would have cost serious wall clock: a systemic barrel collision across a 40-ticket graph, and two **outward** blocking edges that would have deadlocked `/drain` permanently.

**But its miss proves the split.** agent-skills #136: ticket bodies claimed paths that don't exist (`skills/drain/SKILL.md` vs real `drain/SKILL.md`), silently defeating the ADR-0007 disjointness guard. The audit checks claims for *disjointness* and never checks a claim *resolves*. Caught downstream by the drain foreman; fixed in `bin/ticket_shape.py`, not in step 5. The deterministic layer caught what the judgment gate missed (value 10).

**Also delete:** the "report every flag, applied or not" clause. **Zero of 10 runs did it**, and one run applied a re-edge **backwards** (added the blocker the audit said to remove) with no note. A bookkeeping requirement nothing enforces (values 5, 11, 25).

---

## The repo already has the right pattern, and both steps violate it

**ADR-0011 (closer dispatches the checker)** is this repo's answer to LLM-verifies-LLM: fresh context, handed a *minimal brief* so it fetches criteria itself ("a verifier told 'the worker says all five are met' is confirming, not verifying"), returns a **binary** verdict as a durable artifact, parsed by a deterministic hook. Step 5 is handed the computed list and asked to grade it, returns prose flags, posts nothing, nothing parses it: four of four properties inverted.

Both steps cite ADR-0168 "dispatched by stub" while `to-tickets/agents/` contains only `openai.yaml` (5 lines of display metadata). **There is no stub for either step.** One run then dispatched the audit async, violating ADR-0168, and burned ~8 min / ~$20 on 40 no-op polling turns.

---

## Build (all in `bin/publish-issue-graph`, which already imports `ticket_shape` and never calls it)

1. **Disjointness → hard `die()`.** It holds every body and edge in memory (line 111) and already walks transitively for the cycle check (line 98). For every ticket pair not connected in the transitive closure of `deps`, `claims_collide(a, b)` is fatal. Makes step 5's single best catch impossible to reach publish, permanently, free, forever.
2. **A claimed path must resolve.** #136 already forced the parsing into `ticket_shape.py`. Two lines.
3. **Outward edges die at publish.** Reject a `blockedBy` naming an issue number instead of a batch key. The audit caught this twice by luck.
4. **Step 5 shrinks** to granularity / merge-split / "does one slice set the batch's wall clock." Foreground, with a real stub file.
5. **`bin/clone-check` already exists**: the measured, post-hoc version of what the sweep guessed at prospectively. Run it after a batch lands if duplication is the worry.

**Not built:** the ">=2x median claimed-path count" outlier flag. Guessed threshold, no observed failure to derive it from: value 10, and Collin already rejected this shape by name ("Why are we putting a max on something like files claimed?").

## ADRs

- **Supersede ADR-0030's sweep half** (keep prefactor + lands-with-consumer). Its evidence was an anecdote with a count and an argument by analogy to a lint entry; the repo's bar is ADR-0013 (four issue pairs, timestamps, "18 tickets in ~5.5h"). Deleting it clears that bar with more evidence than created it.
- **Write the ADR commit `68b071f` never wrote.** ADR-0027 §3 authorized only "`/to-tickets` skips its quiz when headless." That commit deleted the quiz unconditionally *and installed a new subagent*, strictly larger. The audit gets its own ADR on the n=10 measurement, or reverts to 0027's text. Right now it's a live mechanism with no decision behind it.
- **New ADR: disjointness is enforced at publish, not audited.** Extends ADR-0007 from a rule the slicer is asked to honor to one the publisher enforces. This is the upstream fix for step 2's founding problem (value 7).

## Three bullets

- **Changes:** delete the seam sweep + manifest and the flag-reporting clause; move disjointness, path-resolution, and outward-edge checks into `publish-issue-graph` as hard failures; step 5 keeps only the four judgment calls, with a real stub.
- **Cost:** roughly 4 min off a 19.9 min median run (~20% of ship speed) and ~$11.50/run, for maybe a day of work on `publish-issue-graph` and three ADRs.
- **Risk:** the one real loss is prospective duplicate-detection. Mitigated by keeping the prefactor rule, by `bin/clone-check` post-hoc, and by the observation that 5 of 10 runs already produced zero prefactors and shipped fine.

## Where the skeptic changed the design

- Killed the cost headline. Value 9 says money is explicitly not a constraint and argues against "any argument from cost." The $137 would have gotten this rejected on the receipt; the case is **wall clock (value 3)** and **tokens into one agent (value 9)**.
- Vetoed the "≥2x median" deterministic outlier check the read agent proposed, a guessed threshold Collin has already rejected by name.
- Vetoed "make the sweep cheaper" as a tuning move value 5 forbids.
- Reframed step 5's keep: not "it's cheap," but "79% of flags changed the graph and two would have deadlocked `/drain`": same measurement as the sweep, opposite result.

---

# C: Never Fired

Audit date 2026-08-27. Window 2026-07-28 → 2026-08-27 (30d).
Corpus: 2,200 real session transcripts (36 `-tmp-bench-*` + 17 ablation dirs excluded), 11 hook logs, 20 repo settings, 5 contracts, 25 lint slugs.
Denominators: Bash 56,331 · Read 10,505 · Edit 7,864 · Write 2,058 · Stop 3,242.

## The table

> **Superseded as a method, kept as a record (#182, 2026-08-28).** Every cell below was
> rebuilt by hand from 2,200 session transcripts because no hook and no `bin/` tool wrote a
> per-fire row; that is also why every `Median` reads `n/i`. Since #182 each one writes a
> `verdict` row through `_hook.run_row()`, and `bin/hook-report [--days 30] [--repo <name>]`
> renders the same columns by division in about a second. **Re-run the command, don't redo
> the sweep.** This table stays as the 2026-07-28 → 08-27 window's evidence: the rows behind
> it are gone (30-day prune, `hooks/_hook.py`), which is exactly why a finding meant to
> outlive the window is copied into `docs/research/`, this file being the worked example of
> that rule. Its two deletion verdicts (`compound-close` 37.5% false positive, `wasteful-dir`
> 69%) are now countable per guard instead of re-derivable only by another sweep.

| Mechanism | Event | Repos | Fires 30d | Catches | False pos | Median |
|---|---|---|---|---|---|---|
| validate-bash `compound-close` | Pre/Bash | global | 56,331 | 224 | **84 (37.5%)** | n/i |
| validate-bash `wasteful-dir` | Pre/Bash | global | ” | 52 | **36 (69%)** | n/i |
| validate-bash `gh-issue-create` | Pre/Bash | global | ” | 29 | 0 | n/i |
| validate-bash `git-internals` | Pre/Bash | global | ” | 4 | 1 | n/i |
| validate-bash `.env` read | Pre/Bash | global | ” | **0** | n/a | n/i |
| close-gate tracker stand-down | Pre/Bash | 1 | **178** | n/a allow | 0 | n/i |
| close-gate quoted-prose | Pre/Bash | global | 17 | n/a allow | 0 | n/i |
| close-gate cross-repo | Pre/Bash | global | 18 | 4 deny + 6 degraded | 2 degraded | n/i |
| close-gate fail-open | Pre/Bash | global | 6 | 0 | 0 (all manual CLI) | n/i |
| credential-scan | Pre/Edit\|Write | global | 9,922 | 2 | **2, both own fixture** | n/i |
| vendored-router | Pre/Edit\|Write | global | 9,922 | 5 asks | 0 | n/i |
| seeded-doc-router | Pre/Edit\|Write | global | 9,922 | 1 ask | 0 | n/i |
| checklist-reminder | Post/Read | global | 10,505 | 75 | 0/5 | n/i |
| post-edit-validate | Post/Edit\|Write | global | 9,922 | 8 | 0, all real | n/i |
| circuit-breaker | Post+Fail+Start | global | every call | 4 warns | 0 | n/i |
| stop-fire-log | Stop | global | 3,242 | pure logger | n/a | n/i |
| stop-gate.py | Stop | **2 of 20** | 581 | **0 blocks**, 5 hand-backs | 0 | 0.09s |
| log-stop-failure | StopFailure | global | 3 | **3/3 logged wrong** | n/a | n/i |
| session_start_repo_state | SessionStart | global | 27 | n/a | 0 | n/i |
| auto-approve-permissions | PermissionRequest | global | 8,883 | 8,883 allow | 0 | n/i |
| **ui-token-validator** | n/a | **0, unwired** | **0** | 0 | n/a | n/a |
| Lumaria ui-guard | Pre | 1 | 1,907 | 1 real (+6 fixtures) | 0 | 0.02s |
| Lumaria stop-gate.sh | Stop | 1 | 935 (244 exposed) | 1 real | 0 | 0.06s |
| **design-override-flag** | Stop | 1 | 927 | **0 ever** | n/a | 0.02s |
| **status-badge-guard** | Post | 1 | 1,324 | **0** | n/a | n/i |
| jscpd-guard | Post | 1 | 1,327 | 12 | 0 | n/i |
| decoration-rail | Post | 1 | 1,324 | 4 | 0 | n/i |
| **eslint-mirrors** | Post | 1 | 1,324 | **122 CRASHES, fail-open** | n/a | n/i |
| design-context-loader | UserPrompt | 2 | 527 | 75 injections | injector, not gate | n/i |
| decision-capture | SessionEnd | 1 | 328 | 64 appends | n/a | n/i |
| session-capture | SessionEnd | global→Workflow | 1,051 | 753 captured | n/a | n/i |
| **Workflow contract `stop`** | Stop | 1 | 184 | **0 red, vacuous** | all 184 | 0.02s |
| agents-skills contract `stop` | Stop | 1 | 241 (244 exposed) | **0 red** | n/a | 0.16s |
| **9 dead repo wirings** | various | 3 | **0, macOS paths** | 0 | n/a | n/a |
| **9 inline `echo` advisories** | Post | 9 | unmeasured | **0 by construction** | n/a | n/a |
| **bin/lint, 11 slugs** | stop+lint | 1 | 241 runs | **0 ever** | n/a | n/a |
| bin/lint, other 14 slugs | stop+lint | 1 | 241 runs | **only own ratification commit** | n/a | n/a |
| Uninstrumented (gauntlet turn, roster-cache, 3 crewops, 3 app-starter) | various | 5 | **unknowable** | n/a | n/a | n/a |

## Verdict

**DELETE (9)**
1. validate-bash `compound-close`: 84 spurious blocks, and it contradicts close-gate's own `effective_cwd()`. Two copies of one rule, disagreeing (v10).
2. validate-bash `wasteful-dir`: 69% spurious; blocked `./node_modules/.bin/vitest`. Scoping it is the tuning v5 forbids.
3. 9 dead repo wirings (Design 5, wolfpack 3, Cockpit 1): stale `/Users/collinlodato/` paths, silently dead since the WSL move, nobody noticed (v5).
4. 9 inline `echo` advisories: "automatically or not at all" (v25).
5. `design-override-flag`: 927 fires, marker never once appeared (v5).
6. `status-badge-guard`: 1,324 invocations, 0 hits (v5).
7. `ui-token-validator.py`: unwired dead code. The real bug is crewops' `.sh` fork; fix it there (v7).
8. bin/lint's 11 zero-fire slugs: hand-maintained special cases of `bin/clone-check`, which already does this uniformly (v5, verbatim).
9. bin/lint's remaining ambition: 14 more slugs whose only finding was their own ratification commit. Zero regressions caught in 229 commits (v11). Keep `bare-hooks-path` only.

**FIX (3)**: these are outages, not quiet mechanisms
10. Workflow contract `stop`: revert one line to `bin/gauntlet stop`. It's a hook entry point run as a command: no stdin, `silent()`, exit 0. All 184 greens checked nothing.
11. `eslint-mirrors`: rewrite, don't patch. 122 crashes / 6 days, failing open; ~50% of in-scope edits went unchecked with no signal (v6).
12. `log-stop-failure`: two field names (`error`/`last_assistant_message`, not `error_type`/`error_message`). First fix, not the third.

**KEEP (quiet, but walls that hold)**
`credential-scan` (0 real catches, but irreversible loss at zero marginal cost) · validate-bash `.env` guard (rides a process already running) · `auto-approve-permissions` (8,883 clean allows, which is what makes v4 real) · `stop-fire-log` (the denominator machine this audit stands on) · close-gate all four branches · circuit-breaker · checklist-reminder · post-edit-validate · both routers · jscpd-guard · decoration-rail · Lumaria ui-guard + stop-gate.

**NOT A GATE PROBLEM**
`stop-gate.py` is healthy; it has only ever run in 2 of 20 repos because the other 18 have no `stop` contract slot. The finding is estate coverage, not gate health.
The 6 uninstrumented mechanisms get no ruling (v12). Default if nobody instruments them: delete.

## Changes / cost / risk

- **Changes:** 9 deletions, 3 one-line-to-one-file fixes. Removes ~120 wasted forced re-runs a month, 184 fake-green stop verdicts, and 25 lint slugs down to 1.
- **Cost:** roughly one session. Nothing here needs a design decision: the deletions are all things already not running or already wrong.
- **Risk:** low, with one exception. The close-gate tracker stand-down (178 fires, 2 days old) means Workflow's closes are judged solely by a YAML reimplementation that had *already drifted* from the Python when the stand-down was written. That's the estate's live single point of failure and it reads in the table as a clean pass.

## Where the skeptic changed the list

- **Rescued `credential-scan` and the `.env` guard** from deletion: zero catches on a path already executing is not the same as dead weight (v5's burden is met at zero cost). Flags this as its least-confident call; Collin's "already revoked" receipt cuts the other way.
- **Killed the auto-approve migration line item** outright as manufactured risk (v16). Unattended approval is the feature (v4); moving it to native `permissions.*` leaves him doing exactly what he already does (v15).
- **Escalated both validate-bash guards from "fix the scoping" to delete**: narrowing produces a third copy of a rule close-gate already implements correctly.
- **Reframed `stop-gate.py`** from ZERO-CATCH to a coverage finding: 18 repos where it reads as installed and enforces nothing.
- **Called three rows mis-measured:** credential-scan's honest number is 0/9,922 (its "2 catches" are its own fixture); validate-bash should be costed as 309 forced re-runs, not a 0.5% rate; ui-guard should use its `exposed` denominator (#815 installed it for exactly this) and exclude the 6 macOS fixtures.
- **Downgraded the tracker stand-down** from "healthy, 0 FP" to the audit's biggest buried risk: 48 hours is not evidence.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
