# The implement lane, edge by edge

Lane 05, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

The machine is [`.github/workflows/implement.yml`](../../.github/workflows/implement.yml) (reusable;
enrolled repositories carry only a caller stub,
[`implement-caller.yml`](../../.github/workflows/implement-caller.yml)). The state machine is
[`.Workflow/agent-workflows/implement/implement.ts`](../../.Workflow/agent-workflows/implement/implement.ts).
Every model call in the repository goes through
[`shared/stage.ts`](../../.Workflow/agent-workflows/shared/stage.ts) — the same infrastructure lane
02 uses, checkpoints included.

Payload contents below are a worked example built to the real shapes and rules. The example run
continues [`verify-lane-edges.md`](verify-lane-edges.md)'s own: **ticket #421**, sliced from **PRD
#419** (the spec lane's worked example), labelled `to-build` and dispatched by lane 04's
reconciler. It opens **PR #501** on branch `implement/issue-421` — the pull request lane 06 then
judges.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript ·
**[stop]** can refuse and end the run.

---

## Node 00 — the one door · [stop]

`implement-caller.yml` `on:` / `implement.yml` `jobs.implement.if`

This lane has one way in — no push door, no critique door, unlike lanes 02 and 06.

| | |
|---|---|
| **Fires on** | `repository_dispatch`, `types: [ticket-ready]` |
| **Passes when** | `github.event.action == 'ticket-ready'` |
| **Who sends it** | Exactly one caller: `dispatchTicketReady()`, called from [`dispatch/reconcile.ts`](../../.Workflow/agent-workflows/dispatch/reconcile.ts) — lane 04's own recompute — and only for a ticket that is *ready* (every blocker delivered) **and** already carries an authored acceptance test. A ready ticket with no test dispatches `acceptance-wanted` instead, to lane 04's own author; this lane never sees it. |
| **Concurrency** | `implement-${{ issue }}`, `cancel-in-progress: false` — grouped per ticket, not per run. A second `ticket-ready` for #421 queues rather than racing this one. |
| **Refused a stage earlier still** | `reconcile.ts`'s own `toBuildRefusal()` checks the ticket's shape and its `## Files claimed` against the immutable set *before* ever dispatching — the same refusal lane 06's Immutability job would eventually produce, caught here so an implementer and a pull request are never spent to arrive at it. |

### edge — `client_payload` · one field

```json
{"event_type": "ticket-ready", "client_payload": {"issue": 421}}
```

Everything else — the ticket body, its seams, its files claimed — this lane reads for itself off
the tracker, rather than being handed it.

Before any TypeScript runs, the job also: checks out the machine and the target side by side,
**refuses if `CLAUDE_CODE_OAUTH_TOKEN` is empty** (before Node is installed), sets up Node,
installs the target's dependencies with a bare `npm ci` — no `target-deps` action here, unlike lane
06's own checkout; see *Loose ends* — pins `@anthropic-ai/claude-code@2.1.241`, configures the
committer identity (`github-actions[bot]`, since this lane's own commits need one), and puts a
running-label on the ticket.

---

## Node 01 — claim the branch · [wire] [stop]

`shared/implementation-landing.ts` `claimImplementationBranch`

| | |
|---|---|
| **Branch name** | `implement/issue-421` — `implementationBranch(421)` |
| **Claims by** | `POST /git/refs`, creating `refs/heads/implement/issue-421` at the target's current HEAD. A creation that fails **is** the refusal — GitHub itself is the lock, not an application-level check |
| **On collision** | `assessClaim()`: **live** if the branch already carries a pull request, already has commits ahead of trunk, its creation time can't be read, or the check itself errors — every uncertain case reads as live, never stale. **stale** only past 45 minutes (`CLAIM_TIMEOUT_MINUTES`) with none of those true: a run that died before writing anything |
| **Live claim** | Outcome `already-claimed`. No comment, nothing past the console log — a duplicate dispatch for a ticket already being built is a silent no-op, not an event |
| **Stale claim** | Deletes the old ref, creates a fresh one, and posts the one comment this node can produce: *"Took over a stale claim on `implement/issue-421`..."* |

Why this exists *alongside* the workflow's own per-issue `concurrency:` group: the group only
serializes two runs of *this* workflow. It has no way to know whether the run holding the branch is
still alive 45 minutes later, or dead with nothing to show for it. The ref is the thing a stale run
can be judged against from outside its own execution — see *Two things worth knowing*.

---

## Node 02 — is the ticket still open? · [wire] [stop]

`implement.ts` `buildAndOpen`

One `gh issue view --json state` read. `CLOSED` → release the claim, log it, and stop — no comment,
because there is nothing left to say on a closed ticket. A dispatch can outlive the thing it names:
the owner might close #421 by hand between the dispatch firing and the runner starting.

---

## Node 03 — assemble the brief · [wire]

`implement.ts` `buildAndOpen` → `assembleBrief`

Four reads, joined into one document. This is the whole of what the model at node 04 is allowed to
know.

| | |
|---|---|
| **`ticketBody`** | `readTicket(421)` — the issue body, verbatim |
| **seam manifest** | `extractSeamsConsumed()` — the ticket's `## Seams consumed` lines |
| **module context** | `moduleContextPath()` walks up from the first `## Files claimed` path looking for a `CONTEXT.md`, falling back to the root one |
| **failing tests** | `findFailingTestFiles()` — every suite test file whose body matches `` /^\s*(?:test|it)\.fails\([^\n]*#421\b/m `` gets inlined whole |

### edge — `BriefInputs` · the assembled Markdown

```
## Ticket
Implement #421: ...

## Seam manifest lines consumed
- scripts/nightly-run.ts exports `summariseRun(conclusion): string`

## Module CONTEXT.md
canary — an enrolled repository that proves a machine change on real GitHub before it lands
...

## Acceptance test(s) to turn on
### scripts/canary-summary.test.ts

test.fails("#421: writes a job summary that quotes the run's own conclusion", () => { ... });
```

`(none)` fills any section with nothing to say — the brief never omits a heading.

---

## Node 04 — the implementer · [model] [stop]

`implement/implementer/prompt.md` · `implement.ts:104`

| | |
|---|---|
| **Model** | `claude-sonnet-5` |
| **Tools** | unrestricted — `runImplementer` passes no `allowedTools`/`disallowedTools` at all, the only stage in this lane with no fence. It has to be: the prompt has it run `npx vitest run <path>` on its own acceptance tests and `npm run check` before it ever answers, so Bash is load-bearing here, not incidental |
| **Non-negotiable 1** | *"The acceptance test(s) in the brief are the spec."* Turn each `test.fails(` on by deleting `.fails` from exactly that line, nothing else about it — the push after the answer diffs for any other edit to that line and refuses the whole run if it finds one |
| **Non-negotiable 2** | *"You write files; `git` and `gh` belong to the process that called you."* Every write to version control happens after the answer, never inside it — the model's only channel out is its structured answer |
| **Also asked** | Repair whatever its own change reddened, outside its claimed files, and name every such file in the summary — claimed files bound what it *decides*, never what it *repairs* ([ADR-0110](../adr/0110-files-claimed-bound-what-a-run-decides-not-what-it-repairs.md)) |
| **Checkpointed** | Same machinery as lane 02: keyed on `sha256(HEAD + the rendered prompt)`, written to `.Workflow/agent-workflows/checkpoints/implementer.json`. Re-running against the same commit with the same brief replays without spending Sonnet again |

### edge — `ImplementerAnswer` · schema-validated JSON

```json
{"files": [
  {"path": "scripts/canary-summary.ts", "content": "..."},
  {"path": "scripts/canary-summary.test.ts", "content": "..."}
],
 "summary": "Wrote the run's own step summary from its conclusion via $GITHUB_STEP_SUMMARY. Turned
   on the ticket's acceptance test. Repaired scripts/nightly-run.test.ts, outside Files claimed:
   its fixture still asserted the old summary-less shape this change replaced.",
 "outOfBriefReads": ["scripts/nightly-run.ts"]}
```

A response that fails `ImplementerAnswer.parse()` ends the run here; the raw text is saved to
`<handoff dir>/implementer-raw-response.txt` rather than lost.

---

## Node 05 — record the out-of-brief reads · [wire]

`implement/out-of-brief.ts` `recordOutOfBrief`

Non-blocking, one call per entry in `outOfBriefReads`. Finds the one open issue titled "Out-of-brief
reads by module (ADR-0042)" (files it if none exists), and appends a comment bumping that module's
own count marker. Nothing here can change this run's outcome — it is evidence about the *seam
manifest*, not about the implementer
([ADR-0042](../adr/0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md)).

### edge — the count marker

```
<!-- out-of-brief:scripts/nightly-run.ts:3 -->
```

---

## Node 06 — land the answer · [wire] [stop]

`shared/implementation-landing.ts` `landAnswer`

The busiest node in the lane, and the one that turns an answer into a pull request — or refuses it.

| Step | What happens |
|---|---|
| 1. Write | Every file in `answer.files`, in full, to the target worktree |
| 2. Nothing changed? | `worktreeChanges()` — `git status --porcelain` on exactly the claimed paths. Empty → release the claim, comment `nothingToBuildNote()`, outcome `nothing-to-build`. An implementer that returns the ticket's files exactly as trunk already has them is a real outcome, not a bug |
| 3. Regenerate the ADR index | Only if a written path starts with `docs/adr/` — the regenerated index is appended as an extra path to commit |
| 4. The fails rule | `judgeFailsEdits(git diff)` refuses if a removed `test.fails(`/`it.fails(` line's paired addition is anything other than that same line with `.fails` dropped. Refused → release the claim, `escalateToOwner()` (adds `needs-human`, assigns `$GITHUB_REPOSITORY_OWNER`), comment `failsRuleNote()`, outcome `fails-rule-refused` — the only outcome that exits the process non-zero |
| 5. Rebase onto trunk | `git fetch origin main && git rebase origin/main`, always, for this lane. Conflict → abort the rebase, release the claim, escalate, comment `rebaseConflictNote()`, outcome `rebase-conflict` — resolved by a human, never guessed at |
| 6. Commit, push, open | One commit, pushed to the claimed branch, then `gh pr create` and `dispatchVerify()` — the exact door lane 06 answers, [documented there](verify-lane-edges.md#node-00-the-two-doors-stop) |

### edge — the commit message

```
Implement #421

Wrote the run's own step summary from its conclusion via $GITHUB_STEP_SUMMARY. Turned on the
ticket's acceptance test. Repaired scripts/nightly-run.test.ts, outside Files claimed...

Part of #421
```

### edge — `gh pr create` · argv

```
gh pr create \
  --title "Report the nightly canary's own conclusion" \
  --body  "Wrote the run's own step summary...

Closes #421" \
  --head implement/issue-421

→ https://github.com/collod873/claude-workflow/pull/501
```

### edge — `repository_dispatch` · continuing straight into the other document

```json
{"event_type": "implementation-opened",
 "client_payload": {
   "pr": "https://github.com/collod873/claude-workflow/pull/501",
   "changed_files": ["scripts/canary-summary.ts", "scripts/canary-summary.test.ts"],
   "criteria": ["I'll know it works when I can open the last nightly run and read its own summary without clicking into a job"]
 }}
```

---

## Node 07 — if it died instead · [wire]

`implement.yml` (always-steps) → `recover-caller.yml` → `recover.yml`

Two independent ways this run's death gets noticed, not one.

| | |
|---|---|
| **Signal 1** | `implement.yml`'s own `if: failure() \|\| cancelled()` step fires `repository_dispatch: implement-failed`, carrying `run_id` and `issue`. Needs the job to survive long enough to reach that step |
| **Signal 2** | `recover-caller.yml` separately listens for `workflow_run: [Implement], types: [completed]` with conclusion `failure` or `cancelled` — GitHub's own event, which fires even when the runner is killed before Signal 1's step ever runs |
| **Either wakes** | `recover.yml`, with `RUN_ID` set from whichever signal arrived |
| **What it can do** | Read the dead run's own uploaded `implementer-answer-421` artifact. If the model already answered and only the landing steps died, `recover.ts` replays `landAnswer()` against that artifact directly, spending **no** second Sonnet call ([ADR-0114](../adr/0114-a-red-lane-05-run-is-recovered-from-its-own-artifact-and-han.md)). No artifact → it re-dispatches `ticket-ready`, and this whole lane runs again from node 00, claim and all |
| **Always, regardless of outcome** | The `implementer-answer-421` artifact is uploaded (`if: always()`), and the running-label comes off |

---

## What each stage may touch

| Stage | Model | Reads the target | Writes to git | Can act on the ticket |
|---|---|---|---|---|
| setup (node 00) | — | checkout only | — | running-label on/off |
| claim (node 01) | — | no | creates a ref | — |
| ticket-closed check (node 02) | — | no | — | no |
| assemble brief (node 03) | — | yes — files, `CONTEXT.md`, tests | — | no |
| implementer (node 04) | sonnet-5 | yes, unrestricted (Read/Grep/Glob/Edit/Write/Bash) | writes only inside its own answer, never `git` | no |
| out-of-brief (node 05) | — | no | — | comments on the *tracker* issue, never the ticket |
| land the answer (node 06) | — | writes files | commits, rebases, pushes, opens the PR | comments; `needs-human` on refusal |
| recover (node 07) | — | reads the dead run's artifact | may commit/push, replaying `landAnswer` | may re-dispatch `ticket-ready` |

---

## Where it stops

Ordered by how much has been spent when it fires.

| Cost | Where | Fires when |
|---|---|---|
| free | `reconcile.ts`'s `toBuildRefusal()` | Malformed ticket shape, or `## Files claimed` touches the immutable set — refused before this lane is ever dispatched |
| free | `implement.yml`'s `if:` | Not a `ticket-ready` dispatch |
| one runner, no checkout | preflight | `CLAUDE_CODE_OAUTH_TOKEN` is empty |
| one runner, before the model | node 01 | The branch's claim is live elsewhere |
| one runner, before the model | node 02 | The ticket closed between dispatch and run |
| 1 Sonnet call | node 04 | `ImplementerAnswer` fails its schema — the raw response is kept, not lost |
| after the model, before any commit | node 06 step 2 | Nothing changed |
| after the model, before any commit | node 06 step 4 | The fails rule — a `test.fails(` test was edited beyond turning it on |
| after the model, before push | node 06 step 5 | Rebase conflict onto trunk |
| 45 min | `implement.yml` `timeout-minutes: 45` | The job is cancelled outright — see *Two things worth knowing* |

---

## Two things worth knowing

**The 45 minutes are the same 45 minutes, on purpose.** `CLAIM_TIMEOUT_MINUTES` (node 01's staleness
window) and `implement.yml`'s own `timeout-minutes: 45` (this job's hard ceiling) are the identical
number. That is not a coincidence to notice — it is the guarantee the claim logic depends on: by the
time a claim is old enough to call stale, GitHub itself has already killed whatever run made it.
There is no window where a claim reads as stale while its own run might still be alive to contest
the takeover.

**Recovery replays the answer, not the model.** A run that dies after node 04 but before node 06
finishes has already paid for the one thing that costs money. `recover.ts` checks for that first —
the uploaded `implementer-answer-421` artifact — and if it is there, feeds the same
`ImplementerAnswer` straight back into `landAnswer()` rather than re-dispatching and re-spending
Sonnet. Only a genuinely answerless death (the model itself never returned) falls back to running
this lane over from node 00.

---

## Loose ends in the tree

- `implement.yml` installs the target's dependencies with a bare `npm ci`, not the `target-deps`
  composite action lane 06 uses to detect the target's own package manager. An enrolled repository
  on yarn or pnpm would be checked correctly by lane 06 and likely fail this lane's own install step
  first.
- `criteria[]` is assembled here with real care — `extractCriteria(ticket.body)`, one entry per
  acceptance criterion — for the `implementation-opened` dispatch. As
  [`verify-lane-edges.md`](verify-lane-edges.md#loose-ends-in-the-tree) notes, nothing downstream
  ever reads it.
