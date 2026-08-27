# What each era chose for tracker, CI host, and agent compute

**Compiled:** 2026-08-21 · **Resolves:** [`collod873/claude-workflow#4`](https://github.com/collod873/claude-workflow/issues/4)
(map [#1](https://github.com/collod873/claude-workflow/issues/1))

> **Status: retrieval, not discovery — mixed measured and reasoned.**
>
> - **Measured, read from the artifact itself:** every `runs-on:` value, commit sha and date,
>   issue and PR number and creation timestamp, runner registration, label set, and machine fact
>   below was read from the working clones, `git log`, or the GitHub API on this machine today —
>   not recalled and not carried over from a prior write-up. Where a prior write-up disagrees with
>   the measurement, §7 says so.
> - **Quoted from a prior measured pass, not re-run:** the throughput, compute, and cost figures
>   in §4 and §6. They come from `General-Repo/lumaria-shipping-model-vs-sandcastle-2026-08-21.md`
>   and `General-Repo/lumaria-ci-performance-2026-08-21.md`, which state their own method.
> - **Reasoned, not measured:** §5's carried-forward-versus-re-decided classification. The boundary
>   facts are cited; calling one "independently re-derived" and another "carried" is an argument
>   from those facts.
> - **Unknown is written as unknown.** No cell is inferred from an adjacent era. §6 collects every
>   hole and names what would close it.
>
> Sources read: `~/Claude Projects/{General-Repo, sandcastle, Planning-System, Lumaria, crewops,
> Claude-Cockpit, Knowledge-Base}`, `~/.agents/skills/`, `~/.local/share/chezmoi`, and the GitHub
> API for `collod873/{sandcastle, agent-skills, Lumaria, Planning-System, crewops, Claude-Cockpit}`.

---

## 1. Three columns, and why they are three

They get conflated, and the conflation is most of what this ticket exists to undo.

- **Tracker** — where a unit of work lived, and what made it "open." A checkbox in a markdown
  file is a tracker; so is a GitHub issue.
- **CI host** — the machine that ran the automated checks, and who paid for that machine.
- **Agent compute** — where the Claude process itself executed.

**Era 5 is the only era where CI host and agent compute were the same machine by design** — the
agent *was* a CI job. Every other era ran the agent on Collin's own filesystem, whether or not any
CI existed. Reading "21× less CI compute" as "21× less agent compute" gets era 5 backwards; see §4.

---

## 2. The table

One row per era. Every cell carries its source.

| # · Era | Tracker | CI host | Agent compute | How it ended |
|---|---|---|---|---|
| **1** · Plain plan mode<br>Mar 2026 → | Local files only. `crewops/.claude/manifest.md` + `state.md`, both in the initial commit `bf1ba63` (2026-03-20); step files under `.claude/plans/` committed `64ba07e`/`9e9996b` (03-21) then gitignored `44e2b3c` (03-23). Commit subjects `plan(phase-1): step N` are the ledger. **No GitHub issues** — Cockpit has 0 ever (`gh issue list -R collod873/Claude-Cockpit --state all` → `[]`), crewops #1 is 2026-05-18 | **None.** crewops' first workflow file ever is `9c76eae` (2026-04-28); Claude-Cockpit never had a `.github/` directory in its history (`git log --all --diff-filter=A -- '.github/**'` → empty) | Local Claude Code on the iMac. `Claude-Cockpit/.claude/CLAUDE.md:3` "Local **macOS** desktop app"; `Claude-Cockpit/.claude/project.yaml` `adapter_path: /Users/collinlodato/…`; `Knowledge-Base/wiki/topics/collin-imac-setup.md:42` "iMac 27" 2019 (`iMac19,1`)", i5-9600K | **It didn't.** `artifacts/seven-workflow-eras.html` §02 era 1: "It didn't. It's still the default for anything below ticket size" |
| **2** · Checkbox hooks<br>Mar–Apr 2026 | Same local files, plus `crewops/.claude/stories/` — 20 story files + README, added `b4fc9f3` (03-26) and `33ae793` (03-27). Unit of work = a `US-{MODULE}-{NNN}` story whose `#### Acceptance Criteria` are `- [ ]` boxes (`stories/README.md`, `stories/jobs.md:1-20`). `manifest.md` holds per-module `- [x]`; `.claude/CLAUDE.md` routes to both. `.claude/sprints/` is **one** file, `2026-04-28-hardening.md` (`b1dbe1b`), written at the era's end | **None until 2026-04-28, then GitHub-hosted.** `9c76eae` adds `verify.yml`; `4406c2a`/`1740b9d` add `e2e-smoke.yml`. Measured in `crewops/.claude/sprints/2026-04-28-hardening.md`: verify "74 s end-to-end", e2e-smoke "~3 m cold cache, ~90 s warm". Before that the gate was local — `.githooks/pre-push` plus PreToolUse hooks (`26b91ab` 04-27, `d990fa0` 04-28) | Local, iMac — same evidence as era 1. Enforcement ran in-process as Claude Code hooks, not on any runner (`ai-workflow-systems-inventory.md` §2) | **Absorbed, not killed.** Skills archived into era 4's `build/skills/` by `dfce23d` (2026-05-20); hooks consolidated into `~/.agents/skills/hooks/`. `checklist-reminder.py` and `post-edit-validate.py` are still live today (`INDEX.md` §1) |
| **3** · obra/superpowers<br>Apr 13–14 2026 | **None of its own** — it never ran work. Its output is `Planning-System/matrix.md` (442 lines, 77 rows) plus raw captures under `Knowledge-Base/raw/manual/2026-04-1[34]-*.md` (`INDEX.md` §3) | **None** — never a running system (`ai-workflow-systems-inventory.md` §3, "Evaluated Apr 13–14 2026. Never adopted as a running system") | Local, iMac. A 15-agent parallel research sweep as Task subagents (`ai-workflow-systems-inventory.md` §3); neither Cockpit nor Knowledge-Base ever had CI | **By design.** Became input #1 to era 4 (`ai-workflow-systems-inventory.md` §3; eras artifact §02 era 3) |
| **4** · Planning-System spine<br>Apr 14 – May 20 2026 | Files in the repo — spec, plan, and slice files, cited by commit: `cf66792` "spec: G9 … approved", `4072dcf` "plan: G9 dod.skip — 11 tasks, ~45 steps", `3cca9eb` "plan(g9-dod-skip): record 2-slice decomposition". **GitHub issues were not the tracker**: all 6 Planning-System issues were created 2026-05-20, and #1/#2 are its *retirement* (`gh issue list -R collod873/Planning-System --state all`) | **None, ever.** `ls .github` → no such directory; `git log --all --diff-filter=A -- '.github/**'` → empty output | Local, iMac. `Knowledge-Base/wiki/topics/planning-system.md` "Project location: `/Users/collinlodato/Claude Projects/Planning-System/`"; `CURRENT-STATE.md` wires `build/hooks/validate-plan.py` into local `settings.json:231`; `f9f2991` (04-19) "Make wiki topic-match hook follow the SSD-boot filesystem" | **Stopped being used, then formally retired.** 128 of 131 commits are April; quiet after 04-28; retired 05-20 via issue #1 and commit `dfce23d`. Reason, from issue #1's body: *"The system grates against day-to-day flow, is barely used… The homegrown middle is friction, not value."* `OPEN-PROBLEMS.md` (dated 2026-04-22) §4: "7 plan steps for ~3 edits in 1 file. Ratio of ceremony to substance is ~7:3" |
| **5** · Sandcastle<br>Jun 8 – Jul 2 2026 | **GitHub Issues plus a 13-label state machine.** `collod873/sandcastle` holds 105 issues, #1 dated 2026-06-08; Lumaria carries the consumer tickets (597 issues; #1 2026-06-18, six days before the graft). The 13 labels are created verbatim by the graft block in `sandcastle/README.md:167-179`. `sandcastle/docs/adr/0014`: *"The label set stays the state machine's memory"* | **Self-hosted runner pool on Collin's Mac.** `docs/adr/0001-self-hosted-runner-pool.md` (2026-06-08): *"Private-repo GitHub-hosted Actions minutes are metered, and the agent pipeline blew through the ~3000 min/month allotment in a few days of normal use."* All 12 `runs-on:` occurrences across the 10 workflow files are `self-hosted`; pool default `RUNNER_COUNT=10` (`README.md:229`) | **The same runners — the agent *was* the CI job.** `.sandcastle/agent-workflows/implement/implement.ts:2-4,42` imports `@ai-hero/sandcastle` and runs `claudeAgent()` under `noSandbox`. ADR-0001: *"No container job runtime… Claude Code is installed once on the Mac instead"* and *"Runners are always-on via `launchd`."* `handoff-agentic-os-controlplane-2026-07-07…md` verified 21 runner LaunchAgents on the Mac (10 Lumaria, 10 sandcastle, 1 crewops) | **Switched off, not collapsed.** Lumaria `3efd8fc` (2026-07-02) "chore: retire the sandcastle AFK-agent pipeline" deletes all 9 `agent-*.yml` and `.sandcastle/`; last sandcastle commit `f131d26`, same day; only 2 issues left open. **The commit documents the cleanup and not the reason** — reconstructed in eras artifact §07 as *"distributed orchestration was bought for a workload that was never distributed"* |
| **6** · agent-skills<br>Jul 6 2026 → current | **GitHub Issues, split by repo.** Consumer repos own the work tickets (Lumaria, 597 issues). `agent-skills` got its own tracker only on 2026-07-29 — issue #1 is 2026-07-29, 23 days after the era's first commit `a5f1597` (07-06); 136 issues today. **Labels are triage positions, not a state machine** — `agent-skills/docs/adr/0004-triage-labels-are-positions-not-verdicts.md`; `agentic-os-design.md` L2: *"Never rebuild label choreography. Labels are data, not a state machine"* | **GitHub-hosted `ubuntu-latest`.** Lumaria switched on 2026-07-08 — `80d10ae` "ci: run on GitHub-hosted ubuntu runners instead of self-hosted". All 8 `runs-on:` in Lumaria and the 1 in `agent-skills` are `ubuntu-latest`. Lumaria has **0** registered self-hosted runners today (`gh api repos/collod873/Lumaria/actions/runners` → `total_count: 0`); sandcastle also 0. Three workflows remain in Lumaria: `ci.yml`, `license-gate.yml`, `triage.yml` | **Local Claude Code sessions on the workstation, in git worktrees.** `drain/SKILL.md:69-86` — foreman cuts `git worktree add` per ticket, dispatches a subagent, merges serially. Machine today: WSL2 on Windows, AMD Ryzen 9 9950X3D / 32 threads (`uname -a`, `lscpu`, this machine, 2026-08-21). **One exception:** `agent-skills/.github/workflows/triage.yml:76` runs `anthropics/claude-code-action@v1` on `ubuntu-latest` with a `CLAUDE_CODE_OAUTH_TOKEN` — its own header calls it *"the **only** CI-driven transition in the whole pipeline"* (seeded `fb0ca82`, 2026-07-29) | **Live.** Eras artifact §02 era 6: *"Live, and by the numbers the best system yet on every axis except the merge gate"* |
| **7a** · Side branch — Agent Teams<br>Apr 13–14 2026 | **GitHub PRs, no issues.** 23 PRs on `collod873/Claude-Cockpit`, every one created 2026-04-14 on `overnight/*` branches; 21 merged, 2 closed (`gh pr list -R collod873/Claude-Cockpit --state all`). The repo has 0 issues, ever | **None.** Cockpit never had a `.github/` directory (`git log --all --diff-filter=A -- '.github/**'` → empty) | Local macOS, against a live Cockpit worktree, kept awake with `caffeinate`. `Knowledge-Base/wiki/topics/claude-code-agent-teams.md`: *"Ran the overnight team against a live Cockpit worktree"*, *"Caffeinate PID 83512 killed; team directory `~/.claude/teams/cockpit-overnight` left on disk"* | **Structurally disqualified, 2026-04-14.** Same wiki topic: *"Teammate permission requests bypass the `PermissionRequest` hook layer (GitHub issue #23983, OPEN, Linux + macOS)"*, so `auto-approve-permissions.py` never fires. `/agent-team` deleted per Planning-System D9; Task subagents replaced it |
| **7b** · Side branch — crewops `/build-component`<br>May – Jun 2026 | **Gitignored slice files, then GitHub Issues.** 13 slice files under `.claude/plans/` with `hitl: true` frontmatter, *"gitignored — on disk only, no commit needed"* (`Knowledge-Base/wiki/topics/crewops-build-workflow.md`), plus a `kit-manifest` (`25e7cb2`, 05-02). Tracker flips to issues on 2026-05-18 (crewops issue #1; 94 issues through 06-17); `82c5468` (06-14) "docs: route roadmap questions to GitHub issues" | **GitHub-hosted, then self-hosted.** Hosted from `9c76eae` (04-28); switched by `b4e4fbc` (2026-05-26) — *"Switch all workflows to self-hosted runner to avoid GitHub Actions abuse flags on free tier"*, 11 workflow files, `- runs-on: ubuntu-latest` → `+ runs-on: self-hosted`. **13 days before sandcastle's ADR-0001, in a different repo, for a different stated reason** | Local at first; from `242194a` (2026-05-25) agents ran inside 7 `agent-*.yml` workflows on the self-hosted Mac runner. `187755b` (05-22) "Add sandcastle dev tooling for parallel agent sandboxes" brought `.sandcastle/` **with a `Containerfile`** — later dropped, per ADR-0001's "No container job runtime" | **Deleted in two steps.** `295f335` (2026-05-18) retires the `/build-component` + `/close-component` commands; `7698c60` (2026-06-12) "Remove dead agent automation, CI workflows, and design-system review leftovers". `git ls-tree -r HEAD \| grep github` → empty. One artefact survives: an offline runner `crewops-mac` is still registered (`gh api repos/collod873/crewops/actions/runners` → 1, `offline`, `macOS`) |

---

## 3. The shape of it

Read down the columns rather than across the rows and three things fall out.

**The tracker moved once, and never moved back.** Local files ran eras 1 through 4 without anyone
arguing about it. GitHub Issues arrive in a two-day window — crewops #1 on 2026-05-18, Planning-
System's six retirement issues on 05-20 — and every era since has used them. The switch was not a
decision anyone wrote down at the time; the first thing the new tracker tracked was the old
system's funeral.

**The CI host was decided four times in four months and ended where it started.** None (Mar–Apr) →
GitHub-hosted (crewops, 04-28) → self-hosted (crewops 05-26, then sandcastle 06-08) → GitHub-hosted
(Lumaria 07-08). The current position is the same one crewops took on 2026-04-28, arrived at again
by a different route.

**Agent compute left Collin's filesystem exactly once.** Eras 1, 2, 3, 4 and 6 all run the agent
where the files are. Era 5 — and the crewops arm of era 7 that fed it — is the sole departure, and
its whole architecture followed from that one move: a PAT, thirteen labels, nine workflows, twenty-
seven TypeScript ops, and six ADRs of race discipline exist because the agent was somewhere the
files were not. `handoff-agentic-os-controlplane-2026-07-07-premise-locked.md` names the cost in
Collin's own words: *"Claude on local files + simple commands = almost no friction. Claude having
to use the GitHub API + PAT token + workflows = a lot of instructions = fast context rot."*

---

## 4. The compute figure, stated correctly

The headline everyone quotes is **21× less compute per day, 9.5 machine-hours → 0.44**
(`lumaria-shipping-model-vs-sandcastle-2026-08-21.md` §5). Three corrections belong with it every
time it is used.

1. **Sandcastle's 9.5 h/day was Collin's own metal, not a bill.** Those machine-minutes are
   GitHub Actions jobs executing on the **self-hosted runner pool on the iMac**. ADR-0001 chose
   that pool precisely so the minutes would be free: *"runner minutes are free and unmetered, and
   pool size — not a billing quota — becomes the only ceiling."* The ratio measures how much of his
   own machine the orchestrator ate, not money.
2. **The two sides of the ratio are not the same kind of cost.** Era 6's 0.44 h/day runs on
   metered GitHub-hosted `ubuntu-latest` in private repos (`80d10ae`), which is the exact meter
   ADR-0001 fled. The comparison is free-owned-metal against paid-hosted-minutes.
3. **The compute did not shrink, it moved, and the destination is not in the number.** The A/B doc
   says so directly: *"That compute did not vanish, it moved — from GitHub Actions jobs on the iMac
   to Claude sessions on the workstation."* The 0.44 h/day figure counts none of the workstation.

**So the finding is visibility, not the ratio.** Era 6 can price its agent compute — ~$1,661
API-equivalent over 28 days, itemised per model, session and day. **Era 5's equivalent number is
not merely unmeasured; it is unobtainable.** Sandcastle issue #39 opened with a verification gate
on whether `@ai-hero/sandcastle`'s `RunResult` exposed cost and duration. It did not: the SDK parses
Claude Code's `result` line — which carries `total_cost_usd`, `duration_ms` and `num_turns` — and
**discards all three**. The gate failed, the issue was correctly stopped rather than worked around,
and the pipeline ran to retirement blind to its own spend
(`lumaria-shipping-model-vs-sandcastle-2026-08-21.md` §5; eras artifact F6).

---

## 5. What survived a boundary, and what was re-decided

A choice re-derived independently by two eras is stronger evidence than one carried forward, so
they are separated here. **The classification is reasoned; the facts under it are cited.**

| Choice | Verdict | Evidence |
|---|---|---|
| **Local files as tracker** | **Carried**, eras 1 → 4, never re-argued | Same `.claude/` file shapes from `bf1ba63` (03-20) through era 4's slice files; no repo in that span ever opened a work-tracking issue |
| **GitHub Issues as tracker** | **Carried** across the 5 → 6 boundary — and it is the *only* piece of era 5's infrastructure that survived that boundary at all | `3efd8fc` deleted 9 workflows, 13 labels and `.sandcastle/` while leaving Lumaria's issues untouched (597 today). `agentic-os-design.md` principle 4 states the reason: *"The tracker is the memory… Closing an issue IS the grooming — that's why issues survived and the wiki didn't"* |
| **Self-hosted runners** | **Independently re-decided**, twice, 13 days apart, for two different reasons — then reversed | crewops `b4e4fbc` (2026-05-26): *"to avoid GitHub Actions abuse flags on free tier."* sandcastle ADR-0001 (2026-06-08): *"metered… blew through the ~3000 min/month allotment."* Neither cites the other. Reversed by Lumaria `80d10ae` (2026-07-08) |
| **GitHub-hosted CI** | **Independently re-derived** after being abandoned | Chosen in crewops 2026-04-28 (`9c76eae`), abandoned 05-26, re-chosen for Lumaria 07-08 (`80d10ae`) with no reference to the first adoption |
| **Agent compute on the operator's own machine** | **Re-derived**, not carried — it was abandoned for era 5 and argued back in | Eras 1–4 assume it; era 5 leaves it (ADR-0001 `noSandbox` on the runner); era 6 returns to it via a fresh argument in `handoff-…-premise-locked.md` decision 1: *"Claude Code only ever touches local files, local git, local processes."* The eras artifact notes the landing spot is also Pocock's: *"local Claude sessions, zero agent workflows"* |
| **Label state machine as message bus** | **Carried** 7b → 5, then **ruled out** | crewops `242194a` (05-25) brings 7 `agent-*.yml`; sandcastle inherits and grows it to 9 + 13 labels; `3efd8fc` deletes it and `agentic-os-design.md` L2 forbids rebuilding it. `2,120 orchestration runs, 1,365 of them no-ops` is the measured reason |
| **Verifier ≠ implementer** | **Re-derived in every era from 3 onward**, usually without anyone arguing for it | Era 4 `spec-reviewer → quality-reviewer`; era 5 ADR-0025 acceptance audit; era 6 ADR-0011 "the closer dispatches the checker". Eras artifact §03 row 2 is green across eras 3–7 |
| **Execution-time gate (a hook that errors)** | **Carried literally** — the same files still run | `checklist-reminder.py` and `post-edit-validate.py`, written Mar–Apr 2026, are live in `settings.json` today, four systems later (`INDEX.md` §1; eras artifact W1) |
| **Pre-merge gate on the diff** | **Lost at the 5 → 6 boundary and not re-derived** — the one clean regression | Era 5 had CI on the PR blocking the merge (ADRs 0006/0011). Era 6 gates locally with `pnpm check` and CI is post-merge: `lumaria-ci-performance-2026-08-21.md` §4 — all 12 failures since 08-16 are genuine `unit` + `build` breakage, zero flake. Twelve broken commits on `main` in five days |
| **Cost / duration instrumentation** | **Never carried; partial in both eras that had any**, for opposite reasons | Era 5 had per-op wall clock free from workflow records but no cost (issue #39). Era 6 has cost but **no per-ticket clock** — `lumaria-shipping-model-vs-sandcastle-2026-08-21.md` §3, "the current model has no per-ticket clock" |
| **Passive session capture** | **Silently switched off, never decided** | `~/.claude/settings.json` has `"SessionEnd": []` — an empty array, so it was emptied deliberately. Apr 2026: 540 captures. Jun 2026: 0. No commit, ADR or issue records the choice |

**The pattern in that table:** every *expensive* choice got argued about at least twice, and the two
things that disappeared without any decision at all — the pre-merge gate and passive capture — are
both cheap infrastructure whose value only shows up later. Nothing screams when they go.

---

## 6. Unknowns — written as unknown, not inferred

| Question | Status | What would close it |
|---|---|---|
| Era 5's token / agent spend | **Structurally unobtainable**, not merely unmeasured. `@ai-hero/sandcastle` parses Claude Code's `result` line and discards `total_cost_usd`, `duration_ms`, `num_turns` (sandcastle issue #39) | Nothing. The data was never written down. Only a re-run on an instrumented SDK could produce it, and the pipeline is deleted |
| Agent compute cost for eras 1–4 | **Unknown.** No instrumentation existed, and local transcripts on this machine begin 2026-07-22, so nothing conversational survives | Nothing available. `cleanupPeriodDays: 30` destroyed the rest |
| Era 5's stated retirement reason | **Unknown as a first-party statement.** `3efd8fc` documents the cleanup thoroughly and the reason not at all | Only Collin. The reconstruction in the eras artifact §07 is an argument from ADRs 0014/0020/0023 and issue #39, not a quote |
| Exact WSL cutover date | **Unknown.** Bracketed 2026-07-17 (last macOS-era backup commits: Cockpit `145d8f7`, crewops `23d3ed2`) → 2026-07-22 (earliest local transcript). chezmoi `aeb7643` (07-21) is the first off-mac commit: *"unhardcode gh path so credentials work off-mac"* | No document states it in words. Windows install date or shell history would settle it |
| Which machine ran era 6's first ~two weeks | **The iMac**, then unknown transition. `handoff-…-2026-07-07…md` verifies 21 runner LaunchAgents in `~/Library/LaunchAgents/` — macOS — on 2026-07-07, the day after era 6's first commit. So era 6 *began* on the iMac and changed machines mid-era | Same as the row above |
| Era 2's checkbox-hook scripts as they stood in Mar–Apr 2026 | **No repo-tracked copy found** in crewops, Cockpit, or chezmoi (chezmoi's history starts 2026-04-13). The era is known only from the wiki write-up and its surviving descendants in `~/.agents/skills/hooks/` | An iMac backup predating 2026-04-13, if one exists |
| Whether crewops' offline `crewops-mac` runner is reachable | **Unknown.** It is still registered on the repo and reports `offline`; nothing in this record says whether the LaunchAgent still exists | Checking the iMac |

---

## 7. Corrections to the existing write-ups

Three counts in `INDEX.md` and `ai-workflow-systems-inventory.md` did not survive re-measurement.
They are small, but this doc is meant to be the citable one.

| Claim | Where | Measured |
|---|---|---|
| "44 plan files" in `Claude-Cockpit/.claude/plans/` | `INDEX.md` §2; `ai-workflow-systems-inventory.md` §1 | **60** (`ls \| wc -l` and `git ls-tree -r HEAD` agree) |
| Planning-System has "8 open issues" | `INDEX.md` appendix | **6 total, 5 open** — #1–#6, all created 2026-05-20 |
| Agent Teams "15 PRs landed" | `ai-workflow-systems-inventory.md` §7; eras artifact §02 era 7 | **23 PRs opened 2026-04-14, 21 merged.** The 15 figure is `Knowledge-Base/wiki/topics/claude-code-agent-teams.md` counting the first overnight run (#1–#16) only; #18–#23 were a later Tier-B batch the same day |

One correction runs the other way — the eras artifact's closing recommendation says Sandcastle has
"ten offline macOS runners still registered." **The GitHub registrations are gone**
(`gh api repos/collod873/sandcastle/actions/runners` → `total_count: 0`). The one still-registered
runner in the estate is crewops', not Sandcastle's. Whether the LaunchAgents remain on the iMac is
a separate question this machine cannot answer.

---

## Method

Every `runs-on:` value came from `grep -rn "runs-on"` over the working clone's
`.github/workflows/`. Commit shas and dates came from `git log --format='%h %ad %s' --date=short`
in each clone, with `--diff-filter=A` and `--reverse` to find first appearances and
`git show --stat` to confirm what a commit touched. Issue and PR facts came from `gh issue list` /
`gh pr list` with `--state all` and explicit `--json` fields, never from a cached count. Runner
registrations came from `gh api repos/{owner}/{repo}/actions/runners`. Machine facts came from
`uname -a`, `lscpu`, and `~/.claude/settings.json` on this machine on 2026-08-21.

Throughput, compute, cost and CI-reliability figures are quoted from
`General-Repo/lumaria-shipping-model-vs-sandcastle-2026-08-21.md` and
`General-Repo/lumaria-ci-performance-2026-08-21.md` and were not re-derived; both state their own
method, and both note that era-5-vs-6 volume comparisons are directional rather than controlled
because the two eras did different kinds of work.

The narrative spine is `General-Repo/ai-workflow-systems-inventory.md` and
[`artifacts/seven-workflow-eras.html`](../../artifacts/seven-workflow-eras.html) (published as
[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)); the
adoption law and the insulation argument are
`General-Repo/agentic-os-design.md` and
`General-Repo/handoff-agentic-os-controlplane-2026-07-07-premise-locked.md`.
