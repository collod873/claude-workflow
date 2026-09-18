# Rule census: where every rule lives, 2026-09

Researches: #647, a child of map #646. Read against trunk `8587d4f`; captured 2026-09-16.

The question: where does every rule in this machine live today, and which rules are written
twice, contradict each other, or sit in the wrong place? Each mechanism is placed on the grid from
[ADR-0193](../adr/0193-a-rule-is-placed-at-the-highest-rung-that-can-hold-it-and-th.md): a
**rung** (impossible, repaired, refused, reported, taught) and a **venue** (terminal, turn,
stop, push, lane, CI). This file holds facts and candidates only. Every ruling belongs to the owner.

## Summary

- **Size.** 240 census rows, many of them folding several rules, cover hooks, the gauntlet and its
  meters, validators, landings, the reconciler, CI workflows and the taught prose. Most rules the implementer and slicer
  prompts teach also have a machine twin. The prompts usually restate that twin rather than read it.
- **Five items, ranked by what they cost if left alone.** The ranking weighs the map's goals: dead
  runs and owner stops first, then quality.
  1. **A rebase conflict at landing throws away a finished run.** The landing commits, rebases
     and throws before its push (`aw/shared/implementation-landing.ts:98-100`). The red-gate path
     beside it pushes "so the work is not lost" (`aw/shared/implementation-landing.ts:184`). The
     map records nine green runs lost this way on 2026-09-16.
  2. **The slicer is taught graph shapes that the gates and scheduler contradict.** The
     chain-shape ladder has a prefactor land as its own slice
     (`aw/to-tickets/references/chain-shape.md:7`), and knip refuses a lone export with no
     production caller (`knip.config.ts:86-93`). Both ladder copies also teach a blocking edge
     for a shared file (`chain-shape.md:8`, `.claude/skills/to-tickets/SKILL.md:58`), which
     ADR-0199 and `docs/agents/ticket-format.md:99-102` forbid.
  3. **Some holds are never cleared, or carry contradictory labels.** A refused to-tickets run
     gets `needs-human` that nothing clears (`wf/to-tickets.yml:61-63,130`;
     `aw/shared/labels.cli.ts:23-25`). A mechanic fence refusal ends wearing both `needs-human`
     and `queued` (`aw/mechanic/mechanic.ts:233`, `aw/shared/labels.cli.ts:20-21`). Integrate
     escalates a red Verify to the owner while the fixer is already repairing it
     (`aw/integrate/integrate.ts:343-346`, `wf/verify.yml:84-111`). Five lanes stamp a
     green label and have no hand-over step, although `docs/agents/venues.md:22-25` says none
     do.
  4. **The review lane probably drops every real finding.** Its structural refusal keeps a
     finding only when the finding's `path:line` text appears verbatim in raw `git diff` output
     (`aw/review/structural-refusal.ts:9-16`, `aw/review/review.ts:148`). A unified diff
     contains no `path:line` tokens. `gh issue list --label lane-07-finding --state all` returns
     no issues, against 23 review runs (`docs/agents/lane-map.md:231`).
  5. **In this checkout, `gh issue close` is not gated.** The machine-global close gate lets a
     close through when the repo ships its own copy of the gate
     (`hk/close-gate.py:304-309,397-400`). The repo copy is registered nowhere, because
     `.claude/settings.json:1-3` holds no hooks. The hooks census found 11 closes let through with
     that verdict in `~/.claude/logs/close-gate-2026-09-1{4,5,6}.jsonl` (not re-read here).
     Separately, four skills teach a bare close that the gate refuses (see Contradictions C9).
- **Charting evidence** is re-checked below. Four items changed: where hooks are registered, the
  immutable-set readers, the note-ADR count, and a second definition of "retired" inside
  `prose-drift.ts` itself.

## How to read this file

- Path prefixes: `aw/` = `.Workflow/agent-workflows/`, `wf/` = `.github/workflows/`,
  `hk/` = `.claude/hooks/`. All other paths are relative to the repository root. `~` means the
  workstation home, outside the repo.
- Rungs: **impossible** means the state cannot be expressed. **repaired** means a machine fixes it
  silently. **refused** means a machine blocks the action. **reported** means a machine tells or
  labels but does not block. **taught** means only prose holds the rule.
- Venues: **terminal** is the command itself, including PreToolUse hooks and CLIs that refuse.
  **turn** is PostToolUse. **stop** is the Stop hook. **push** is pre-push, i.e.
  `bin/gauntlet push`. **lane** is an Actions lane job, its agent or its landing code. **CI** is
  `verify.yml` plus the scheduled or evented counters.
- `UNPLACED` in a table means the mechanism fits no cell. Those rows are collected under
  [Unplaced](#unplaced).
- Item IDs (D1, C1, M1, U1) are stable handles for the tickets that follow.

## Charting evidence, re-checked

These items were gathered at charting against `783d250` and re-checked on `8587d4f`.

| Charting claim | Status on 8587d4f | Source |
|---|---|---|
| Hooks live in `.claude/settings.json` | **Changed.** The repo file holds only `$schema`. Hooks are registered in `~/.claude/settings.json`, which runs `dispatch.py <Event>`, which reads `hk/roster.json`. The dispatcher runs from the clone at `~/.agents/workflow`, so a hook edit takes effect only after it lands on main and SessionStart refreshes that clone. | `.claude/settings.json:1-3`; `~/.claude/settings.json:117-201`; `hk/roster.json`; `hk/clone-refresh.py:78,95` |
| The rooting rule is written four times, and slice:41 says the publisher refuses | **Confirmed.** It sits at `aw/to-tickets/slice/prompt.md:41`, `aw/to-tickets/repair/prompt.md:6-8`, `aw/implement/implementer/fresh-eyes.md:72-73` and `docs/agents/ticket-format.md:74,130`. It is also in two refusal texts at `aw/shared/render-body.ts:116-118,127-130`. slice:41 still says "The publisher refuses the whole plan for an unrooted path". `repairUnrootedClaims` now roots a claim that has exactly one candidate, so the sentence is true only for prose paths, zero or many candidates, and new files. | `aw/shared/render-body.ts:178-213`; `aw/to-tickets/slice-and-publish.ts:48-54`; `aw/to-tickets/publish-issue-graph.cli.ts:59` |
| The immutable set is spelled out in five prompts and three code messages, and only `render-body.ts:62` reads `IMMUTABLE_SET` | **Confirmed, with one addition.** The prompts are `aw/fixer/prompt.md:9`, `aw/implement/implementer/fresh-eyes.md:40`, `aw/implement/implementer/prompt.md:73`, `aw/mechanic/prompt.md:29` and `aw/ratify/prompt.md:112`. The code messages are `aw/shared/implementation-landing.ts:176`, `aw/watchdog/walk-home.ts:175` and `aw/ratify/land.ts:100`. The addition: `aw/mechanic/mechanic.ts:127` also injects the derived `MECHANIC_FENCE`, which its own prompt then restates. The set is also spelled out in `docs/agents/ticket-format.md:93` and `CONTEXT.md:155`. | as cited |
| The chain-shape ladder is written twice, and the copies disagree about a prefactor | **Confirmed.** The skill copy now sits at `.claude/skills/to-tickets/SKILL.md:55-59`. `chain-shape.md:7` says "an independent prerequisite slice"; SKILL.md:57 says "it ships with its first real consumer". | `aw/to-tickets/references/chain-shape.md:3-9` |
| `literal-in-prose.test.ts` checks one constant in two files | **Confirmed.** It checks only the numeric keys of `ticket-shape.rules.json`, which today is just `claimLimit`, in the slice and audit prompts. It misses "nine-file" (claimLimit+1) at `slice/prompt.md:44` and `ticket-format.md:89`. The ADR-0193 reversal's "`claimLimit`'s value spelled out in two lane prompts" is stale: neither prompt spells the value. | `aw/shared/literal-in-prose.test.ts:32-45,67-76` |
| knip vs a prefactor landing alone | **Confirmed.** See C1. | |
| `claimLimit` vs claiming a shared hub file | **Mechanism lines confirmed.** The mechanism changed: overlap is now logged, not edged, and serialised at dispatch. See C3. | |
| The red gate pushes to save work (`:185`) while a conflict pushes nothing (`:99`) | **Confirmed.** `:184` is the note text and `:98-100` is commit → rebase → push. | `aw/shared/implementation-landing.ts` |
| ADR-0110 (edits outside a claim) vs ADR-0199 (scheduling by claims) | **Confirmed.** See C4. | |
| `fresh-eyes.md:77` shows a path of the form its line 72 forbids | **Confirmed.** The example is `"shared/retry.test.ts"` against "from the repository root; a shortened path matches nothing". `aw/implement/implementer/prompt.md:121` repeats the same example. | `aw/implement/implementer/fresh-eyes.md:72-73,77` |
| `prose-drift.ts` retires only `superseded` ADRs; about 15 live lines cite note-status ADRs | **Partly changed.** `isRetired` counts `superseded` or any ADR a successor supersedes (`:76-78`). The same file's `deletedPathMentions` treats every non-`constraint` ADR as retired (`:140`), and so does `adr-index.ts:88-90`. Running drift's own citation regex and never-live filter over `git ls-files` finds **10** live lines citing a `note` ADR, not 15. The corpus holds 111 constraint, 43 note and 45 superseded ADRs. | `aw/shared/prose-drift.ts:24-25,76-78,140` |

## Census

One row per rule. A script that holds four rules gets four rows. Where rows would repeat one
mechanism, a single row cites every line.

### Hook wiring and hooks

| Mechanism | Rung | Venue | Rule it holds | Source |
|---|---|---|---|---|
| global registration | repaired | UNPLACED (SessionStart) | Each roster event gets exactly one `dispatch.py <Event>` entry, rewritten from the roster by link-workstation, which clone-refresh runs | `~/.claude/settings.json:117-201`; `bin/link-workstation:98-105,129`; `hk/clone-refresh.py:95-96` |
| dispatch.py | refused | terminal/turn/stop | Any roster hook exiting 2 makes dispatch exit 2 | `hk/dispatch.py:101-103` |
| dispatch.py | reported | all | A hook exiting non-0/2, printing a traceback, or missing from disk is broken: its stderr is forwarded and dispatch exits 1 | `hk/dispatch.py:28-29,84-85,112-113` |
| dispatch.py | refused | all | Each hook gets 300s, run serially; a timeout counts as broken | `hk/dispatch.py:12,98` |
| dispatch.py | reported | all | JSON outputs merge first-wins per key; only `additionalContext` concatenates; plain text is appended after the JSON | `hk/dispatch.py:45-52,78-79` |
| `_hook.deny` | refused | terminal | Every deny carries `[hook]` | `hk/_hook.py:30` |
| `_harness.spoken` | refused | push | Hook message channels open with `[hook]`; only four test files call it | `hk/_harness.py:79` |
| clone-guard.py | refused | terminal | Edit-family tools may not write inside `~/.agents/workflow` (Bash writes are not covered) | `hk/clone-guard.py:13,31,47` |
| credential-scan.py | refused | terminal | Edit/Write content may not match 13 secret patterns unless the value holds a placeholder word; `.env.example`-style files are exempt | `hk/credential-scan.py:23,28,61,66,75` |
| adr-gate.py | refused | terminal | No hand-numbered `docs/adr/NNNN-*.md` (use `new-adr --land`); no hand edit of `docs/adr/INDEX.md`; enrolled repos only | `hk/adr-gate.py:49,51-52,59` |
| validate-bash.py | refused | terminal | No `cat` of `.env` files | `hk/validate-bash.py:22,94` |
| validate-bash.py | refused | terminal | No reading `.git/` internals | `hk/validate-bash.py:100` |
| validate-bash.py | refused | terminal | No `gh issue create`; use `file-issue` | `hk/validate-bash.py:103` |
| validate-bash.py | refused | terminal | `gh issue close` runs alone, never compounded | `hk/validate-bash.py:112-115` |
| validate-bash.py | refused | terminal | No GitHub closing keyword in a commit message or PR body | `hk/validate-bash.py:60,121` |
| validate-bash.py | refused | terminal | No cat/grep/tree into `node_modules`, `dist` or `build` without `--exclude-dir` | `hk/validate-bash.py:138-146` |
| close-gate.py | refused | terminal | `gh issue close`, including its API and GraphQL forms, needs a `## Closing record` (inline or latest comment); enrolled repos only | `hk/close-gate.py:80,374,430-432` |
| close-gate.py | refused | terminal | The record carries a range line, `No diff.` or `Superseded by #N`, using the grammar from `closing-record.rules.json` | `hk/close-gate.py:67,243-246` |
| close-gate.py | refused | terminal | `No diff.` is refused when the body has a criteria heading | `hk/close-gate.py:223,237` |
| close-gate.py | refused | terminal | One bullet per `- [ ]` criterion; an empty criteria heading is refused | `hk/close-gate.py:182-204` |
| close-gate.py | refused | terminal | Fails closed when gh is missing, the gh call fails or the number is unparseable | `hk/close-gate.py:408,418,424` |
| close-gate.py | repaired (exempt) | terminal | A close as not_planned or duplicate passes; a repo that ships its own gate passes | `hk/close-gate.py:90,304-309,397-403` |
| checklist-reminder.py | reported | turn | An edited .md/.txt with 1-30 unchecked items tells the agent to tick them | `hk/checklist-reminder.py:8,43,47` |
| post-edit-validate.py | reported | turn | Edited .py, .js, .json and .html must parse | `hk/post-edit-validate.py:8,16,26,67,90` |
| md-html-refresh.py | repaired | turn | An edited .md with a sibling .html is re-rendered; errors only reach the log | `hk/md-html-refresh.py:57,73,87` |
| circuit-breaker.py | reported | turn | Warns at 3 consecutive tool failures, "stop" at 5 (advice only); resets on success or SessionStart | `hk/circuit-breaker.py:12-14,86,95,118` |
| gauntlet.sh → gauntlet-hook.mjs | reported | turn | An edited .ts/.mts/.cts runs `bin/gauntlet turn`; failures come back as `decision: block`; skipped for stage sessions or with no contract; not limited to enrolled repos | `hk/gauntlet.sh:11`; `hk/gauntlet-hook.mjs:31-39,54`; `hk/gauntlet-report.mjs:17` |
| clone-refresh.py | repaired | UNPLACED (SessionStart) | The workstation clone fast-forwards to origin/main, with `npm ci` on a lockfile change and `link-workstation --apply` | `hk/clone-refresh.py:78,92,95,104` |
| clone-refresh.py | reported | UNPLACED (SessionStart) | Prints `CLONE STALE` when the clone is off main, dirty, diverged or unfetchable | `hk/clone-refresh.py:50,55,59` |
| session-brief.py | reported | UNPLACED (SessionStart) | Injects open PRDs, owner-family tickets, the next by-hand ticket, the delta since last session and live sessions; capped at 30 lines | `hk/session-brief.py:15,30,85,151,164,187,235,361` |
| stop-fire-log.py | reported | stop | Logs every Stop | `hk/stop-fire-log.py:59,75` |
| stop-gate.py | refused (once) | stop | In enrolled repos, the contract's `stop.cmd` must be green at turn end; it blocks once, then hands back | `hk/stop-gate.py:16,134-138,250,332,370-377`; `.claude/contract.json:2-5` |
| stop-gate.py | refused (once) | stop | A contract with bad JSON, no `stop` slot or no `cmd` refuses (`cmd: null` opts out); a Stop with no session_id refuses | `hk/stop-gate.py:74,91,295-315,323` |
| stop-gate.py | reported | stop | A red check is DEFERRED while background tasks run, NOT YOURS in a no-edit session while another is live, and UNRESOLVED after a second failure | `hk/stop-gate.py:134-136,261,273,357-364` |
| log-stop-failure.py | reported | stop | API errors are logged and sent as a desktop notification | `hk/log-stop-failure.py:22,27` |
| auto-approve-permissions.py | repaired | UNPLACED (PermissionRequest) | Every permission prompt is allowed except AskUserQuestion, ExitPlanMode and MCP auth | `hk/auto-approve-permissions.py:7,32` |
| session-capture.sh / -hook.mjs | reported | UNPLACED (SessionEnd) | The transcript goes to the KB, the session record to notes ref `sessions`, and a `session-captured` dispatch rings | `hk/session-capture.sh:14,43-49`; `hk/session-capture-hook.mjs:147,171,199,257,266` |
| session-end.py | reported | UNPLACED (SessionEnd) | Snapshots prd, needs-human and by-hand tickets for the next brief's delta | `hk/session-end.py:14,62,79,97,122` |
| .husky/pre-push | refused | push | Every push except a notes-only push runs `npm run check` (`--no-verify` skips it) | `.husky/pre-push:1-11`; `package.json:12` |

### Contract, gauntlet and static checkers

| Mechanism | Rung | Venue | Rule it holds | Source |
|---|---|---|---|---|
| venue-slots.json | impossible | turn/stop/push | turn and stop run typecheck, lint_one and test_related; push runs typecheck, lint, rules, test, clones, adrs and drift | `aw/shared/venue-slots.json:2-4`; `bin/gauntlet:19-30` |
| contract.json | impossible | all | A slot names one command; a slot the contract lacks or leaves empty is skipped, so a repo can shrink its gate but never grow it | `.claude/contract.json:1-50`; `bin/gauntlet:72` |
| gauntlet unknown venue | refused | terminal | A venue missing from venue-slots.json exits 1 | `bin/gauntlet:22-27` |
| gauntlet lock | impossible | push | One push gate per machine; the rest queue | `bin/gauntlet:32-36` |
| gauntlet `eslint --fix` | repaired | turn/stop/push | Autofixable lint is rewritten before the slots run (at push: the whole tree, never committed) | `bin/gauntlet:54-58` |
| gauntlet verdict | refused | turn/stop/push | Any non-zero slot is red, and every red slot is named | `bin/gauntlet:80-98` |
| check-contract.ts | taught | lane | The implementer brief lists every slot with a non-empty cmd | `aw/shared/check-contract.ts:21-50`; `aw/implement/implement.ts:231` |
| tsc | refused | turn | Strict typing | `tsconfig.json:10-11` |
| eslint recommended + sonarjs | refused | turn | typescript-eslint recommended; no identical functions | `eslint.config.js:33,43-44` |
| eslint quotes | repaired | turn | Double quotes | `eslint.config.js:45` |
| eslint inline reason | refused | turn | Use `reason()`/`errorMessage()`, not an inline `instanceof Error ?` | `eslint.config.js:8-15,47` |
| eslint repo paths | refused | turn | `repos/{owner}/{repo}` paths go only through `gh-paths.ts` | `eslint.config.js:17-27,47` |
| eslint child_process | refused | turn | Only a `.proc` test imports `node:child_process` | `eslint.config.js:50-68` |
| eslint test readFileSync | refused | turn | A test may not `readFileSync` repo source, `.github/`, `.md`, `.yml` or `bin/` (gate-size exempt) | `eslint.config.js:77-87,98-103` |
| eslint fake-gh names | refused | turn | No local fakeGh/createFakeGh/stubGh/makeGh | `eslint.config.js:88-94` |
| knip | refused | push | No unreachable file or export; no baseline; a test import doesn't count | `package.json:14`; `knip.config.ts:86-111`; `CLAUDE.md:20-24` |
| knip tags | refused | push | A hook/bin `.mjs` is an entry only with `@shell`; a fake/fixture/stub/setup file is ignored only with `@fixture`; a spawned binary only with `@shell spawns` | `knip.config.ts:29,35-45,64-84,100,109-110` |
| dependency-cruiser | refused | push | No lane imports another lane; shared/ imports no lane; no cycles | `.dependency-cruiser.cjs:2-54` |
| jscpd | refused | push | Zero TypeScript clones of 50+ tokens and 5+ lines; no baseline | `package.json:27-44` |
| bin/lint bare paths | refused | push | Skills spell `.claude/hooks/` and `~/bin/…`, never bare | `bin/lint:17-40` |
| bin/lint hook harness | refused | push | Hook tests don't hand-roll subprocess calls; only `_hook.py` spells the deny envelope, the edit-tool roster, the stdin read, the sys.path splice and append-mode opens; every `_hook.py` def is tested in `test__hook.py` | `bin/lint:42-43,48-96` |
| bin/lint magic timeout | refused | push | No literal `timeout=` in hooks or bin | `bin/lint:72-73` |
| bin/lint dispatch convention | refused | push | No .md outside `docs/adr` restates ADR-0168's four phrases | `bin/lint:45-46` |
| bin/lint adr-corpus | refused (exit 2 passes) | push | `adr-check` `finding:` lines fail the slot | `bin/lint:98-103` |
| adr_shape.validate | refused | push, terminal | Frontmatter with date, status (constraint/note/superseded) and a non-empty reversal; an H1 of 4+ words; body ≤150 words | `bin/adr_shape.py:8,10,148-177` |
| adr_shape.validate | reported (dropped at push) | terminal | A constraint's reversal must not read cheap; its Rejected line must not be "doing nothing" | `bin/adr_shape.py:32-39,75-80,180-186` |
| adr-check | refused | push | One number per ADR; a cited ADR up to the highest number must exist | `bin/adr-check:163-180` |
| new-adr | refused / impossible / repaired | terminal | Landing needs a `**Rejected:` line; the number is max(disk, origin/main, HEAD)+1; INDEX is regenerated | `bin/new-adr:79-105,113-123,170-174,193` |
| adrs slot | refused | push | `docs/adr/INDEX.md` equals its render | `aw/shared/adr-index.cli.ts:9-20`; `aw/shared/adr-index.ts:81-90` |
| drift: retired citations | refused | push | Live prose may not cite a superseded ADR or one a successor supersedes | `aw/shared/prose-drift.ts:76-102` |
| drift: stamps | refused | push | `superseded_by` must be reciprocated, and `superseded` needs a successor | `aw/shared/prose-drift.ts:104-117` |
| drift: deleted paths | refused | push | Live prose and live-ADR reversal lines don't name a path deleted since the merge-base | `aw/shared/prose-drift.ts:131-159`; `aw/shared/prose-drift.cli.ts:25-36` |
| CODING_STANDARDS.md | taught / reported | lane | Nine entries are injected into briefs and read by the violation lens; a malformed entry is silently skipped | `CODING_STANDARDS.md:17-44`; `aw/mechanic/mechanic.ts:21`; `aw/observations/run-audit.ts:128`; `aw/shared/standards.ts:29-35` |
| verify.yml Immutability | refused | CI | A PR whose declared `changed_files` touch the immutable set, or are empty, is red | `wf/verify.yml:24-44`; `aw/integrate/immutability.ts:15-19,37-47` |
| verify.yml actionlint | refused | CI | Workflow YAML passes actionlint, run over the machine checkout at `machine_ref` | `wf/verify.yml:65-69` |
| verify.yml Gauntlet | refused | CI | `npm run check` on the target; skipped when Immutability failed | `wf/verify.yml:77-82`; `aw/integrate/gate.ts:8-23` |
| verify.yml signal | reported | CI | Red rings `fixer-needed`, green rings `review-wanted` | `wf/verify.yml:84-141`; `aw/integrate/signal.ts:27-41` |

### Meter tests (all refused at push via the `test` slot)

| Mechanism | Rule it holds | Source |
|---|---|---|
| gate-size | Every GATE_FILES entry exists, and their total is ≤1157 lines (837 measured) | `.claude/gate-size.test.ts:8,15-25`; `aw/shared/gate-files.ts:3-19` |
| literal-in-prose | Numeric keys of `ticket-shape.rules.json` are not spelled as ceilings in the slice and audit prompts | `aw/shared/literal-in-prose.test.ts:32-45,67-76` |
| prose-gate | No comments or docstrings across code roots; a knip-tagged comment is ≤5 lines; a Python module docstring passes if the file reads `__doc__` | `aw/shared/prose-gate.test.ts:43-48`; `aw/shared/prose.ts:10-12,46-48,59,78-80,106-113` |
| prompt-skeleton | Structured-output skeletons parse under their schema; slice/audit JSON maxLength equals SLICE_CAPS; the prompts **must spell** each SLICE_CAPS value | `aw/shared/prompt-skeleton.test.ts:77-140` |
| labels-doc / labels-catalogue | `pipeline-labels.md` regenerates byte-identically from the catalogue | `aw/shared/labels-doc.proc.test.ts:25-27`; `aw/shared/labels-catalogue.test.ts:65` |
| labels | Descriptions ≤100 chars; LADDERED_LANES matches the run-title regex | `aw/shared/labels.test.ts:59,193` |
| ticket-format-doc (shared) | Each `ticket-format.md` variant example passes the Python validator | `aw/shared/ticket-format-doc.proc.test.ts:40-63` |
| ticket-format-doc (hooks) | `ticket-format.md` contains "immutable set" | `hk/ticket-format-doc.proc.test.ts:8-15` |
| test_ticket_templates.py | Variant examples pass `validate()` (a second suite for the same rule) | `hk/test_ticket_templates.py:225` |
| ticket-shape.rules.proc | Both validators compile the grammar from the one rules file | `aw/shared/ticket-shape.rules.proc.test.ts:68-100` |
| closing-record.rules | The rules file spells the heading, `No diff.` and three disjoint grammars; writers read them | `aw/shared/closing-record.rules.test.ts:82-130` |
| immutable-set | `IMMUTABLE_SET` equals `immutable-set.json` (cannot fail: it compares a file with its own import) | `aw/shared/immutable-set.test.ts:31-37`; `aw/shared/immutable-set.ts:1,8` |
| venues-doc | Slot lists as typed in the test; `venues-doc --check` passes | `aw/shared/venues-doc.proc.test.ts:24-60,101-117` |
| edge-writer-gate | No bin file spells `dependencies/blocked_by`; only `tracker-gh.ts` imports `blockedByPath` | `aw/shared/edge-writer-gate.test.ts:28-47` |
| lane-invariants | Claude jobs preflight the token; target-writing lanes install target deps; failure reactions cover cancelled; Actions reads are GETs; every dispatch wire has sender and receiver; reusables declare runner and machine_ref | `aw/shared/lane-invariants.test.ts:46-245` |
| lane-map | Map lanes equal LANE_WIRING keys; every rung event has a ringer and a waker | `aw/shared/lane-map.test.ts:12-14,47-50` |
| lane-wiring / lane-emit / lane-identity | Committed workflows equal what LANE_WIRING emits; permissions and concurrency match; the only `if:` is `always()`; four lanes wake the reconciler on every ending | `aw/shared/lane-wiring.test.ts:84-432`; `aw/shared/lane-emit.test.ts:7-8`; `aw/shared/lane-identity.test.ts:33,65,88` |
| workflow-permissions | Jobs grant the writes they perform; spend lanes never `cancel-in-progress: true` and declare a group; checkout-less jobs set GH_REPO | `aw/shared/workflow-permissions.test.ts:16-35,267-275,324-367,391-406` |
| runner-committer | A workflow reaching `git notes add` configures a committer | `aw/shared/runner-committer.test.ts:131-141` |
| canary-graph-triggers | Canary stub `on:` equals its lane's doors | `aw/shared/canary-graph-triggers.proc.test.ts:32-45` |
| duplication-ownership-adr | Some ADR names the three sanctioned duplicates | `aw/shared/duplication-ownership-adr.proc.test.ts:36-46` |
| author-prompt-pin | Author title grammar equals `authoredTicketTitleRe`; house rules mention their six topics | `aw/acceptance/author-prompt-pin.test.ts:33-64` |
| fails-marker-pin | The implement marker regex equals `bin/close-ticket` FAILS_LINE_RE | `aw/shared/fails-marker-pin.test.ts:30-36` |
| enrolment-doc | `enrolment.md` names four required strings | `.Workflow/enrolment-doc.proc.test.ts:23-31` |
| seeded-docs | Pointer docs <1000 bytes; the WORKSTATION_CLONE pair agrees (pinned twice) | `aw/enrol/seeded-docs.test.ts:16-38`; `aw/enrol/seeded-docs.proc.test.ts:18-37` |
| adr-0036 | ADR-0036 contains "never", "delet" and "diff" | `aw/review/adr-0036.proc.test.ts:10-19` |
| wired | Every observations/ export has a caller outside its own test | `aw/observations/wired.test.ts:87-99` |
| closed-set-exit | The immutable refusal names `immutable-set.json`; gauntlet names `venue-slots.json` | `aw/shared/closed-set-exit.proc.test.ts:21-34` |
| lint-slot | A slot runs `bin/lint`, and push lists it; slugs equal LIVE_SLUGS; ticket-format and ADR-0174 wording | `hk/lint-slot.proc.test.ts:12-27,42-53,69-84` |
| check-contract | `stop.why` names stop-gate.py; every `why` path exists; events are in the roster; every cmd resolves | `aw/shared/check-contract.test.ts:170-193` |
| gauntlet.test / gauntlet.proc | Repo settings has no hooks; roster PostToolUse has gauntlet.sh and Stop doesn't; EDIT_TOOLS equals `_hook.EDIT_TOOLS` | `hk/gauntlet.test.ts:10-14`; `hk/gauntlet.proc.test.ts:178-182,643-660` |
| adr-check.proc / adr-shape.proc / adr-index.tooling | The corpus is clean; `test_adr.py` passes; `npm run adrs` exits 0 | `hk/adr-check.proc.test.ts:93-106`; `hk/adr-shape.proc.test.ts:155-165`; `aw/shared/adr-index.tooling.proc.test.ts:58-107` |
| spec-format-mirror | The `~/.agents` clone's `spec-format.md` is byte-equal (skipped when absent) | `aw/shared/spec-format-mirror.test.ts:10-12` |
| vocabulary-pin | Lane 03's injected vocabulary carries six CONTEXT.md entries verbatim | `aw/to-tickets/vocabulary-pin.test.ts:8,21-30` |
| render-body.proc drain grep | drain SKILL.md says close-ticket resolves like close-gate.py | `aw/shared/render-body.proc.test.ts:80` |
| gh-paths | No `*PathMatcher` export | `aw/shared/gh-paths.test.ts:142-150` |

### Rules sources, filing and closing validators

| Mechanism | Rung | Venue | Rule it holds | Source |
|---|---|---|---|---|
| ticket-shape.rules.json | (source) | - | `claimLimit` (8), grammar fragments and refusal texts | `aw/shared/ticket-shape.rules.json:2-33` |
| closing-record.rules.json | (source) | - | Heading, `No diff.`, range/bullet/superseded grammars | `aw/shared/closing-record.rules.json:1-9` |
| immutable-set.json | (source) | - | `["vitest.config.ts", ".github/"]` | `aw/shared/immutable-set.json:1` |
| labels.json | (source) | - | Label names, colours, descriptions and families | `aw/shared/labels.json` |
| file-issue kinds | refused | terminal | Kind is note, question, ticket or spec; a question needs `## Question` | `bin/ticket_shape.py:312-325` |
| ticket shape | refused | terminal | A ticket needs `## Acceptance criteria` with `- [ ]` items and `## Files claimed` | `bin/ticket_shape.py:328-333` |
| claim entries | refused | terminal | No glob; at most `claimLimit` entries | `bin/ticket_shape.py:335-341` |
| tracker check | refused | terminal | A ticket's check may not run gh, curl or wget | `bin/ticket_shape.py:352-353` |
| ticket warnings | refused unless `--ack` | terminal | Malformed/missing marker, whole-repo contract cmd, unresolved word, sh-unparseable, near-neighbour path, migration without post-state, already-green check | `bin/ticket_shape.py:345-361,441-456,510-555`; `bin/file-issue:226-241` |
| rooting at file-issue | reported (partial) | terminal | Only an extra or misplaced segment holds; a truncated prefix or bare basename files advisory | `bin/ticket_shape.py:430-438,455-466` |
| spec shape | refused | terminal | Exactly one criterion, a well-formed marker, a resolvable word, sh-parseable, red at filing | `bin/ticket_shape.py:366-385` |
| `--test` handoff | refused | terminal | Each criterion index has a `#?.i` `test.fails` title | `bin/file-issue:132-159` |
| ticketify | refused | terminal | A degenerate claim (`.`/`**`) is refused; criteria aren't replaced without `--replace` | `bin/file-issue:361-366,394-400` |
| by-hand label | reported (label) | terminal | A workstation, immutable-set or cross-repo claim is labelled `by-hand` | `bin/file-issue:295-296,537-538`; `bin/ticket_shape.py:52-57` |
| file-issue repairs | repaired | terminal | Spec title gets `PRD: ` (case-sensitive); questions get the exit line; `#?.` is renumbered; labels are forced to file-issue's own colours | `bin/file-issue:100-104,117-122,162-165,269-278,531-533` |
| close-ticket | refused | terminal | Range is `BASE..HEAD`; no `test.fails(` naming #N survives; the successor is open; one disposition per criterion; spec children delivered | `bin/close-ticket:362-390,565-573,636-715` |
| close-ticket | refused | terminal | `No diff.` only with zero commits; any unparseable `check:` aborts; a nonzero check aborts; spec MET needs stdout; all-unverified doesn't close | `bin/close-ticket:463-551` |
| close-ticket | reported | terminal | The record carries Immutability and Verify verdicts | `bin/close-ticket:265-316,560-562` |

### Publishers, doors and landings

| Mechanism | Rung | Venue | Rule it holds | Source |
|---|---|---|---|---|
| plan schema | impossible | lane | whatToBuild ≤400, whyNotMerged ≤200, criterion ≤200, title ≤200, ≥1 criterion, ≥1 slice | `aw/shared/plan-schema.ts:4-22` |
| validatePlan | refused | lane | No self-edge, nothing out of range, no cycle, ≥1 root; each rendered body passes `assertTicketShape` (forward edges are not refused) | `aw/shared/validate-graph.ts:12-74`; `aw/shared/ticket-shape.ts:181-184,202-222` |
| criterionProblem | refused | lane | One line, a parseable `check:` marker, no tracker read | `aw/shared/render-body.ts:13-27` |
| validateClaimsAreMutable | refused | lane | No slice claims an immutable-set path | `aw/shared/render-body.ts:54-71` |
| validatePathsAreRooted | refused | lane | Claims and prose paths start at a top-level entry or suffix a path this slice claims | `aw/shared/render-body.ts:109-136` |
| repairUnrootedClaims | repaired | lane | An unrooted claim is rooted when exactly one top-level entry resolves it; the repair is printed before filing | `aw/shared/render-body.ts:178-213`; `aw/to-tickets/slice-and-publish.ts:48-64` |
| plan repair round | refused → agent repair | lane | A refused plan gets one resume round, then the run ends | `aw/to-tickets/to-tickets.ts:65-76`; `aw/to-tickets/repair/prompt.md:1-12` |
| overlap without edge | reported | lane | Overlapping unedged claims are logged, not edged (ADR-0199) | `aw/to-tickets/publish-issue-graph.cli.ts:30-46` |
| verifyBlockedByGraph | refused | lane | Published blocked-by edges read back | `aw/shared/publish-sub-issues.ts:39-57` |
| to-tickets entry | refused | lane | A PRD that already has sub-issues, or is nested, gets a comment, `slice-failed` and exit 1 | `wf/to-tickets.yml:54-87` |
| spec publish | refused / repaired | lane | A new spec body passes `validate("spec")`; the title gets `PRD: ` (case-insensitive) | `aw/spec/validate-spec.ts:36-38`; `aw/spec/publish.ts:64-67,81` |
| spec reconcile | refused / repaired | lane | Fewer criteria are refused; `## Assumptions` is rewritten from the resolutions | `aw/spec/reconcile.ts:31-46,72-79` |
| spec by-hand | refused | lane | A by-hand PRD stands down before the critic | `aw/spec/spec.ts:174-178` |
| shape refusal | refused | lane | A duplicate #N or a ruled ADR ends shaping with a comment and `shape-refused` | `aw/shape/refusal.ts:16-27`; `aw/shape/shape.ts:206-212` |
| shape caps | refused / repaired | lane | More than 5 decisions → live session; one re-sweep; prior art and survivors truncated to 3; over half marked forces long | `aw/shape/sheet.ts:3-7,15-24,38-41`; `aw/shape/shape.ts:223-235` |
| shape accept | refused / repaired | lane | Approval needs a sheet; an ADR is filed only with title, mark and reversal; an existing term is skipped | `aw/shape/accept.ts:61-68,107,142-146` |
| review structural refusal | refused (silent drop) | lane | A finding survives only if its `path:line` text appears in the diff | `aw/review/structural-refusal.ts:9-16`; `aw/review/review.ts:40,148` |
| review refuter | repaired | lane | A refusal without `path:line` is ignored, and the finding survives | `aw/review/refuter.ts:18-24` |
| ratify | refused / repaired | lane | A batch may not touch the immutable set (checked twice); the branch's immutable set is realigned to trunk; an eslint rule that misses its own sites is demoted to prose; no PR for an empty batch | `aw/ratify/run-ratify.ts:119`; `aw/ratify/land.ts:96-141`; `aw/ratify/rule-trial.ts:44-69` |
| landing: no-op | reported (needs-human) | lane | An answer identical to trunk opens nothing (ADR-0192) | `aw/shared/implementation-landing.ts:260-264` |
| landing: INDEX | repaired | lane | ADR edits regenerate and stage `INDEX.md` | `aw/shared/implementation-landing.ts:266-269` |
| landing: immutable | refused (pre-commit) | lane | An answer touching the immutable set is not committed; needs-human | `aw/shared/implementation-landing.ts:271-275` |
| landing: rebase conflict | refused, nothing pushed | lane | Commit, rebase throws, no push; needs-human | `aw/shared/implementation-landing.ts:98-100,137-140,277-285` |
| landing: fails rule | refused (post-push) | lane | A `test.fails(` line may only lose `.fails`, and declared paths are exempt; the mechanic is dispatched | `aw/shared/fails-rule.ts:9-37`; `aw/shared/implementation-landing.ts:279,286-293` |
| landing: red gate | reported, pushed anyway | lane | A red gate still pushes and opens the PR, then needs-human | `aw/shared/implementation-landing.ts:184,331-336` |
| mechanic fence | refused (pre-commit) | lane | No CODING_STANDARDS.md, contract.json, immutable set or new gate file; no added `.skip`/`.todo`/`xit` | `aw/mechanic/mechanic.ts:59-61,87-93,230-241`; `aw/shared/gate-files.ts:25-42` |
| fixer | refused | lane | No gate growth; at most 3 attempts; the same failure signature twice stops | `aw/fixer/fixer.ts:26,187-193,204-237` |
| acceptance additive | refused → agent repair ×3 | lane | The author writes only in suite roots, adds only, deletes nothing, names #N; red under `.fails`; a red batch pushes nothing | `aw/acceptance/acceptance.ts:201-232,323-333,384,427-432,472-474` |
| stage denylist | refused | terminal | Checkout-session agents may not run git write commands or gh | `aw/shared/stage.ts:210-227`; `aw/mechanic/mechanic.ts:32-57` |
| spec stage tools | refused | terminal | Author, sweep and reconcile get Read/Grep/Glob only; the shaper gets no tools | `aw/spec/author-contract.ts:3`; `aw/shared/stage.ts:257-260`; `aw/shape/shape.ts:44-57` |

### Labels, reconciler, strikes and lane stops

| Mechanism | Rung | Venue | Rule it holds | Source |
|---|---|---|---|---|
| markLane | repaired | lane | Stamping a green/blue label removes every other one; an out-of-family label throws, and the throw is caught and logged | `aw/shared/labels.ts:75-77,134-143` |
| ensureLabel `--force` | repaired | lane | Each label write first recreates the label from the catalogue | `aw/shared/labels.ts:109-113` |
| escalateToOwner | repaired | lane | Adding `needs-human` strips green/blue labels and may assign the owner | `aw/shared/needs-human.ts:6-16` |
| Enrol label sync | repaired | lane | An enrolled repo's labels are patched to the catalogue | `aw/shared/label-sync.ts:42-50`; `aw/enrol/enrol.ts:221` |
| `fail --lane` (laddered) | repaired | lane | A red/cancelled acceptance, implement or mechanic job puts the ticket back to `queued` | `aw/shared/labels.cli.ts:17-22`; `wf/implement.yml:91-95`; `wf/mechanic.yml:90-94`; `wf/acceptance.yml:158-162` |
| `fail --lane` (other) | reported (hold) | lane | A red/cancelled shape, spec or to-tickets job swaps its label for `needs-human` | `aw/shared/labels.cli.ts:23-25`; `wf/shape.yml:111-115`; `wf/spec.yml:106-110`; `wf/to-tickets.yml:151-155` |
| report-lane-failure | reported | lane | Shape, shape-accept, spec and to-tickets deaths comment; to-tickets adds `slice-failed` | `aw/shared/report-lane-failure.ts:48,62-91` |
| in-flight stamps | reported | lane | Each lane stamps its green label first (4-accepting … 8-landing) | `aw/acceptance/acceptance.ts:450`; `aw/implement/implement.ts:185`; `aw/mechanic/mechanic.ts:177`; `aw/integrate/immutability.ts:21-26`; `aw/fixer/fixer.ts:351`; `aw/review/review.ts:114`; `aw/integrate/integrate.ts:405` |
| closed ticket | refused | lane | Implement and mechanic refuse a closed ticket (they do not check `needs-human`) | `aw/implement/implement.ts:214-217`; `aw/mechanic/mechanic.ts:183-186` |
| to-build door | refused (needs-human) / repaired | lane | A `to-build` ticket must pass `assertTicketShape` and carry a `check:` marker; needs-human is lifted once it passes | `aw/dispatch/ticket-state.ts:294-309`; `aw/dispatch/reconcile.ts:226-255` |
| by-hand stand-down | repaired | lane | A workstation or immutable claim gets `by-hand` and a comment | `aw/dispatch/reconcile.ts:194-219`; `aw/dispatch/ticket-state.ts:321-324` |
| over-wide claim | repaired | lane | A claim over `claimLimit` becomes `to-spec` and rings lane 02 | `aw/dispatch/reconcile.ts:146-192` |
| PRD spec check | reported (hold) / repaired | lane | A PRD with children but no runnable check gets needs-human (raw add); it is removed once runnable | `aw/dispatch/reconcile.ts:468-475,496-499` |
| hold labels | refused | lane | `needs-human`, `by-hand` and `parked` are never dispatched | `aw/dispatch/reconcile.ts:664-677`; `aw/dispatch/ticket-state.ts:349-358` |
| file held by live run | refused (log only) | lane | A ready ticket overlapping a live run, or an earlier dispatch this pass, waits a pass (ADR-0199) | `aw/dispatch/reconcile.ts:602-621,695-705` |
| admission | refused | lane | Startable needs `## Parent PRD`, `to-build`, or a lane label with a valid shape | `aw/dispatch/ticket-state.ts:48,311-333,416` |
| queued/waiting / rollup | repaired / reported | lane | Ready gets `queued`, blocked gets `waiting`; the PRD body carries a rollup line | `aw/dispatch/reconcile.ts:746-792`; `aw/dispatch/rollup.ts:20-46` |
| unreachable slices | reported | lane | One standing issue names ≤10 unreachable slices | `aw/dispatch/reconcile.ts:524-585` |
| degraded read | refused / reported | lane | Unreadable issues, refs or PRs write nothing and exit 1; an unreadable runs API reads every ticket as unstarted | `aw/dispatch/ticket-state.ts:360-398`; `aw/dispatch/reconcile.ts:633-636` |
| wake filter | refused | lane | Issue events wake the reconciler only on `to-build` labelled or a hold unlabelled | `aw/dispatch/reconcile.ts:882-899`; `wf/dispatch-reconcile.yml:34-38` |
| strike detection | reported | lane | A strike is a failed, cancelled or timed-out `Implement/Mechanic/Acceptance #N` run with no strike comment yet | `aw/shared/strikes.ts:18-20,135,164-171`; `aw/dispatch/reconcile.ts:857-869` |
| strike ladder | refused / repaired | lane | Rung 0 implementer, 1 fresh-eyes, 2 mechanic, ≥3 decision (needs-human, owner assigned); acceptance climbs author → author-fresh-eyes | `aw/shared/strikes.ts:4-9,100-126`; `aw/dispatch/reconcile.ts:714-740,871-878` |
| budget timeout | refused + reported | lane | A lane budget aborts the stage and writes a strike comment for any budgeted lane | `aw/shared/lane-budget.ts:1-11`; `aw/shared/stage.ts:344-348,368-407` |
| fixer escalations | refused / reported | lane | Cap, no progress, gate growth, or a Verify failure outside the gate job → needs-human | `aw/fixer/fixer.ts:145-148,204-237` |
| integrate refusals | refused | lane | A rebase conflict, own gauntlet red, or Immutability/Verify failed or unjudged → needs-human | `aw/integrate/integrate.ts:208-230,296-352` |
| integrate drain | repaired | lane | Re-sends `implementation-opened` for the lowest unrefused open implement PR | `aw/integrate/integrate.ts:376-401` |
| concurrency groups | impossible (platform) | lane | One run per group; mechanic shares `implement-N`; reconcile, integrate and the counters run global groups | `wf/implement.yml:20-22`; `wf/mechanic.yml:21-23`; `wf/dispatch-reconcile.yml:24-26`; `wf/integrate.yml:24-26` |
| token preflight | refused | lane | A job installing Claude exits 1 on an empty token, before the TS door | `wf/shape.yml:62-68`; `wf/acceptance.yml:56-62`; `wf/implement.yml:46-52` |
| job timeouts | refused | lane | implement 90, mechanic 90, acceptance 30, fixer 50, review 15, shape 30, spec 30, to-tickets 90, ratify 120 minutes | `wf/implement.yml:27`; `wf/review.yml:32`; `wf/to-tickets.yml:26`; `wf/spec.yml:26` |

### CI counters and watchdogs

| Mechanism | Rung | Venue | Rule it holds | Source |
|---|---|---|---|---|
| walk-home | reported | CI | Failed `*-caller.yml` runs in enrolled repos (7 days) are filed as tickets: machine path → `to-build`, immutable → `by-hand`; ≤5 filed | `aw/watchdog/walk-home.ts:16-22,217-318`; `wf/walk-home.yml:1-31` |
| back-stamp | repaired | CI | An ADR named in a successor's `supersedes:` gets `status: superseded` and `superseded_by:` | `aw/watchdog/back-stamp.ts:18-28,60-99` |
| missing-trailer counter | reported | CI | An ADR with a supersession verb and a lower ADR link but no `supersedes:` line, or a research note with no pointer line, goes on one standing issue | `aw/watchdog/missing-trailer.ts:14-57`; `aw/watchdog/missing-trailer-counter.ts:77-118` |
| bypass counter | reported | CI | ≥3 push-to-main Verify runs red at "Gauntlet" open a move-10 proposal | `aw/watchdog/bypass.ts:1-38`; `aw/watchdog/bypass-counter.ts:57-126` |
| lost-dispatch counter | reported | CI | A `sliceable` PRD with no sub-issues and no successful to-tickets run since creation goes on one standing issue | `aw/watchdog/lost-dispatch.ts:9-11`; `aw/watchdog/lost-dispatch-counter.ts:42-45,74-115` |
| run watchdog | reported | CI | A failed run with zero jobs in 7 days opens one issue per workflow path | `aw/watchdog/dead-lanes.ts:23-59`; `aw/watchdog/run-watchdog.ts:83-234` |

### Taught: lane prompts and prompts built in TypeScript

"Twin" names the machine that also holds the rule. "restates" means the prompt says the rule in its
own words; "reads" means the source is injected at build time.

| Mechanism | Rung | Venue | Rule it holds | Twin, and reads or restates | Source |
|---|---|---|---|---|---|
| slice item 7 | taught | lane | Root every path; the only shorthand is a path this slice claims in full; never join paths into one token | validatePathsAreRooted + repairUnrootedClaims; restates (also injects ticket-format:74) | `aw/to-tickets/slice/prompt.md:41` |
| slice item 10 / audit item 6 | taught | lane | Ceilings of 400/200/200 characters; claim every modified file; over `claimLimit` means cut the slice | plan-schema + assertTicketShape; restates caps as literals, names the key for claimLimit | `aw/to-tickets/slice/prompt.md:44`; `aw/to-tickets/audit/prompt.md:36` |
| slice item 5 / audit item 5 | taught | lane | The criterion marker shape; no tracker commands | criterionProblem; slice reads TICKET_FORMAT, audit restates | `aw/to-tickets/slice/prompt.md:39`; `aw/to-tickets/audit/prompt.md:35` |
| slice item 9 / audit item 5 | taught | lane | `dependsOn` is 1-based and points at earlier slices only | validatePlan (forward edges not refused); restates | `aw/to-tickets/slice/prompt.md:43`; `aw/to-tickets/audit/prompt.md:35` |
| slice item 4 | taught | lane | Wave 0 is a tracer, never a bare seam or wiring slice | none | `aw/to-tickets/slice/prompt.md:38` |
| slicing-rules | taught | lane | A prefactor ships with its consumer; criteria are self-contained; wide refactors use expand–contract | none | `aw/to-tickets/references/slicing-rules.md:3-6` |
| chain-shape ladder | taught | lane | Session ceiling → repartition → prefactor → edge → width | none | `aw/to-tickets/references/chain-shape.md:3-9` |
| headless-gate | taught | lane | Criteria are automatable, red today, narrow and sh-runnable | ticket_shape warnings; restates ticket-format | `aw/to-tickets/references/headless-gate.md:3-7` |
| audit / seam-sweep | taught | lane | Grading calls; one-line manifest entries | none | `aw/to-tickets/audit/prompt.md:29-34`; `aw/to-tickets/seam-sweep/prompt.md:22-23` |
| implementer | taught | lane | Claims bound decisions; a later comment beats the body; repair fixtures, never assertions; name repaired files; no scratch files | ADR-0110 regen; none for the rest | `aw/implement/implementer/prompt.md:8-9,24-26,38-40,62-69,77-79` |
| implementer | taught | lane | Only `.fails` may be dropped; no immutable-set edits; iterate with `bin/gauntlet stop`, never `npm run check`; `declaredEdits` stays `[]` on rung one | fails-rule, landing immutable; restates (brief.ts:84-86 injects slots) | `aw/implement/implementer/prompt.md:56-60,73-76,81-90,115-116` |
| fresh-eyes | taught | lane | A `test.fails` test may change only if wrong; declared paths exactly as `git status` prints them; no immutable edits | fails-rule exact Set lookup; restates | `aw/implement/implementer/fresh-eyes.md:27-41,68-74` |
| mechanic | taught | lane | Fence (restated beside the injected MECHANIC_FENCE); deleting a red test is "caught"; no git/gh | mechanic fence + skip regex; restates | `aw/mechanic/prompt.md:22-35,54-58` |
| fixer | taught | lane | Never touch the immutable set or `test.fails`; never skip; no commit or push | Verify Immutability only (CI); restates | `aw/fixer/prompt.md:4-21,30-37` |
| acceptance author | taught | lane | Add only; every test red today; title grammar; no subject mocks; stubs throw "not built" | acceptance additive + pin; restates | `aw/acceptance/author/prompt.md:8-40` |
| acceptance house rules | taught | lane | No prose; no fake-gh names; no raw REST paths; no stub for a process subject | prose-gate, eslint; restates via house-style.ts | `aw/acceptance/author/house-rules.md:3-28`; `aw/acceptance/house-style.ts:4-22` |
| acceptance repair | taught | lane | Clones means 5+ repeated lines | jscpd; restates `package.json` minLines | `aw/acceptance/author/repair.md:8-9` |
| ratify | taught | lane | Fix every VIOLATION site; mechanise inline with a provenance comment; zero grandfathering; no commit | rule-trial, land; restates | `aw/ratify/prompt.md:45-78,107-114` |
| correctness reviewer | taught | lane | Cite `path:line` in this diff; findings restating a green gate are refused | structural refusal; the green-gate refusal no longer exists (ADR-0036 is `note`) | `aw/review/correctness-reviewer/prompt.md:7-17` |
| shaper / shape refuter / sweep | taught | lane | A mark names what moves; caps of 5/3/3; survivors specific; a sweep item needs a reason | sheet.ts caps, sweep-schema; restates | `aw/shape/shaper/prompt.md:11,19-39,91`; `aw/shape/refuter/prompt.md:11-20`; `aw/shape/sweep/prompt.md:26-37,69` |
| spec author / critic / reconcile | taught | lane | Quote the owner verbatim; guesses become open questions; one criterion with a marker; write `## Assumptions` | validate-spec, reconcile; restates spec-format (also injected) | `aw/spec/author/prompt.md:13-50`; `aw/spec/critic/prompt.md:37-41`; `aw/spec/reconcile/prompt.md:27-44` |
| observation lenses | repaired | lane | `Site` is `path:line`; only `Finding:`/`Site:` lines parse | grammar | `aw/observations/lenses/proposed.ts:40-45`; `aw/observations/lenses/grammar.ts:8-33` |

### Taught: skills, CLAUDE.md, CONTEXT.md and docs

| Mechanism | Rung | Venue | Rule it holds | Twin | Source |
|---|---|---|---|---|---|
| CLAUDE.md | taught | terminal | Commit messages say why; keep local state out of git; use CONTEXT.md terms | none (no commit-msg hook); `.gitignore` | `CLAUDE.md:7-10`; `.gitignore:2-4` |
| CLAUDE.md | taught | terminal | Code carries no prose; knip tags ≤5 lines; edit contract slots, not the gauntlet; new code reachable | prose-gate, knip | `CLAUDE.md:11-24` |
| CODING_STANDARDS.md | taught | lane, terminal | Nine entries: public-interface tests, deep modules, zero grandfathering, exemptions say why, cite don't restate, one fixture builder, one StageDef, pin mandated copies, refuse rather than guess | partly knip/jscpd | `CODING_STANDARDS.md:9-44` |
| ticket-format.md | taught | terminal, lane | Ticket headings, marker shape, rooting, claimLimit by name, glob ban, by-hand claims, collisions never edges | ticket_shape.py, render-body, reconcile; restates | `docs/agents/ticket-format.md:11-16,33-55,74,86-102,130` |
| spec-format.md | taught | terminal, lane | One criterion that reads the world, in the owner's words; producers reference and don't restate | ticket_shape.py spec kind | `docs/agents/spec-format.md:8-10,19-56,63-85` |
| issue-tracker.md | taught | terminal | Never `gh issue create`; closing record; the claim step; Wayfinding resolve | validate-bash, close-gate | `docs/agents/issue-tracker.md:8,13-23,92-94,120-124` |
| pipeline-labels.md | taught (generated table) | terminal | Only the owner applies `to-build`/`to-spec`; at most one green/blue label | markLane, labels-doc | `docs/agents/pipeline-labels.md:6-7,17,23-28,103-104` |
| venues.md | taught (generated slots) | terminal | Slot lists; the hand-over step on every lane; only push and CI fail closed | venues-doc (slots only) | `docs/agents/venues.md:15-68` |
| module-boundaries.md | taught | terminal | Lane-to-lane, shared-to-lane and cycle bans | dependency-cruiser; restates | `docs/agents/module-boundaries.md:6-30` |
| clone-gate.md | taught | push | Six clone-gate rules | jscpd (partial), bin/clone-check (no venue) | `docs/agents/clone-gate.md:8-92` |
| enrolment.md | taught | lane | Five writes, failure isolation, first enrol by hand | enrol.ts | `docs/agents/enrolment.md:8-61,116-141` |
| domain.md | taught | terminal | Avoid lists bind; proceed silently without CONTEXT/ADR | vocabulary-pin (6 terms, lane 03) | `docs/agents/domain.md:13,29,39-41` |
| lane-map.md | taught | terminal | Regenerate, never edit | none | `docs/agents/lane-map.md:5` |
| docs/adr/README.md + ADR-FORMAT.md | taught | terminal | Admission bar; never rename or delete; retire by status | adr_shape, adr-gate, drift | `docs/adr/README.md:3-5,17-31,45-68`; `.claude/skills/domain-modeling/ADR-FORMAT.md:3-5,19-33,49-71` |
| CONTEXT.md | taught | terminal | Glossary, including Rung (strike ladder), Gate, Refusal, Lane, Seam | vocabulary-pin (6 terms) | `CONTEXT.md:64-66,91-101,124-126,154-161,187-193,201-215,248,273-283` |
| to-tickets skill | taught | terminal | Seam sweep; a prefactor never lands bare; the chain-shape ladder; inward edges; audit before publish | validatePlan; restates chain-shape.md | `.claude/skills/to-tickets/SKILL.md:21-27,44-45,53-69,81-101,119` |
| to-spec skill | taught | terminal | No interview; one question; self-critique; publish with the `spec` kind | ticket_shape spec kind; restates spec-format | `.claude/skills/to-spec/SKILL.md:7-59` |
| implement skill | taught | terminal | Pin the base; `Part of #`; repair reddened tests; leave checks alone; gate once; close or needs-human | none locally (immutable set is lane-only) | `.claude/skills/implement/SKILL.md:15-60` |
| drain skill + WORKER-PROMPT | taught | terminal | Frontier parse; own worktree; main read-only; no install; never force; `all` slot bare | none; `src/` holds a byte-identical dead copy | `.claude/skills/drain/SKILL.md:30-401`; `.claude/skills/drain/WORKER-PROMPT.md:3-57` |
| wayfinder skill | taught | terminal | Claim first; budget at graduation; one ticket per session; own worktree; close via close-ticket | close-gate | `.claude/skills/wayfinder/SKILL.md:15-220` |
| standards / standards-pass / ratify skills | taught | terminal | Serial chain; ledger; recurrence ≥2; zero grandfathering; land a rule on default branch | rule-trial (lane) | `.claude/skills/standards/SKILL.md:9-50`; `.claude/skills/standards-pass/SKILL.md:13-173`; `.claude/skills/ratify/SKILL.md:17-145` |
| tdd / diagnosing-bugs / prototype / writing-great-hooks / resolving-merge-conflicts / research / handoff / audit-doc / domain-modeling / converge | taught | terminal | Session practice rules (confirm seams first; red before green; no `--abort`; background agent; redact secrets; …) | none | `.claude/skills/tdd/SKILL.md:14-38`; `.claude/skills/diagnosing-bugs/SKILL.md:14-136`; `.claude/skills/prototype/SKILL.md:21-26`; `.claude/skills/writing-great-hooks/SKILL.md:16-84`; `.claude/skills/resolving-merge-conflicts/SKILL.md:10-12`; `.claude/skills/research/SKILL.md:6-24`; `.claude/skills/handoff/SKILL.md:8-14`; `.claude/skills/audit-doc/SKILL.md:41-89`; `.claude/skills/domain-modeling/SKILL.md:62-64`; `.claude/skills/converge/SKILL.md:9-47` |

## Duplicates

Each item is one rule held in two or more places, or restated in its own words instead of read from
its source. The first source listed is the owner where one exists.

- **D1. Rooting rule, seven copies.** Repaired at `aw/shared/render-body.ts:178-213`, refused at
  `aw/shared/render-body.ts:109-136`, partly held at `bin/ticket_shape.py:430-438`. Taught at
  `aw/to-tickets/slice/prompt.md:41`, `aw/to-tickets/repair/prompt.md:6-8`,
  `aw/implement/implementer/fresh-eyes.md:72-73`, `docs/agents/ticket-format.md:74,130`. Because
  the slice prompt also injects ticket-format:74, a rendered slice prompt carries the rule twice.
  There is no rules-JSON source. *Candidate:* one source, prompts that point at it, and slice:41's
  "refuses" corrected. Cost: prompt edits plus a rules key.
- **D2. Immutable set spelled as a literal.** Five prompts, three code messages, two docs (see the
  charting table). *Candidate:* build the messages from `IMMUTABLE_SET` and
  `IMMUTABLE_SET_SOURCE`, and inject a `{{IMMUTABLE_SET}}` var into prompts. Cost: small; the
  literal-in-prose gate would need to widen to hold it.
- **D3. Immutable set refused at five points for one change.** Publisher
  (`aw/shared/render-body.ts:54`), landing (`aw/shared/implementation-landing.ts:271`), mechanic
  fence (`aw/mechanic/mechanic.ts:231`), Verify Immutability (`aw/integrate/immutability.ts:17`),
  and ratify twice (`aw/ratify/run-ratify.ts:119`, `aw/ratify/land.ts:141`; the second is dead).
  These are enforcers reading one source (ADR-0184 allows that), except ratify's second check.
- **D4. Chain-shape ladder, two copies in different words.**
  `aw/to-tickets/references/chain-shape.md:3-9` vs `.claude/skills/to-tickets/SKILL.md:55-59`.
  They disagree (C1). *Candidate:* the skill reads the reference. Cost: one edit.
- **D5. SLICE_CAPS literals required in prompts.** `aw/to-tickets/slice/prompt.md:44`,
  `aw/to-tickets/audit/prompt.md:36`, pinned by `aw/shared/prompt-skeleton.test.ts:134-140`, restating
  `aw/shared/plan-schema.ts:4-17`. *Candidate:* inject `{{…}}` vars and drop the pin. Cost: small.
- **D6. Ticket shape restated in prose.** `docs/agents/ticket-format.md:11-12,33-55,86-88`,
  `bin/file-issue:9-15,27-38`, `docs/agents/issue-tracker.md:8`,
  `aw/to-tickets/references/headless-gate.md:3-7` and `aw/to-tickets/audit/prompt.md:35` all
  restate `ticket-shape.rules.json` / `bin/ticket_shape.py`. The tracker command list is spelled
  three ways: "gh, curl and wget" at `ticket-format.md:52`, `gh api|issue|pr|run` at
  `ticket-shape.rules.json:21`, and its own wording at `render-body.ts:24`.
- **D7. Spec rules restated.** `.claude/skills/to-spec/SKILL.md:35-41`,
  `aw/spec/author/prompt.md:13-31` and `aw/spec/reconcile/prompt.md:41-44` restate
  `docs/agents/spec-format.md:23-34`, which says producers reference it rather than restate it
  (`spec-format.md:8-10`).
- **D8. Labels restated with different colours.** `bin/file-issue:93-106` (prd `5319e7`, ticket
  `0e8a16`, by-hand `b60205`) vs `aw/shared/labels.json:18,30,43`. Label names are also
  hard-coded at `hk/session-brief.py:11-13` (beside its own read at `:15-20`),
  `hk/session-end.py:14`, `aw/shape/accept.ts:99-100,244-246`,
  `aw/shared/report-lane-failure.ts:48`, `aw/watchdog/lost-dispatch.ts:10`,
  `.claude/skills/standards-pass/SKILL.md:118-120`, `docs/agents/issue-tracker.md:76-81` and
  `CONTEXT.md:273-281`.
- **D9. Closing-record rules partly re-implemented.** `hk/close-gate.py:182-267` vs
  `bin/close-ticket:463-551`. close-ticket has its own range regex at `bin/close-ticket:319`,
  different from `closing-record.rules.json` `grammar.range`, and its own unparseable-marker test
  at `bin/close-ticket:138`, different from `checkMarkerAttempt` (`ticket-shape.rules.json:16`).
- **D10. ADR mechanics parsed three or four times.** The status vocabulary is at
  `bin/adr_shape.py:10`, `aw/shared/adr-index.ts:82,89` and `aw/shared/prose-drift.ts:77,140`.
  The filename regex is at `bin/adr_shape.py:21`, `aw/shared/adr-index.ts:8` and
  `aw/shared/prose-drift.ts:23`. There are three frontmatter parsers
  (`bin/adr_shape.py:98-108`, `aw/shared/adr-index.ts:44-53`, `aw/shared/prose-drift.ts:31-36`)
  and two `supersedes:` parsers that disagree off-frontmatter
  (`aw/watchdog/missing-trailer.ts:32-36`, `aw/watchdog/back-stamp.ts:18-28`). WORD_CAP 150 is
  restated at `hk/adr-gate.py:13`, `docs/adr/README.md` and `ADR-FORMAT.md`.
- **D11. Checks run twice per push.** adr-check runs from `bin/lint:98-103` and
  `hk/adr-check.proc.test.ts:93-106`. INDEX currency runs from the adrs slot and
  `aw/shared/adr-index.tooling.proc.test.ts:91-107`. `test_adr.py` runs from
  `hk/python-suite.proc.test.ts:18-25` and `hk/adr-shape.proc.test.ts:155-165`. Ticket-format
  variants run from `aw/shared/ticket-format-doc.proc.test.ts:40-63` and
  `hk/test_ticket_templates.py:225`.
- **D12. Venue slots retyped.** `aw/shared/venue-slots.json:2-4` is retyped in
  `aw/shared/venues-doc.proc.test.ts:29-41`. The "Fires at" and "On failure" columns are hand
  constants (`aw/shared/venues-doc.cli.ts:12-23`). turn and stop hold identical slots, so stop
  re-runs turn's checks.
- **D13. Hook plumbing twice.** Log dir, retention and row shape at `hk/_hook.py:63-99` and
  `hk/lib/_hook.mjs:10-94`. EDIT_TOOLS at `hk/_hook.py:114-118` and `hk/gauntlet-report.mjs:6-8`
  (the array form slips past `bin/lint:55-56`). The repo root walk at `hk/adr-gate.py:23` and
  `hk/_hook.py:236`. WORKSTATION_CLONE at `aw/enrol/seeded-docs.ts:3`,
  `bin/link-workstation:16` and `hk/clone-guard.py:8` (unpinned).
- **D14. Knip tag cap of five.** `aw/shared/prose.ts:12`, `CLAUDE.md:16` and ADR-0151.
- **D15. Zero-grandfathering and public-interface testing.** `CODING_STANDARDS.md:17-23`,
  `docs/agents/clone-gate.md:56-68`, `.claude/skills/ratify/SKILL.md:94-96`,
  `aw/ratify/prompt.md:64-67`, `.claude/skills/tdd/SKILL.md:14,20` and
  `.claude/skills/codebase-design/DEEPENING.md:35-37`.
- **D16. Contract slots restated in prompts.** `aw/implement/implementer/prompt.md:81-90` and
  `aw/implement/implementer/repair.md:8-9` restate slots that `aw/implement/brief.ts:84-86`
  already injects. `.claude/skills/resolving-merge-conflicts/SKILL.md:12` restates "typecheck,
  tests, format" instead of the `all` slot.
- **D17. Strike accounting constants.** "Three runs" at `aw/shared/strikes.ts:107` against the
  RUNGS length at `:4`. RUN_PAGE_SIZE=100 in four files (`aw/shared/strikes.ts:135`,
  `aw/watchdog/bypass-counter.ts:10`, `aw/watchdog/dead-lanes.ts:25`,
  `aw/watchdog/walk-home.ts:14`). A 7-day lookback twice (`aw/watchdog/dead-lanes.ts:23`,
  `aw/watchdog/walk-home.ts:16`). Two `needs-human` add paths (`aw/dispatch/reconcile.ts:473`
  raw, `aw/shared/needs-human.ts:6-16`).
- **D18. Budgets and job timeouts set independently.** `aw/shared/lane-budget.ts:1-11` vs each
  workflow's `timeout-minutes` (see C12).
- **D19. Gauntlet runs twice per PR, and a red Verify escalates twice.** `wf/verify.yml:79-82`
  and `aw/integrate/integrate.ts:336-338` (the rebased tree). `aw/fixer/fixer.ts:145-148` and
  `aw/integrate/integrate.ts:343-352`.
- **D20. drain skill copied byte for byte.** `.claude/skills/drain/SKILL.md` =
  `.claude/skills/drain/src/SKILL.md`, and the same for `WORKER-PROMPT.md`. Nothing reads `src/`.
- **D21. Owner-point pastes.** The three-bullet summary block, including the same typo, at
  `.claude/skills/to-spec/SKILL.md:25-29` and `.claude/skills/grilling/SKILL.md:28-32`. The
  own-worktree rule at `.claude/skills/drain/SKILL.md:113-121`,
  `.claude/skills/drain/WORKER-PROMPT.md:21` and `.claude/skills/wayfinder/SKILL.md:158-165`.

## Contradictions

Each item is two rules that cannot both be satisfied, with the case that hits both.

- **C1. Prefactor slice vs knip, and the two ladders against each other.**
  `aw/to-tickets/references/chain-shape.md:7` says "an independent prerequisite slice".
  `.claude/skills/to-tickets/SKILL.md:44` puts the prefactor at the root, while `SKILL.md:26,57`
  say it "never lands bare" and ships with its first consumer. `slicing-rules.md:3` only asks
  that it be accompanied in the same batch. *Case:* rung 3 draws a helper-only slice with no
  `dependsOn`. It becomes Wave 0, which `slice/prompt.md:38` and `SKILL.md:63` forbid. If it
  ships anyway, it merges alone, and knip refuses its unused export at push
  (`knip.config.ts:86-93`; `CLAUDE.md:20-24`).
- **C2. The ladder's blocking edge vs ADR-0199.** `chain-shape.md:8` and `SKILL.md:45,58,81` add
  an edge for a shared file. `docs/agents/ticket-format.md:99-102` says a collision "is never a
  `blockedBy` edge", and `aw/to-tickets/publish-issue-graph.cli.ts:40-41` logs the overlap
  instead. *Case:* two slices share a hub file. The slicer, following rung 4, emits `dependsOn`,
  and that stored edge is exactly what ADR-0199's reversal line says holds later tickets.
- **C3. `claimLimit` vs a shared hub file.** `aw/to-tickets/slice/prompt.md:44` says to claim
  every modified file and cut the slice if it runs over `claimLimit`
  (`ticket-shape.rules.json:2`). *Case:* a spec whose slices all touch one registry file, such as
  `aw/shared/lane-wiring.ts`. Cutting multiplies slices that claim the hub. Each overlapping claim
  then waits a pass at dispatch (`aw/dispatch/reconcile.ts:602-621`), so the batch runs serially.
  Under-claiming the hub to go wide breaks slice:44 and relies on lane 08's rebase to catch the
  collision.
- **C4. ADR-0110 edits outside a claim vs ADR-0199 scheduling by claims.** ADR-0110 lets a run
  repair a fixture or regenerate an artifact outside `## Files claimed`
  (`docs/adr/0110-*.md:10`; `aw/implement/implementer/prompt.md:62-69`). The reconciler holds only
  claimed files (`aw/dispatch/reconcile.ts:602-621`). *Case:* run A repairs an unclaimed
  `x.test.ts` that live run B claims. Nothing serialises them, and the second landing's rebase
  conflicts (`aw/shared/implementation-landing.ts:98-100`), which ends in needs-human and loses the
  work (C5).
- **C5. Red gate saves the work, a conflict discards it.**
  `aw/shared/implementation-landing.ts:184,331-336` push a red answer "so the work is not lost".
  `aw/shared/implementation-landing.ts:98-100,140` commit, rebase, throw and push nothing.
  `aw/acceptance/acceptance.ts:472-474` also pushes nothing for a red batch. *Case:* two green
  implement runs land in parallel; the second conflicts on rebase and is gone.
- **C6. The fresh-eyes example breaks its own rule.**
  `aw/implement/implementer/fresh-eyes.md:72-73` asks for the path from the repository root,
  saying a shortened path matches nothing. Its example at `:77` (and
  `aw/implement/implementer/prompt.md:121`) is `"shared/retry.test.ts"`. *Case:* a model copies
  the example's shape, and `aw/shared/fails-rule.ts:22`'s exact Set lookup refuses the declared
  `test.fails` edit.
- **C7. Two definitions of a retired ADR.** `aw/shared/prose-drift.ts:76-78` retires only
  `superseded` ADRs or those a successor supersedes. `aw/shared/prose-drift.ts:140` and
  `aw/shared/adr-index.ts:88-90` retire every non-`constraint` ADR, and INDEX says nothing retired
  binds (`aw/shared/adr-index.ts:23-28`). *Case:* 10 live lines cite `note` ADRs and pass `drift`,
  while INDEX lists those ADRs as retired: `aw/review/correctness-reviewer/prompt.md:7`,
  `aw/review/counter.ts:76,90`, `aw/shape/shaper/prompt.md:37`, `aw/shared/labels.json:24`,
  `aw/watchdog/lost-dispatch.ts:37`, `hk/stop-gate.py:79`, and
  `docs/agents/pipeline-labels.md:39,69,108`.
- **C8. A limit literal is both required and forbidden in the same prompts.**
  `aw/shared/prompt-skeleton.test.ts:134-140` requires the SLICE_CAPS numbers in slice and audit.
  `aw/shared/literal-in-prose.test.ts:67-76` forbids the `claimLimit` number there, and ADR-0193
  says to delete restatements.
- **C9. Skills teach closes that close-gate refuses.** `hk/close-gate.py:430-437` needs a closing
  record. Bare closes are taught at `docs/agents/issue-tracker.md:124`,
  `.claude/skills/drain/SKILL.md:367`, `.claude/skills/wayfinder/SKILL.md:219-220` and
  `.claude/skills/standards-pass/SKILL.md:32,173`; the last also pipes from `gh issue create`,
  which `hk/validate-bash.py:103` refuses. In this checkout the gate is bypassed anyway
  (`hk/close-gate.py:304-309,397-400`; M1).
- **C10. close-gate accepts records close-ticket refuses.** A hand-posted record with every bullet
  UNVERIFIED passes `hk/close-gate.py:182-205`, but close-ticket refuses it
  (`bin/close-ticket:540-551`). `No diff.` on a body without criteria passes with any range
  (`hk/close-gate.py:225`), but close-ticket refuses it when commits exist
  (`bin/close-ticket:476-489`).
- **C11. Holds that contradict or never clear.**
  - A to-tickets refusal adds `slice-failed` and exits 1 (`wf/to-tickets.yml:61-63,83-85`), then
    `fail --lane` adds `needs-human` (`aw/shared/labels.cli.ts:23-25`). Success clears only
    `slice-failed` (`wf/to-tickets.yml:130`).
  - A mechanic fence or skip refusal adds `needs-human` (`aw/mechanic/mechanic.ts:233,238`), exits
    1, and `fail --lane` adds `queued` (`aw/shared/labels.cli.ts:20-21`).
  - The PRD check removes `needs-human` whenever its own comment stood, even if a later dead run
    added the hold (`aw/dispatch/reconcile.ts:496-499`).
  - Integrate adds `needs-human` on a red Verify, saying nothing retries it
    (`aw/integrate/integrate.ts:167,343-346`), while Verify rings the fixer
    (`wf/verify.yml:84-111`), which re-judges on green (`aw/fixer/fixer.ts:210-218`).
- **C12. Budget and timeout accounting.**
  - A budget writes a strike for any budgeted lane (`aw/shared/stage.ts:368-381`), including the
    fixer and review (`aw/fixer/fixer.ts:195`, `aw/review/review.ts:115-116`), though only three
    lanes ladder (`aw/shared/strikes.ts:22-26`).
  - Budgets exceed job timeouts, so the runner kills the job before the budget can write its
    strike: to-tickets 80 min per stage × 3 steps vs a 90 min job
    (`aw/to-tickets/to-tickets.ts:59`; `wf/to-tickets.yml:26,105-118`); review 11+11 vs 15
    (`aw/review/review.ts:112-119`; `wf/review.yml:32`); spec 24 per stage × 3 vs 30
    (`wf/spec.yml:26`).
- **C13. Any issue edit starts an "Acceptance #N" run.** `wf/acceptance-caller.yml:2,5-6` fires
  on `issues: edited`, and the run title matches `LANE_RUN_TITLE_RE`
  (`aw/shared/strikes.ts:20`). *Case:* while that run lives, the ticket reads busy and its files
  are held (`aw/dispatch/reconcile.ts:602-606`). If it dies, for example at preflight
  (`wf/acceptance.yml:56-62`), it counts as a strike (`aw/shared/strikes.ts:18`). Not measured
  against run history.
- **C14. The mechanic can re-ring itself past the ladder and the hold.** A fails-rule refusal
  dispatches `mechanic-wanted` (`aw/shared/implementation-landing.ts:287-293`). The mechanic
  refuses only CLOSED tickets (`aw/mechanic/mechanic.ts:183-186`), never `needs-human`, while the
  decision comment promises that nothing starts a fourth run (`aw/shared/strikes.ts:107`).
- **C15. Machines apply "owner-only" verbs.** `aw/shared/labels.json:22-23` and
  `docs/agents/pipeline-labels.md:17,103-104` say only the owner applies `to-build`/`to-spec`.
  `aw/watchdog/walk-home.ts:263-264` applies `to-build`, and `aw/shape/accept.ts:243-244` and
  `aw/dispatch/reconcile.ts:178-190` apply `to-spec`. Walk-home also files non-TS tickets with no
  `check:` marker (`aw/watchdog/walk-home.ts:126-136`), which the to-build door refuses into
  needs-human (`aw/dispatch/ticket-state.ts:300-306`).
- **C16. An immutable-set claim is labelled in one path and refused in another.**
  `bin/file-issue:295-296,537`, `aw/watchdog/walk-home.ts:240-252` and
  `docs/agents/ticket-format.md:93-97`, which is injected into the slicer, say to label it
  `by-hand`. The plan gate refuses it (`aw/shared/render-body.ts:54-71`), so the by-hand branch
  at `aw/shared/publish-sub-issues.ts:18` is unreachable for it.
- **C17. Label colours flip-flop.** `bin/file-issue:269-278` force-paints its colours;
  `aw/shared/labels.ts:112` and the Enrol sync paint them back.
- **C18. Hand-over, doc vs code.** `docs/agents/venues.md:22-25` says every lane ends in
  `fail --lane`. `docs/agents/pipeline-labels.md:27-28` says a green label with no run is how a
  dead chain is found. Fixer, review, integrate, ratify and verify stamp green labels
  (`aw/fixer/fixer.ts:351`, `aw/review/review.ts:114`, `aw/integrate/integrate.ts:405`,
  `aw/ratify/run-ratify.ts:64`, `aw/integrate/immutability.ts:24`), and their workflows have no
  hand-over step.
- **C19. Rung means two things.** `CONTEXT.md:187-193` defines Rung as the strike ladder.
  ADR-0193, `docs/agents/venues.md:4-5` and `README.md:25` use it as the placement tier, and
  `venues.md:26` uses both senses on one page. `CONTEXT.md:98,101` lists different venues and
  bans "tier, level". Also, `CONTEXT.md:248` names `questions-open`, but the label is
  `2-questions-open` (`aw/shared/labels.ts:53`).
- **C20. Prompts promise mechanisms that don't exist, or behave differently.**
  - `aw/mechanic/prompt.md:32-35` says deleting a red test is caught; `aw/mechanic/mechanic.ts:61`
    matches only skip, todo and xit.
  - `aw/review/correctness-reviewer/prompt.md:7-9` promises a green-gate refusal that ADR-0036
    records as deleted.
  - `aw/shape/shaper/prompt.md:19` says an empty mark is stripped; `aw/shape/sheet.ts:29` only
    trims it.
  - `aw/shape/sweep/prompt.md:69` says a reasonless item is dropped;
    `aw/shared/sweep-schema.ts:17` refuses the whole answer.
  - `aw/implement/implementer/prompt.md:58-60`, `aw/implement/implement.ts:347` and
    `aw/mechanic/mechanic.ts:282` say "refused before its push"; the push happens first
    (`aw/shared/implementation-landing.ts:279-293`).
  - `aw/acceptance/house-style.ts:22` tells the author it has no tools;
    `aw/acceptance/author/prompt.md:44` tells it to run its tests.
  - `aw/spec/author/prompt.md:29` gives the marker without backticks, which the validator
    refuses.
- **C21. Ratify's provenance comment vs the prose gate.** `aw/ratify/prompt.md:59` asks for a
  comment above an inline eslint rule. `aw/shared/prose.ts:14,106-111` scans `eslint.config.js`,
  and `aw/ratify/prompt.md:71` requires the suite, which includes prose-gate, to be green.
- **C22. The stop venue "never holds the turn" vs code that blocks once.**
  `docs/agents/venues.md:17,42-43` and `aw/shared/venues-doc.cli.ts:14` say it never holds.
  `hk/stop-gate.py:16,134-146,377` returns `decision: block` once.
- **C23. Push "fails closed" vs an adr-check that can't run.** `docs/agents/venues.md:49-50` says
  push fails closed. `bin/lint:98-100` leaves the rules slot green when adr-check exits 2.
- **C24. Pre-push judges a different tree from the one it pushes.** `bin/gauntlet:58` runs
  `eslint --fix .` on the working tree before the push slots. The pushed commits keep the unfixed
  code, and CI does the same.
- **C25. Skills vs ADR-0168 and each other.** `.claude/skills/drain/SKILL.md:184`,
  `.claude/skills/research/SKILL.md:6` and `.claude/skills/wayfinder/SKILL.md:184` dispatch in
  the background, while `.claude/skills/drain/WORKER-PROMPT.md:3,47` cites ADR-0168 for the
  foreground. `.claude/skills/tdd/SKILL.md:22` confirms seams with the user first, while the
  unattended worker invokes /tdd (`WORKER-PROMPT.md:43`). `.claude/skills/ratify/SKILL.md:17,92-93`
  says it is local-only and lands on the default branch, but `wf/ratify-caller.yml` exists and
  `CONTEXT.md:124-126` says ratified means a merged PR.
- **C26. Other taught/held mismatches.**
  - `docs/agents/spec-format.md:55-56` says an unresolved spec command only warns;
    `bin/ticket_shape.py:377-379` refuses it.
  - `docs/agents/ticket-format.md:117-120` says the publisher writes `Part of #`;
    `aw/shared/render-body.ts:154-155` writes `## Parent PRD`.
  - `docs/agents/ticket-format.md:41`'s model check `bin/lint` is a whole-repo command, which the
    same doc's `:49-51` and `bin/ticket_shape.py:354-355` hold against.
  - `CONTEXT.md:159-160` says a `test.fails(` line may lose `.fails` "and nothing else";
    `aw/shared/fails-rule.ts:22` exempts declared paths.
  - `aw/dispatch/reconcile.ts:135-136` says Immutability reads `## Files claimed`; it reads
    `client_payload.changed_files` (`wf/verify.yml:30`).
  - `hk/credential-scan.py:70` says to "add a comment", which `CLAUDE.md:11` bans.
  - `aw/watchdog/bypass.ts:65-67` still proposes the branch protection that ADR-0071 declined.

## Misplacements

Each item is a candidate move, with a rough cost. None is a ruling.

**Refused (or lost) where the machine could repair**

- **M1.** The rebase conflict at landing discards work (`aw/shared/implementation-landing.ts:98-100`).
  *Move:* push the un-rebased branch, as the red-gate path does, or let lane 08 resolve it.
  Cost: small to moderate.
- **M2.** Stale generated docs are refused at push although regenerators exist: adrs
  (`aw/shared/adr-index.cli.ts:47-51` has `--fix`), labels-doc and venues-doc. *Move:* regenerate
  on a PostToolUse edit of the source. Cost: small.
- **M3.** `file-issue` files an unrooted claim with only an advisory warning
  (`bin/ticket_shape.py:441-456`), while publish repairs the same case
  (`aw/shared/render-body.ts:178`). *Move:* share `rootingsThatResolve` with the terminal path.
  Cost: a port, or a shared rules source.
- **M4.** A spec validator refusal ends lane 02 (`aw/spec/validate-spec.ts:37`) with no repair
  round, while to-tickets gets one (`aw/to-tickets/to-tickets.ts:65-76`). The spec rewrite path
  skips validation entirely (`aw/spec/publish.ts:93-106`). Cost: moderate.

**Checked later than a venue that already sees enough**

- **M5.** The close gate is bypassed when the repo ships a copy of it
  (`hk/close-gate.py:304-309,397-400`), and nothing registers that copy. *Move:* drop the
  pass-through. Cost: about 5 lines plus tests.
- **M6.** The fails rule is judged after the push (`aw/shared/implementation-landing.ts:279-293`).
  *Move:* judge the pre-commit diff. Cost: small.
- **M7.** The fixer checks neither the immutable set nor the fails rule before its push
  (`aw/fixer/fixer.ts:204-212`), so CI Immutability is the first check. Skip detection runs only in
  the mechanic (`aw/mechanic/mechanic.ts:91`), and gate growth only in fixer and mechanic.
  *Move:* put `touchesImmutableSet`, `judgeFailsEdits`, `gateGrowth` and `skipsATest` in one
  shared landing. Cost: small.
- **M8.** Implement and mechanic don't read `needs-human` at lane start
  (`aw/implement/implement.ts:211-217`, `aw/mechanic/mechanic.ts:181-186`). *Move:* refuse at the
  door, which closes C14. Cost: small.
- **M9.** Budget × stages vs `timeout-minutes` is unchecked (C12). *Move:* a push test reading
  `lane-budget.ts` and the emitted YAML. Cost: small.
- **M10.** The hand-over rule is taught only (`docs/agents/venues.md:22-25`). *Move:* a
  `lane-wiring.test.ts` check that a lane stamping an in-flight label has a hand-over step. Cost:
  the test plus five workflow steps and a queue-or-escalate choice for each.
- **M11.** actionlint is CI-only and lints the machine checkout, not the PR
  (`wf/verify.yml:65-69`). CI skips Markdown-only pushes (`wf/verify-caller.yml:6-11`), though
  many meters judge .md. *Move:* an actionlint push slot, or a check at emit time. Cost: small.
- **M12.** `eslint --fix` at push hides autofixable violations (`bin/gauntlet:58`). *Move:* no
  `--fix` at push. Cost: one line.
- **M13.** The turn venue checks `.ts/.mts/.cts` only (`hk/gauntlet-report.mjs:17`), while stop
  also takes .js/.mjs/.cjs (`bin/gauntlet:45-47`). Cost: one regex.
- **M14.** Forward `dependsOn` edges are taught as forbidden (`aw/to-tickets/slice/prompt.md:43`)
  but not refused (`aw/shared/validate-graph.ts:16`). `claimLimit` and the glob ban could sit in
  the plan schema (`aw/shared/plan-schema.ts:14`). TS `assertTicketShape` lacks
  `checkReadsTracker` (`aw/shared/ticket-shape.ts:202`). Cost: trivial each.

**Taught where a gate could refuse**

- **M15.** Literal restatements (D2, D5, D6, D8) are held only for `claimLimit` in two files
  (`aw/shared/literal-in-prose.test.ts:67-76`). *Move:* widen the meter to every
  `.Workflow/**/*.md` and `docs/agents`, and to IMMUTABLE_SET, SLICE_CAPS and label names; or
  inject vars. Cost: moderate.
- **M16.** ADR-0168's foreground rule is greppable
  (`bin/lint:45-46` greps only restatements), so the violations in C25 could be refused. Cost:
  cheap.
- **M17.** Prose-gate holes: any comment mentioning `@shell`/`@fixture` passes
  (`aw/shared/prose.ts:11,46`; e.g. `knip.config.ts:28,102-106`), the `eslint-` pattern passes
  `vitest.config.ts:4`, and trailing `#` comments pass (`bin/lint:3-9`). *Move:* require a leading
  tag and scan trailing comments. Cost: small.
- **M18.** "Rejected alternative required" is checked only at `new-adr --land`
  (`bin/new-adr:170-172`), never on the corpus (`bin/adr_shape.py:148-186`). Cost: small.
- **M19.** Log-only holds tell nobody: merged-closer (`aw/dispatch/reconcile.ts:678-686`), file
  held (`:695-705`), runs unreadable (`aw/dispatch/ticket-state.ts:386-390`), review drops
  (`aw/review/review.ts:40`), shape-accept skips (`aw/shape/accept.ts:107,142-146`). *Move:* a
  marker comment or counter. Cost: small.
- **M20.** The review structural refusal needs `path:line` text in a raw diff
  (`aw/review/structural-refusal.ts:9-16`). *Move:* resolve the citation against hunk ranges
  instead. Cost: small, and it changes what the lane publishes.

**Stale placements**

- **M21.** Meters that cannot fail or are too loose: `aw/shared/immutable-set.test.ts:31-37`
  compares a file with its own import; the gate-size cap is 1157 against 837 lines
  (`.claude/gate-size.test.ts:8`); GATE_FILES omits `venue-slots.json`, `stop-gate.py`,
  `integrate/gate.ts` and `integrate/immutability.ts` (`aw/shared/gate-files.ts:3-19`).
  `aw/shared/check-contract.test.ts:67,139-141` resolves `~/.claude/settings.json` against the
  repo's file.

## Unplaced

- **U1. Session-lifecycle hooks.** clone-refresh, session-brief and the circuit-breaker reset run
  at SessionStart (`hk/roster.json`); session-capture and session-end run at SessionEnd;
  auto-approve-permissions runs on PermissionRequest (`hk/auto-approve-permissions.py:7,32`, which
  also neutralises any project `ask` rule). The Notification hook is outside the roster
  (`~/.claude/settings.json:202-214`). The grid has no session-start or session-end venue.
- **U2. Code with no venue.** `labels.cli.ts sync --check` has no caller
  (`aw/shared/labels.cli.ts:28-36,61-66`). `bin/clone-check` is exercised only by its own Python
  test (`bin/clone-check:69-72,123-146,320-363`). `hk/_harness.py:63` `router_fired` has no caller,
  and knip does not scan Python. `.Workflow/commit-trailer-close.ts:16-35` is a stub that holds no
  rule yet.
- **U3. Labels written that nothing reads as a gate.** `shape-refused`, `slice-failed`,
  `2-questions-open`, `1-decide`, `3-sliced` and `ratifying` are read only as generic lane labels
  or by session-brief. `6-verifying`, `7-fixing`, `7-reviewing` and `8-landing` are read only by
  markLane and rollup. `ticket` is read only in the shed list (`aw/dispatch/reconcile.ts:146`).
  Build stage comes from runs, not labels (`aw/dispatch/ticket-state.ts:243-251`).
- **U4. Platform-held.** Concurrency groups (ADR-0190) are held by GitHub. Whether a newer pending
  run cancels an older one, which would then count as a strike (`aw/shared/strikes.ts:18`), can't
  be read from the repo. `docs/agents/lane-map.md:226` shows 157 cancelled reconcile runs.
- **U5. Workstation-bound.** `aw/shared/spec-format-mirror.test.ts:10-12` is skipped wherever
  `~/.agents/workflow` is absent, including CI. The `converge` skill is personal-machine procedure.
  Every tree skill shares a name with `~/.claude/skills`, where each entry is a symlink into the
  `~/.agents/workflow` clone, so a session in this checkout loads skills from a clone that may lag
  trunk (at capture the clone was at `68f1811`).
- **U6. Judgement rules no machine could hold.** "The owner's own words"
  (`docs/agents/spec-format.md:28-31`), "sharpen, never remove" (`.claude/skills/to-spec/SKILL.md:57`),
  the ADR "surprising" bar (`docs/adr/README.md:30-31`), prototype variants "structurally
  different" (`.claude/skills/prototype/UI.md:54`).
- **U7. Descriptions, not rules.** `docs/agents/enrolment.md:15-61` and
  `docs/agents/venues.md:23-35` describe what code does. They hold nothing of their own, so each is
  a restatement with no rung.
- **U8. Unfinished knip tag sentences.** `hk/gauntlet-hook.mjs:1` ends mid-sentence, and
  `knip.config.ts:102` starts mid-sentence.
- **U9. Stale citations in ADR-0196.** It cites `render-body.ts:180` (now `:178`) and
  `ticket_shape.py:436` (now `:430`), and it describes a whatToBuild singleton check that
  `bin/ticket_shape.py:430-438` doesn't do.

## Not verified

- **C13 and U4 are read from code only.** Run history wasn't queried because the GitHub API rate
  limit was hit during capture.
- **Review drop rate (M20, summary item 4).** The rate is inferred from the code plus zero
  `lane-07-finding` issues. No review run log was read.
- **Close-gate log count (summary item 5).** The count of 11 bypassed closes comes from the hooks
  census's reading of `~/.claude/logs`, not re-read for this file.
- **Verify on a repository_dispatch.** `wf/verify.yml:61-63` checks out the target without a ref,
  which may judge the default-branch tip rather than the PR head. This needs a runtime check.
- **Spec stage `allowedTools`.** Whether they are a real restriction in the CLI
  (`aw/shared/stage.ts:257-260`) was taken on trust.

## Corrections, 2026-09-17

- **Review drop rate (summary item 4, M20): confirmed.** In 15 of the 23 review runs with retained
  stream artifacts the model returned findings (26 in all), and none was published. Run
  35175002431 is one example.
- **Verify on a repository_dispatch (Not verified): confirmed broken.** Run 35174765972 judged PR
  #651 with the target checked out at trunk (`397f64e`), not the PR head. Integrate's own gauntlet
  after rebasing is the only gate that judged the PR's code.
