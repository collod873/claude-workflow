# Workflow Index — spec → implementation, everything we've built and written about it

**Compiled:** 2026-08-21 · **Scope:** every system, doc, ADR, research pass, audit and open
question relating to how Claude Code work gets specified, sliced, built, verified and closed
across Collin's projects, March 2026 → today.

This is a **pointer document**. It does not restate the contents of what it links to. Its job is
that nobody — human or agent — has to rediscover which repo holds the answer.

Two prior docs already do part of this job and are the deepest reads here:

- **[`General-Repo/ai-workflow-systems-inventory.md`](https://github.com/collod873/General-Repo/blob/main/ai-workflow-systems-inventory.md)** —
  the narrative history of all seven eras, why each was retired, and the through-line. Local:
  `~/Claude Projects/General-Repo/ai-workflow-systems-inventory.md`. **Read that for the story;
  read this for the map.**
- **[`agent-skills/docs/research/finding-what-goes-wrong.md`](https://github.com/collod873/agent-skills/blob/main/docs/research/finding-what-goes-wrong.md)** —
  the coverage taxonomy: ten classes of evidence and which have a mechanism looking at them.

---

## 1. The live system (era 6)

`collod873/agent-skills` · local `~/.agents/skills/` · **217 commits, 44 skills, 30 ADRs**,
baseline `0ab1b63` synced 2026-08-20. `~/.claude/skills/*` and `~/.claude/hooks/*` are nothing
but symlinks into this tree.

### Pipeline verbs

| Verb | Job | Skill |
|---|---|---|
| `/ask-matt` | Entry point — recommends which flow fits | `ask-matt/SKILL.md` |
| `/grilling`, `/grill-with-docs` | Stress-test the idea before it becomes a spec | `grilling/`, `grill-with-docs/` |
| `/wayfinder` | Map territory too large for one session; decisions against a ticket budget | `wayfinder/SKILL.md` |
| `/to-spec` | Conversation → a `PRD: <name>` issue, published via `bin/file-issue spec` | `to-spec/SKILL.md` |
| `/to-tickets` | Slice the spec — seam sweep, physical disjointness, audit-agent granularity grade | `to-tickets/SKILL.md` |
| `/triage` | On-ramp for an arriving issue: can criteria be written from the issue alone? | `triage/SKILL.md` |
| `/implement` | One ticket, criteria-bound, checker dispatched by stub, one fix pass | `implement/SKILL.md` |
| `/drain` | Work a batch — parallel workers in worktrees, serial merge behind the gate | `drain/SKILL.md` |
| `/standards-pass` → `/ratify` → `/standards` | Batch authorship of lint rules from landed diffs | `standards-pass/`, `ratify/`, `standards/` |
| `/converge` | Bring a machine back to the GitHub backups | `converge/SKILL.md` |
| `/sync-skills` | Sync vendored upstream, re-apply deltas, verify markers | `sync-skills/SKILL.md` |

**All ten pipeline verbs are `disable-model-invocation: true`** — every unit of work starts with a
human keystroke. That fact is the subject of open issue [#128](https://github.com/collod873/agent-skills/issues/128).

### Enforcement layer — `~/.agents/skills/hooks/`

| Hook | Event | What it does |
|---|---|---|
| `close-gate.py` | PreToolUse | Refuses a ticket close without a `## Closing record` with every criterion MET |
| `stop-gate.py` | Stop | Turn-end check, 240s deadline, contract-driven |
| `CHECKER-PROMPT.md` | — | The checker's instructions; lives beside `close-gate.py` because they're the only two machine readers of the closing record |
| `seeded-doc-router.py` | PreToolUse | Asks whether a seeded-doc edit must propagate |
| `vendored-router.py` | PreToolUse | Routes skill edits to ADR-0010's vendored/forked test |
| `checklist-reminder.py` | PostToolUse | **Era 2 survivor — still running five systems later** |
| `validate-bash.py`, `credential-scan.py`, `post-edit-validate.py`, `circuit-breaker.py`, `auto-approve-permissions.py`, `ui-token-validator.py` | mixed | The rest of the rails |
| `_hook.py`, `_harness.py` | — | Shared deny envelope, stdin reader, JSONL log writer, test harness |

Tooling: `bin/file-issue` (one filing verb, four kinds + `ticketify`), `bin/publish-issue-graph`
(parallel create with native sub-issue/blocked-by edges), `bin/clone-check`, `bin/re-seed`,
`bin/lint`.

### Contracts and consumers

Per-repo `.claude/contract.json` declares `stop` / `test` / `test_one` / `typecheck` / `lint`,
each with a `why` naming where the command came from.

| Repo | Contract | ADRs | Notes |
|---|---|---|---|
| **Lumaria** | ✓ | 64 in `docs/adr/` + 70 design decisions in `.design/decisions/` | The heavy consumer. 8 hooks, `CONTEXT.md`, `CODING_STANDARDS.md`, 20 open issues |
| **PWPP-Projects** | ✓ | — | `CODING_STANDARDS.md` |
| **3D-Printing** | ✓ | — | `CODING_STANDARDS.md` |

### Governing documents

- `CONTEXT.md` — glossary router with `_Avoid_` lists per term
- `UPSTREAM.md` — **the sync contract.** ~60 rows, one per divergence from upstream, each with a
  grep-able marker string that `test_upstream_markers.py` asserts still hits. Deletions carry a
  "compensating addition." This is documentation a test suite can fail on
- `CODING_STANDARDS.md` — currently has exactly one exit (mechanised), which is why it can only grow
- `docs/agents/` — `issue-tracker.md`, `ticket-format.md`, `triage-labels.md`, `domain.md`
- `CLAUDE.md` — thin router pointing at all of the above

---

## 2. The seven eras

Full narrative in [`ai-workflow-systems-inventory.md`](https://github.com/collod873/General-Repo/blob/main/ai-workflow-systems-inventory.md);
the *decision* narrative — why each era ended, and what carried across the boundary — is
[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)
(source: [`artifacts/seven-workflow-eras.html`](artifacts/seven-workflow-eras.html)).
This is the location map.

| # | Era | Active | Where it lives now | Doc quality |
|---|---|---|---|---|
| 1 | Plain plan mode → implement | Mar 2026 → | `crewops` git log; `Claude-Cockpit/.claude/plans/` (44 plan files) | ⚠️ **No write-up exists** |
| 2 | Homegrown checkbox hooks | Mar–Apr 2026 | `Planning-System/build/skills/`, `crewops/.claude/`, hooks now in `~/.agents/skills/hooks/` | ✅ Good, scattered |
| 3 | obra/superpowers (evaluated only) | Apr 13–14 2026 | `Planning-System/matrix.md` (442 lines, 77 rows) | ✅ Excellent |
| 4 | Planning-System spine | Apr 14 – May 20 2026 | `~/Claude Projects/Planning-System/` — 131 commits | ✅ Best in the estate + honest autopsy |
| 5 | Sandcastle | Jun 8 – Jul 2 2026 | `~/Claude Projects/sandcastle/` — 127 commits, 27 ADRs | ✅ Excellent — **no exit note** |
| 6 | agent-skills | Jul 6 2026 → **current** | `~/.agents/skills/` — 217 commits, 30 ADRs | ✅ Maintained |
| 7 | Side branches | Apr–Jun 2026 | Agent Teams, Crewops `/build-component` | Mixed |

Era boundaries are recoverable from Lumaria's own commits: `8aee47d` (graft, 06-24) → `3efd8fc`
(retire, 07-02) → today. Lumaria is the only repo where both Sandcastle and the current model ran
against the same codebase, which makes it the one honest A/B.

### Era 4 — Planning-System, the deepest documentation

`~/Claude Projects/Planning-System/`

| Doc | What it is |
|---|---|
| `CURRENT-STATE.md` | Pinned authoritative — "read this BEFORE spec.md, matrix.md, or any postmortem" |
| `OPEN-PROBLEMS.md` | **The autopsy.** Six numbered reasons it was retired. Its own summary: "Shipped, not settled" |
| `spec.md` (727 lines) | The spine spec: `/spec-first → /plan → /slice → /build → /verify → /ship` |
| `matrix.md` (442 lines) | 77-row file-by-file three-way comparison, KEEP/ADAPT/DROP/NEW per row |
| `review-decisions.md` | D1–D26 |
| `build/phase*-postmortem.md` | Four phase postmortems, numbered friction findings (F/E/G/H series) |
| `build/adapters/` | Domain adapters — `code`, `event`, `cad` working; `design`, `life-plan`, `business-ops` stubs |
| `build/skills/` (19) | Includes the era-2 archived standalones: `implement`, `autopilot`, `module-plan`, `add-module` |

**The retirement reason that matters most:** planning overhead exceeded fix size — ~7 plan steps
for ~3 edits in 1 file. Cockpit's `workflow-discovery-2026-04-19.md` named that friction a month
before the spine was retired for it.

### Era 5 — Sandcastle, the ambitious one

`~/Claude Projects/sandcastle/` · built on `@ai-hero/sandcastle ^0.10.0`

- `README.md` — the **North Star block** states the whole intended workflow in plain language:
  Grill → PRD → Issues → Implement → Pull
- `CONTEXT.md` — glossary router
- `docs/adr/` — **27 ADRs**, the strongest decision-record discipline of any era
- `.github/workflows/` — 9 Actions workflows driving the label state machine
- `.sandcastle/agent-workflows/` — 27 TypeScript ops (implement, review, acceptance-audit,
  update-branch, to-issues-prd) each with a `prompt.md`

Mechanisms worth remembering: wave-based parallelism with physical disjointness via registry
codegen (ADR-0017); auto-merge holds the **human-owned doc surface** (ADR-0026); chain-collapse
into fat self-contained sub-issues (ADR-0023); acceptance audit gates PRD close (ADR-0025).

**The hole:** nothing says why work stopped 2026-07-02. Open issue
[#131](https://github.com/collod873/agent-skills/issues/131).

---

## 3. The knowledge base wiki

`~/Claude Projects/Knowledge-Base/wiki/` — ~150 topic files. **No GitHub wiki exists on any repo;
this directory is "the wiki."**

Workflow-relevant topics:

| Topic | Covers |
|---|---|
| `topics/claude-code-hooks.md` (259 lines) | **The real record of era 2.** Includes the known gap: `validate-plan.py` only fired on `ExitPlanMode`, so `/slice`-authored files bypassed it |
| `topics/ai-project-planning-tools.md` (365 lines) | The era-3 evaluation — superpowers × Pocock × Collin's stack |
| `topics/verify-ship-workflow-discipline.md` | Era 2/4 discipline; heavily duplicated by the compile pipeline |
| `topics/planning-system.md` | Era 4 |
| `topics/claude-code-agent-teams.md` | Why Agent Teams was abandoned (teammate permission requests bypass the hook layer — GitHub #23983) |
| `topics/crewops-build-workflow.md` | The project-scoped `/build-component` → `/close-component` side branch |
| `topics/claude-code-agent-orchestration.md`, `claude-code-agent-execution-durability.md` | Orchestration patterns |
| `topics/claude-code-skills.md`, `claude-code-context-engineering.md` | Skill and context mechanics |
| `topics/agentic-os.md`, `cc-externalized-memory-clis.md`, `vibe-kanban.md`, `claude-mem.md` | Researched, never adopted — all medium confidence |
| `topics/knowledge-wiki-architecture.md`, `compile-wiki-internals.md`, `fact-routing-pipeline.md` | How the wiki itself was built |
| `topics/exemplar-repo-patterns.md`, `design-systems-for-ai-coders.md` | Adjacent |

Raw research captures for era 3 sit in `raw/manual/2026-04-1[34]-*.md` — the four full audits
(`superpowers`, `mattpocock`, `collin-stack`, `three-way`).

**⚠️ The wiki stops on 2026-05-21.** Session-capture hooks were deliberately emptied
(`SessionEnd: []`) and never re-wired after the iMac → WSL migration. There is no `sandcastle.md`,
no `agent-skills.md`, no `drain.md` topic. Eras 5 and 6 are documented inside their own repos
instead. See §7.

---

## 4. Research and measurement

### In-repo research — `~/.agents/skills/docs/research/`

Each carries an explicit **status header** distinguishing measured from reasoned. That convention
is itself worth copying.

| Doc | Status | Subject |
|---|---|---|
| `claude-md-line-ablations.md` | **Measured** — 726 headless trials, claude-opus-5 | Which CLAUDE.md lines actually change behavior |
| `claude-md-ablation-scaling.md` | Reasoned, not measured | Where the ablation harness stops scaling |
| `claude-md-end-state.md` | Target derived from measurement | What a repo's CLAUDE.md system should be |
| `finding-what-goes-wrong.md` | Mixed — reads cited, one classification quoted | **The coverage taxonomy.** Ten evidence classes, four with no mechanism |
| `hook-types.md` | Researched | What `prompt` and `agent` hook types can do (resolves #4) |
| `stop-gate-anatomy.md` | Captured | Lumaria's `stop-gate.sh` and its PostToolUse guards (#5) |
| `skill-design-principles.md` | Unmaintained snapshot | Synthesis of five skills and their reference files (#3) |
| `workflow-fixes.md` | Session findings | What's broken across wayfinder/triage/to-tickets/to-spec/implement/drain |

Harnesses under `docs/research/harness/` — `hooks-per-event/` (real hook collision experiments)
and `claude-md-ablation/` (tournament, sweep, judge-validate).

### Measurement docs — `~/Claude Projects/General-Repo/`

| Doc | Date | What it measures |
|---|---|---|
| `lumaria-shipping-model-vs-sandcastle-2026-08-21.md` (345 lines) | 08-21 | **The A/B.** Three eras in one repo: throughput, wall clock, reliability, compute, cost |
| `lumaria-ci-performance-2026-08-21.md` (240 lines) | 08-21 | 300 `ci.yml` runs, 120 sampled to job/step level. Corrects gap 4 of the Pocock audit |
| `mattpocock-agent-pipeline-audit-2026-08-21.md` (577 lines) | 08-21 | Full audit of Pocock's three repos — the external reference point |
| `lumaria-vs-pocock-audit-2026-08-21.html` (668 lines) | 08-21 | Lumaria scored against that reference, six parallel auditors |

**Headline numbers on record** (from the A/B): 21× less CI/orchestration compute per day
(9.5 machine-hours → 0.44); 8× less per issue closed; two thirds of Sandcastle's 2,120
orchestration runs were no-ops; ~$1,661 API-equivalent over 28 days, itemised — a number
Sandcastle could not produce at all. **What was lost:** the pre-merge gate (12 broken commits
reached `main` in five days) and per-ticket instrumentation (Sandcastle: implement p50 13.6 min,
review p50 7.6 min, p50 8 agent runs per PR).

### Published artifacts (claude.ai)

| Artifact | Subject |
|---|---|
| **[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)** | **The decision narrative §2 only maps.** Per-era what-worked/what-didn't/how-it-ended, a 12-mechanism survival matrix across all seven eras, the seven recurring failures and six durable wins. Source in-repo: [`artifacts/seven-workflow-eras.html`](artifacts/seven-workflow-eras.html) |
| [Sandcastle Autopsy](https://claude.ai/code/artifact/214fe363-b468-4e8c-9dfd-27fcc4b441f7) | Origin → churn → why shelved → every recorded measurement |
| [Lumaria Against the Pocock Pipeline](https://claude.ai/code/artifact/c8e8eb3c-4d9f-4476-a49f-f4c38d896272) | The six ranked gaps (issue #123) |
| [The Correction Ledger](https://claude.ai/code/artifact/a69d43d0-24f3-4376-a722-ef0bf8a9a89f) | 2,617 human prompts, 510 sessions, 22 Jul – 21 Aug (issue #127) |
| [The Owner's Foundry](https://claude.ai/code/artifact/c6ca3d6b-49f0-48cc-bf83-5d026e323c6d) | Fleet-architecture worked example (issue #125) — **a draft, never built** |

### Matt Pocock source material — `~/Claude Projects/General-Repo/`

- `matt-pocock-skills-workflows.md` — the workflow paths, synthesized from three videos
- `transcripts/2026-07-08-matt-pocock-skills-v1.1.md`
- `transcripts/2026-07-16-matt-pocock-skills-main-flow-tutorial.md`
- `transcripts/2026-07-30-matt-pocock-wayfinder.md`

### Sandcastle teardown corpus — `~/Claude Projects/General-Repo/`

Twelve documents from the May 2026 reverse-engineering of Pocock's setup, before adoption:

`sandcastle-blueprint.md` · `sandcastle-adoption-blueprint.md` (the portable how-to) ·
`sandcastle-expected-structure.md` · `sandcastle-public-api.md` · `sandcastle-src-classification.md` ·
`sandcastle-nonsrc-classification.md` · `sandcastle-system-vs-overhead.md` (141 system files
classified) · `sandcastle-structure.md` · `sandcastle-dependency-trace.md` ·
`sandcastle-to-cvm-crossref.md` · `cvm-sandcastle-files.md` → `cvm-sandcastle-files-audited.md` →
`cvm-sandcastle-final.md` (the evidence-graded progression) · `cvm-sandcastle-review.md`
(graded B+, names its own false positives) · `cvm-sandcastle-gaps.md` (43 files **not** adopted,
classified by relevance) · **`cvm-sandcastle-extensions.md`** (the 15 custom workflows CVM built
*on top of* sandcastle — the clearest picture of what a mature consumer adds) ·
`course-video-manager-structure.md` (800-line tree).

### Agentic OS design line — `~/Claude Projects/General-Repo/`

- `agentic-os-design.md` (2026-07-06) — verdict: *"the operating system is the harness itself +
  GitHub + your surviving skills."* Diagnoses all three dead systems as the same disease: a
  homegrown middle layer needing its own maintenance mode
- `agentic-os-design-review.md` — a fresh-session bias-corrected review of the above; the
  authoring session had disclosed it forced a native-first bias
- `handoff-agentic-os-controlplane-2026-07-07-premise-locked.md` — the grilling that locked the
  premise. Root insight: *"Claude on local files + simple commands = almost no friction. Claude
  having to use the GitHub API + PAT + workflows = a lot of instructions = fast context rot"*
- `claude-ds-ARCHITECTURE.md` / `claude-ds-ARCHITECTURE-target.md` — the design-system
  governance CLI. Core thesis: *"every constraint exists in exactly one of two executable forms —
  a write-time hook that blocks, or a post-hoc audit rule that flags. There is no third category"*

---

## 5. Decision records

| Repo | Location | Count | Character |
|---|---|---|---|
| agent-skills | `docs/adr/` | 30 | Pipeline mechanics. 9 of 30 amend or supersede an earlier one |
| Lumaria | `docs/adr/` | 64 | Codebase-level |
| Lumaria | `.design/decisions/` | ~70 | Design-system rulings, `0000-template.md` onward |
| sandcastle | `docs/adr/` | 27 | Actions/label state machine |
| claude-ds | `docs/adr/` | — | Design-system CLI scope |
| Planning-System | `review-decisions.md` | D1–D26 | Fork-diff rulings |

**The agent-skills ADRs that carry the most weight:**

| ADR | Ruling |
|---|---|
| 0001 | Pipeline is states, not activities |
| 0002 / 0005 | The close gate is a verification record, enforced as a PreToolUse command hook |
| 0007 | Execution order is a file claim (disjointness) |
| 0008 | Drain takes a batch, not a spec |
| 0010 | Vendored / forked / local-only — the sync taxonomy |
| 0011 | The closer dispatches the checker |
| 0018 | Seeded docs are the home; CLAUDE.md carries a pointer |
| 0022 | Turn-end gates run fast checks only |
| 0026 | Subagents are dispatched by stub, in the foreground |
| 0028 | A foreman runs at the top of the session (a nested one reads "waiting" as "finished") |
| **0029** | **The standards chain is maintainer-invoked** — the automatic trigger was removed because the chain fed on its own output. Explicitly rejects a periodic cadence: *"still work the maintainer did not ask for, only less often"* |
| 0030 | A seam is prefactored where predictable, ledgered where it is not |

**The connector decision** — [#28 "Who fires the next edge"](https://github.com/collod873/agent-skills/issues/28),
closed 2026-07-29: *"The human fires every edge, by design — with the one CI exception already
decided."* It declared its own expiry condition (a second operator, or maps stacking up unworked)
and said it **reopens as a fresh effort, not a resumption**. Open issue #128 argues that condition
is now met.

**The CI precedent** — [#8](https://github.com/collod873/agent-skills/issues/8) established that
CI can reach a `disable-model-invocation: true` skill, because a routine's prompt is a user turn.
`.github/workflows/triage.yml` runs `/triage` on `issues.opened` in production today. That flag
blocks an *agent*, never an Action.

---

## 6. Open questions — `collod873/agent-skills`, 11 open issues

### Fuzzy — a decision is owed before they can be ticketed

These are the strategy questions. Each ends with *"Run `file-issue ticketify <n>` once this is
decided."*

| # | Question | Depends on |
|---|---|---|
| [#128](https://github.com/collod873/agent-skills/issues/128) | **Which edges get a CI connector, what filter makes that safe, and what gets deleted rather than automated?** The synthesis issue — argues the blocker is the connector, not the skill layer | Reopening #28; ADR-0029's exhaust filter |
| [#125](https://github.com/collod873/agent-skills/issues/125) | Is "fleet architecture" a question type this repo needs a verb for? | Collides with #124 in three places |
| [#124](https://github.com/collod873/agent-skills/issues/124) | Which uncovered evidence classes are worth a lens — and is the verification layer doing anything? | Answered Q1: **~22 of 278 closes UNMET ≈ 8%**, substantive. Not theatre |
| [#127](https://github.com/collod873/agent-skills/issues/127) | Which Correction Ledger findings become enforcement vs stay observations? | Is #124's evidence-class row 9, executed |
| [#123](https://github.com/collod873/agent-skills/issues/123) | Which of the six ranked Lumaria-vs-Pocock gaps are real enough to act on? | Gaps 3/4/6 recommended for split-out |
| [#129](https://github.com/collod873/agent-skills/issues/129) | Sandcastle vs how we ship now — two candidates: gate the batch in `/drain`, and give `/drain` a per-ticket clock | Overlaps #123 gap 4 |
| [#131](https://github.com/collod873/agent-skills/issues/131) | Write the Sandcastle postmortem | Blocked — the reason work stopped may not be recoverable |
| [#134](https://github.com/collod873/agent-skills/issues/134) | Where does a drain file defects it finds in the drain machinery itself? | ADR-0029's don't-sweep-your-own-landing principle |

**⚠️ Read #123/#124/#125/#127 as three grades of evidence, not as a consensus.** #128 documents
that all four cross-referencing comments were posted inside a **70-second window** by one session
that had read all four — and that the comment renders *above* the body in `gh issue view`, so a
reader meets the synthesis first and reports it back as independent agreement. Two of the four
were substantially wrong the moment a number got attached. #128 §1 carries the grading table.

### Ticketed — acceptance criteria written, ready to drain

All four came out of a single drain of Lumaria PRD #657 and are defects in the **machinery**, not
in any project:

| # | Defect |
|---|---|
| [#130](https://github.com/collod873/agent-skills/issues/130) | Checker runs `git checkout` in the foreman's shared checkout, corrupting a concurrent gate run |
| [#132](https://github.com/collod873/agent-skills/issues/132) | Worktrees outlive their tickets and exhaust tmpfs inodes — surfaces as a *plausible, ticket-shaped test failure*, not as "disk full" |
| [#133](https://github.com/collod873/agent-skills/issues/133) | Checker evidence shape has drifted from `close-gate.py`'s parser; the rule is prose in one file and a parser in another with nothing tying them |
| #134 (fuzzy) | …and there was nowhere to file the other three |

---

## 7. Known gaps in the record

1. **No Sandcastle postmortem.** The only era with neither a passive record nor a self-authored
   exit note. Two months of memory decay. → #131
   **⚠️ Contested.** [Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)
   §00 refutes two of #131's three blocking premises: `General-Repo` reads fine (the 404 was a
   stale credential, not an access boundary), and a retirement commit does exist — Lumaria
   `3efd8fc`, 07-02, which documents the *cleanup* thoroughly and the *reason* not at all. The
   third premise is worse than stated: capture died 05-21 **and** local transcripts only begin
   07-22, so nothing from eras 1–5 survives in conversation form at all. Its position: #131 should
   absorb the 08-21 measurement docs rather than restart, leaving only the decision narrative
   genuinely missing — which is what the artifact itself reconstructs.
2. **Session capture is dead.** Stopped 2026-05-21; `~/.claude/settings.json` has `SessionEnd: []`.
   Apr 2026: 540 session captures. Jun 2026: **0**. The wiki documents eras 1–4 and nothing after,
   while reading as if it were current.
3. **The 30-day prune makes any pass-time transcript audit silently vacuous.** `cleanupPeriodDays:
   30` — a scan run six weeks after the last one loses the first two weeks and reports a clean
   sweep. #124's ruling: capture must happen at **session time**, stored durably. The conversation
   spine is ~1.3% of a transcript (~18KB, flat) — ~500KB/day.
4. **The corpus can't see Sandcastle, cloud, or GH-runner work.** Zero typed prompts 4–19 Aug
   reads as a break but was a venue change.
5. **Era 1 is undocumented** and probably should stay that way — its lesson (no enforcement, no
   adherence) was already recorded in era 2.
6. **The Correction Ledger extractor is still under `/tmp`** and will not survive:
   `/tmp/claude-1000/-home-collin-Claude-Projects-General-Repo/dcf2e2df-.../scratchpad/`
   (`extract.py`, `prompts.jsonl`, `behavioral.txt`, `correction-ledger.html`).
7. **Two fail-open holes.** Commit-keyword closes (`Closes #704`) never reach the PreToolUse gate.
   ~7 log lines are rails crashing (`SELECT_ITEMS is not defined`), fail-open and unseen. A
   fail-open gate in an unattended system is not a gate.
8. **No mechanism points backwards.** 30 ADRs in a month, 9 amending an earlier one; 36 lint rules
   from 5 standards passes; **not one of the 36 has been asked whether it caught anything.**

---

## 8. The through-lines

Three findings recur across every era and every audit. They are the reason this index exists.

**1. Enforcement at execution time is the only thing that survives.** The wiki wrote it in April
2026 and it has held through every era since:

> *Enforcement at execution time is the only mechanism that survives 'brain off + memory wiped.'
> Skill files document, plan files revise, CLAUDE.md teaches — but all rely on being read. A
> validator that errors fails closed unconditionally.*

Era 2's `checklist-reminder.py` is still running. Era 6's `close-gate.py` is era 2's insight
applied to tickets instead of plans. Era 4 died of ceremony, not of enforcement — its DoD gate
worked; the seven-step plan around a three-line fix didn't.

**2. Each era moved documentation closer to the thing it describes.** Loose plan files → a central
wiki → in-repo ADRs + a sync contract with executable markers. `UPSTREAM.md` is the endpoint of
that trend: documentation a test suite can fail on.

**3. Prose in a pile decays; a hook that stops firing is proof a lesson landed.** ~100 corrections
in the Correction Ledger ask for shorter/plainer output — against a rule *already in* global
`CLAUDE.md`. Meanwhile `validate-bash` went 81 blocks → 2 → 0 over four days, and permission
denials 47 → 10 on comparable tool volume. Adding prose does not work; adding an enforcement point
does.

---

## Appendix — repo quick reference

| Repo | Local path | Role |
|---|---|---|
| `agent-skills` | `~/.agents/skills/` | **The live system.** Skills, hooks, ADRs, research |
| `General-Repo` | `~/Claude Projects/General-Repo/` | Cross-cutting research, measurements, audits, teardowns |
| `Knowledge-Base` | `~/Claude Projects/Knowledge-Base/` | The wiki (eras 1–4). Frozen 2026-05-21 |
| `Planning-System` | `~/Claude Projects/Planning-System/` | Era 4 archive + autopsy. 8 open issues |
| `sandcastle` | `~/Claude Projects/sandcastle/` | Era 5 archive. 2 open issues |
| `Lumaria` | `~/Claude Projects/Lumaria/` | Primary consumer + the A/B testbed. 20 open issues |
| `PWPP-Projects`, `3D-Printing` | `~/Claude Projects/` | Secondary consumers (contract only) |
| `Claude-Cockpit` | `~/Claude Projects/Claude-Cockpit/` | Era-1 plan corpus + `workflow-discovery-2026-04-19.md` |
| `crewops` | `~/Claude Projects/crewops/` | Era-1/2 evidence: stories, sprints, `manifest.md` |
| `claude-ds` | `~/Claude Projects/claude-ds/` | Design-system governance CLI |
| `dotfiles` | — | Machine config, chezmoi |
| **`Workflow`** | `~/Claude Projects/Workflow/` | **This repo** |
