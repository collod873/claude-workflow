# The reconcile lane, edge by edge

Lane 04, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

Unlike every other lane in this pipeline, this one is two reusable workflows sharing a single job:
the recompute, [`.github/workflows/dispatch-reconcile.yml`](../../.github/workflows/dispatch-reconcile.yml)
(caller stub [`dispatch-reconcile-caller.yml`](../../.github/workflows/dispatch-reconcile-caller.yml)),
and the author, [`.github/workflows/acceptance.yml`](../../.github/workflows/acceptance.yml) (caller
stub [`acceptance-caller.yml`](../../.github/workflows/acceptance-caller.yml)). State machines:
[`.Workflow/agent-workflows/dispatch/reconcile.ts`](../../.Workflow/agent-workflows/dispatch/reconcile.ts)
and [`.Workflow/agent-workflows/acceptance/acceptance.ts`](../../.Workflow/agent-workflows/acceptance/acceptance.ts).
The recompute spends no model call at all — its own source is asserted to lack
`@anthropic-ai/claude-code` and `CLAUDE_CODE_OAUTH_TOKEN` entirely
(`shared/lane-wiring.ts`'s `LANE_WIRING["dispatch-reconcile"]`). Only the author spends one, a
single pinned Opus call per authoring pass.

Payload contents below are a worked example built to the real shapes and rules. The example run
continues [`to-tickets-lane-edges.md`](to-tickets-lane-edges.md)'s own: **ticket #420** (wave 0,
nothing blocks it) and **ticket #421** (depends on #420), both freshly published sub-issues of
**PRD #419**. This lane authors acceptance tests for both, rings lane 05 for #420 immediately, and
— once #420 delivers — rings lane 05 for #421 the moment its own recompute notices the blocker
cleared, the run [`implement-lane-edges.md`](implement-lane-edges.md) and
[`verify-lane-edges.md`](verify-lane-edges.md) pick up.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript or
shell · **[stop]** can refuse and end the run.

---

## Part one — the recompute (`dispatch-reconcile.yml`)

## Node 00 — the eight doors · [stop]

`dispatch-reconcile.yml` `jobs.reconcile.if`

```
github.event_name == 'workflow_dispatch' ||
github.event_name == 'workflow_run' ||
github.event_name == 'push' ||
github.event.action == 'session-captured' ||
github.event.action == 'graph-changed' ||
github.event.action == 'run-ended' ||
(github.event_name == 'issues' && github.event.action == 'labeled' &&
 github.event.label.name == 'to-build' &&
 github.event.sender.login == github.repository_owner) ||
(github.event_name == 'issues' && github.event.action == 'unlabeled' &&
 (github.event.label.name == 'needs-human' || github.event.label.name == 'by-hand') &&
 github.event.sender.login == github.repository_owner)
```

| | |
|---|---|
| **Door 1 — manual** | `workflow_dispatch` |
| **Door 2 — session-captured** | `repository_dispatch`, sent by `.claude/hooks/session-capture-hook.mjs` at the end of a local session. The same dispatch also wakes `audit.yml`, `run-watchdog.yml`, and `walk-home.yml` — this lane is one listener among several, not the event's owner |
| **Door 3 — graph-changed** | Sent by lane 08 (`integrate.ts`, `announceGraphChanged`) once it merges — "a merge announces without interpreting" |
| **Door 4 — to-build label** | `issues:labeled`, `label.name == 'to-build'`, sender must be the repo owner — the hand-off door ([`pipeline-labels.md`](pipeline-labels.md)) |
| **Door 4b — hold lifted** | `issues:unlabeled`, `label.name` is `needs-human` or `by-hand`, sender must be the repo owner, arriving as `graph-changed`. Lifting a hold is the owner's whole recovery gesture after a strike decision and a to-build refusal; before this door the recompute heard a label added and never one removed, so a lifted hold waited for whatever event happened next (#471's `by-hand`, lifted 2026-09-11 10:51, dispatched only when #473's label rang a minute later) |
| **Door 5 — a lane you started ended** | `workflow_run: completed` on every caller stub in the estate except this one (`ENDING_LANES`, `shared/lane-wiring.ts`, pinned to the caller set by test). GitHub fires it for every conclusion, `cancelled` included, **but starts a run from it only when the ended run's actor is a person**: a push-triggered Verify, a label you applied, a hand `workflow_dispatch`. A run the machine itself started with `repository_dispatch` under `GITHUB_TOKEN` (`actor: github-actions[bot]`, which is every Implement, Mechanic, Acceptance and To-Tickets run) completes without waking anything here; see *why the completed event was missed* below |
| **Door 6 — main moved** | `push` to `main`, no paths filter: a docs-only commit that says `Closes #421` changes the graph as much as a code one |
| **Door 7 — a lane the machine started says it ended** | `repository_dispatch: run-ended`, sent by the last step of `implement.yml` and `mechanic.yml` under `if: always()`, and by `acceptance.yml`'s own `wake-reconciler` job (node 07), carrying only `run_id`. This is the door a run killed at `timeout-minutes` actually arrives through: an `always()` step or job runs after the cap cancels the work (the running-label comes off the same way), and a `repository_dispatch` is the one bot-originated event GitHub honours. It says nothing about how the run ended; the recompute reads the run off the API as it always did ([ADR-0165](../adr/0165-reconcile-is-the-only-connector-that-starts-work-and-it-fire.md), as amended by [ADR-0177](../adr/0177-a-run-the-machine-started-says-its-own-ending-because-github.md)) |
| **Concurrency** | `dispatch-reconcile`, global, one at a time, `cancel-in-progress: false` — no per-issue key, because one run reconciles the whole tracker at once. Doors 5, 6 and 7 make this the most-fired lane in the estate; each firing is a wire that reads and, usually, does nothing |

### Why the completed event was missed before #445

`collod873/Lumaria`, 2026-09-10: Implement #880 (run 34530270263, `actor: github-actions[bot]`)
was cancelled by its cap at 21:51:45. No Dispatch reconcile run followed; the next was a hand
`workflow_dispatch` at 22:10, and #880's bare claim sat for nineteen minutes. Reading every run in
both repositories that day: every Dispatch reconcile run with `event: workflow_run` has
`triggering_actor: collod873`, and not one bot-started lane run, whatever its conclusion, was
followed by any `workflow_run`-triggered run at all. A hand-sent `prd-sliceable` (To-Tickets run
34535319465, actor `collod873`) woke the reconciler two seconds after it failed; the bot-sent one a
minute earlier (34534729757) woke nothing. This is GitHub's recursion guard: an event an action
causes under `GITHUB_TOKEN` starts no workflow, `workflow_dispatch` and `repository_dispatch`
excepted, and a bot-started run's own completion counts as such an event. Door 5's claim that
"every ending" reaches here was true only of endings a person had set in motion.

### edge — `EVENT_ACTION`, a collapse worth reading carefully

```
EVENT_ACTION = (github.event_name == 'repository_dispatch' && github.event.action)
            || (github.event_name == 'workflow_run' && 'run-ended')
            || (github.event_name == 'push' && 'main-moved')
            || 'session-captured'
```

`main()`'s own guard checks `EVENT_ACTION` against `RECONCILE_ENDINGS`:
`[session-captured, graph-changed, run-ended, main-moved]`. On doors 1 and 4 — the manual door and
the label door — `EVENT_ACTION` is synthesized as the literal string `'session-captured'`, because
neither is actually a `repository_dispatch` event and the expression falls through to its last
right-hand side. The guard passes for all six doors, but not because the label and manual doors
are secretly session-captured events; they simply never reach the branch that would read a real
one. Reading `main()`'s guard alone, without this, makes it look like doors 1 and 4 shouldn't pass
it at all. Nothing downstream reads which door opened: every door runs the same recompute.

---

## Node 01 — fetch state · [wire] [stop-if-degraded]

`ticketState()`, `ticket-state.ts`

Every tracker read the pass makes happens here, once per ticket, before any decision is taken:
`ticketState()` returns one `TicketState` per open issue carrying its labels, blockers and their
delivery, started-ness, door verdict, strikes and whether an acceptance test is authored.
`runReconcile()` decides and writes against those records and never reads a ticket back — which is
why nothing downstream has to keep a private copy of the labels it just wrote ([#550](https://github.com/collod873/claude-workflow/issues/550)).

Three reads, each of which can **degrade** the whole run — `{action: "degraded", ...}`, exit 1,
**no comment posted anywhere**. This is a distinct failure mode from every refusal elsewhere in
this pipeline: a degraded run is silent to the tracker, visible only as a red Actions run.

| Read | How | Degrades when |
|---|---|---|
| Open issues | `gh issue list --state open --limit 100 --json number,title,body,labels` | Response unparseable or erroring (a page-boundary at exactly 100 only warns) |
| Claimed branches | `gh api .../git/matching-refs/heads/implement/` | Same — the `implement/issue-N` refs are the same "started" claim `implement-lane-edges.md`'s node 01 documents |
| Dependency graph | Per open issue, `fetchBlockers()` (`blocked_by` API) builds `SliceState[]` | Same |

Each blocker's `delivery` is computed once, via `deliveryOf()`: open → `"open"`; closed but not
`state_reason: "completed"` → `"undelivered"`; closed `completed` **and** a merged PR is found
closing it → `"delivered"`, otherwise `"undelivered"`. A hand-closed slice with no merged PR reads
as undelivered — an accepted cost, not a bug.

---

## Node 02 — the PRD self-close pass · [wire]

`evaluateSpecCheck()`, `reconcile.ts`

For every open `prd`-labelled issue with at least one sub-issue:

| | |
|---|---|
| **Not runnable** | The PRD's body doesn't parse to exactly one criterion with a well-formed `check:` marker — comments `"Could not run this spec's check: <reason>."` (with a hidden marker), adds `needs-human` if absent |
| **Runs the check** | `spawnSync(command, {shell: true, cwd: targetWorkspace})` — the spec's own criterion command, against the target |
| **Exit 0, all children delivered** | `attemptSpecClose()` — synthesizes a merge-order range from the children's merge SHAs (sorted by merge time) and hands `bin/close-ticket --spec <n> <range>` the range |
| **Check passes, closer refuses** | Posts a disagreement comment naming both exit codes: "This spec stays open." No escalation — the closer refusing is information about the spec, not about this run |
| **Otherwise** | Comments the verdict — `"Ran this spec's own check: \`cmd\`\n\nExit N."` — and clears `needs-human` if this pass's own earlier refusal is what put it there |

---

## Node 03 — `to-build` shape admission · [wire] [stop-per-issue]

`doorOf()` / `toBuildRefusal()`, `ticket-state.ts`; the writes are `recordDoor()`, `reconcile.ts`

Every open issue carrying `to-build` is checked:

| Refuses when |
|---|
| `assertTicketShape(body)` throws — missing `## Acceptance criteria` or its `- [ ]` items, missing `## Files claimed`, or a claimed entry that is a glob rather than one file |
| No acceptance criterion carries a `check:` marker — the same line `bin/close-ticket` draws at close |

`assertTicketShape()` raises the five refusals the rules source spells, the same five
`bin/ticket_shape.py` raises at filing (claude-workflow/ADR-0184). The door wants that verdict and
no warning: warnings are the Python's alone, and reaching for them here would cost a `python3`
spawn per open issue.

`recordToBuildShape()` posts **one standing comment per issue**, keyed by a hidden marker
(`<!-- to-build-refused:v1 -->`), rather than commenting every run:

### edge — the standing comment, refused

```
This is labelled `to-build` and lane 06 will not start against it: <reason>.

Refused here rather than three stages later: verify's Immutability job reads the same
`## Files claimed` section, so a run started against this body would spend an implementer and a
pull request to arrive at the same answer.

Add what is missing and the next session end starts it. The `to-build` label stays
where it is; nothing here has to be re-applied.

<!-- to-build-refused:v1 -->
```

Cleared → the same comment is rewritten to say so, **dropping the marker**, so a later re-refusal
posts a fresh comment rather than editing the cleared one. Unchanged from last pass → no-op, so a
persistently-refused ticket doesn't accumulate a comment per run.

The comments are read only when there is something to say: a refusal now, or a `needs-human` the
door itself may have to lift. A ticket that passes and holds no `needs-human` costs no API call
here at all. An owner who lifts `needs-human` by hand without fixing the body leaves the standing
refusal in place until the next refusal rewrites it, which is true either way.

Every post or rewrite of the refused comment also calls `escalateToOwner()`, adding `needs-human`
so the session brief's own `needs-human` section carries the ticket and a later recompute does not
just skip it again in silence. A run that finds the shape fixed rewrites the comment to the cleared
body and lifts `needs-human` the same way node 02's spec pass does for its own earlier refusal —
"clears `needs-human` if this pass's own earlier refusal is what put it there." An owner holding
the ticket for another reason re-applies the label the same way they do after a strike decision.
The by-hand stand-down (`recordByHandStandDown()`) is the deliberate exception: it never adds
`needs-human` and is never dispatched, whatever its shape.

A claim only a human can build never reaches that refusal either. `isByHandClaim()` — the same
predicate lane 03's publisher labels a slice with, so the two cannot drift — is read first, and it
covers both the immutable set and workstation paths (`~/`, `.claude/settings`), which a claim
touching either of makes unbuildable by any pull request. The door applies `by-hand` itself and
stands down. Nothing is missing from such a ticket, so asking the owner to repair it would spend a
human on reading a comment and clicking the label the door already knew to apply.

A claim wider than `CLAIM_LIMIT` never reaches that refusal at all. `overWideClaim()` is read
before `toBuildRefusal()`, and `sendToSlicing()` sheds `ticket` and `to-build`, adds `prd` and
`sliceable`, says so in a `<!-- sent-to-slicing:v1 -->` comment, and requests `prd-sliceable`.
Lane 03 then slices the issue into sub-issues of it, each held to the same ceiling by
`validate-graph.ts` as it is written. The reasoning is the one this door exists to serve: every
other refusal here names something a human adds in a minute — a missing heading, a missing
`check:` marker — but a nine-file claim is not a body anyone repairs, it is the wrong number of
tickets, and the machine already owns a lane that turns one of those into several. Handing it to
the owner spends a human on work lane 03 does unattended. The marker makes it once-only; the
by-hand stand-down still wins, because slicing work no pull request may land would only produce
more of it. Lane 03's own two doors (a PRD with sub-issues, a PRD that is itself a sub-issue)
stay the backstop, and say so on the issue under `slice-failed` rather than here.

---

## Node 04 — compute readiness and dispatch · [wire]

`reconcile.ts`

```ts
// startable: a published slice (## Parent PRD heading, lane 03's own output) OR admitted at the
// to-build door — intent to build is asserted, never inferred from shape alone. Both are already
// on the record, computed once by ticketState().
const ready = tickets.filter(t => t.startable && t.ready && t.hold === undefined && t.landedPr === undefined);
```

For each `ready` slice, `testsForCriteria(criteriaOf(slice), targetWorkspace)` greps every
`.test.ts` under `SUITE_ROOTS = [".Workflow", ".claude"]` of the **target** checkout for the
criterion string, verbatim:

| No matching test found | A matching test already exists |
|---|---|
| `dispatchAcceptanceWanted(number, true)` — back into this same lane's own author, after the ladder below has counted the ticket's dead runs; on the third strike nothing is sent and the decision is posted instead | `dispatchTicketReady(number)` — rings lane 05 directly. This is the branch #421 takes once #420 delivers: its test was already authored back when lane 03 first published it, so the recompute finds it and skips straight past the author |

### edge — the three outbound dispatches

```json
{"event_type": "acceptance-wanted", "client_payload": {"issue": 421, "ready": 1}}
{"event_type": "acceptance-wanted", "client_payload": {"issue": 421, "ready": 1, "rung": "fresh-eyes"}}
{"event_type": "ticket-ready", "client_payload": {"issue": 420}}
{"event_type": "ticket-ready", "client_payload": {"issue": 420, "rung": "fresh-eyes"}}
{"event_type": "mechanic-wanted", "client_payload": {"issue": 420}}
```

Sent directly via `gh`, no split-job file-collection like lanes 02 and 03 use — this workflow is a
single job holding `contents: write, issues: write, actions: read, pull-requests: read` throughout, so there's no separate
model-spending job whose token needs protecting from write access.

### The ladder · `climbLadder()`, `shared/strikes.ts`

Before a `ticket-ready` or an `acceptance-wanted` goes out, the recompute asks what already died
on this ticket.

| | |
|---|---|
| **In flight** | `gh run list --limit 100 --json databaseId,displayTitle,status,conclusion,url`, one call. A ticket is in flight when a non-completed run's title is `Implement #420`, `Mechanic #420` or `Acceptance #420` — the caller stubs' `run-name` — and an in-flight ticket is `started` whatever the refs say |
| **A bare claim** | `implement/issue-420` exists, no run carries #420, no pull request, no commits: a dead run's leftover. `releaseDeadClaim()` deletes the ref and the ticket reads as unstarted. A branch with a pull request or commits is somebody's work and stays |
| **Dead runs** | Completed runs titled `Implement #420`, `Mechanic #420` or `Acceptance #420` whose conclusion is `failure`, `cancelled` or `timed_out`, minus those a strike comment already names. An Acceptance death is a strike like any other (#457): before it was, a ticket whose author died by its 30-minute cap every time would have been re-dispatched immediately and forever once door 7 heard it, one Opus call per half hour |
| **The strike** | One comment per dead run: `<!-- strike:v1 run=<id> conclusion=<c> -->`, the signature (`<!-- strike-signature:… -->`, the last `implement failed:`, `mechanic failed:` or `acceptance … failed:` line of `gh run view --log-failed`, or `<conclusion> before answering` when nothing said why), the run's URL, and what follows. At most ten logs are read per recompute |
| **The rung** | `rungFor(strikes)`: 0 → `ticket-ready`; 1 → `ticket-ready` with `rung: fresh-eyes` (lane 05 skips its first model); 2 → `mechanic-wanted` ([mechanic-lane-edges.md](mechanic-lane-edges.md)); 3 → the decision. A ticket with no test yet climbs the same count onto its own two rungs: 0 → `acceptance-wanted` bare, and every rung short of the decision → `acceptance-wanted` with `rung: fresh-eyes`, which hands the author the signature of every strike standing on the ticket ([ADR-0183](../adr/0183-the-acceptance-author-gets-a-second-rung-and-it-is-the-strik.md)). The mechanic has no rung here because it authors nothing. A strike earned by the author still counts once a test exists, since the count is the ticket's |
| **The decision** | One comment (`<!-- strike-decision:v1 -->`) listing every strike with its run, whether the signatures repeat, and three lettered options with a recommendation; `needs-human` and the owner assigned. Nothing is dispatched. Strikes before the decision no longer count, so removing `needs-human` starts the ladder from rung one; a fourth death after the decision is a new first strike |
| **`needs-human` on a ticket** | is the owner's hold: the recompute never dispatches such a ticket, whatever its strikes say. Which is why a dead Acceptance, Implement or Mechanic job's own `if: always()` step stamps `queued` rather than `needs-human` as the other lanes' does ([venues.md](venues.md)): a lane that hands its ticket to the owner on its first death nails it down before rung one, and the ladder above never runs. It stamps `queued` rather than clearing the label because `startableNumbers()` admits a ticket with no `## Parent PRD` only while it wears a lane label, so a bare clearing would drop a `to-build` ticket out of the recompute altogether and it would fall silent instead. #539 was the one that showed both |
| **In a dry run** | no strike is written, no claim released, and a bare claim reads as started |

---

## Node 05 — unreachable slices · [wire]

`unreachableSlices()` / `reportUnreachable()`, `reconcile.ts`

A slice is unreachable when it's transitively blocked on a blocker that closed without delivering
— permanently stuck, never a park.

| Zero findings | Findings (capped at 10, filtered against what's already named) |
|---|---|
| A standing "Unreachable slices" issue, if one exists, is closed with a retirement comment: `"## Closing record\n\nNo diff.\n\nNothing is unreachable..."` | Comments the standing issue, or files a fresh one — title "Unreachable slices: a blocker closed without delivering," citing [ADR-0011](../adr/0011-a-refusal-ships-only-once-something-can-clear-it.md) for why this is a standing count, not a parked queue |

---

## Node 06 — outcome

`main()` prints `"${action}: ${note}"` and exits non-zero **only** on `degraded`. `clear` and
`dispatched` both exit 0 — a green run says nothing about whether anything actually happened.

---

## Part two — the author (`acceptance.yml`)

## Node 07 — the acceptance door · [stop]

`acceptance-caller.yml` `on:` — `issues: [edited]` and `repository_dispatch: [acceptance-wanted]`.
Concurrency: `acceptance-${{ issue.number || client_payload.issue }}`.

Three jobs:

| Job | Fires when | Does |
|---|---|---|
| `refire` | `issues:edited`, PRD labelled, sender is the repo owner — the owner hand-edited a PRD body (a spec-gap amendment) | Checks out machine + target, runs `acceptance.ts --refire "$PRD_NUMBER"`, committing each affected slice to that slice's own branch |
| `author` | `action == 'acceptance-wanted'` — node 04's own dispatch door | Marks the ticket `running`, runs `acceptance.ts "$TICKET_NUMBER"`, unmarks on `always()` |
| `wake-reconciler` | `needs: [refire, author]`, `always()`, and at least one of `refire`/`author` was not skipped — so an issue edit that opened no job rings nobody | Rings door 5's `run-ended` with this run's own id, whatever ended it: a cap at `timeout-minutes` cancels `author` but this job still runs |

There is no `land` job. [ADR-0186](../adr/0186-acceptance-lands-on-the-ticket-s-branch-because-adr-0150-del.md)
put the lane on `implement/issue-N`, the branch lane 05 already cuts, which deleted the patch-artifact
replay onto `main` and the repo-wide `land-${{ github.repository }}` group that serialised every slice
behind every other one.

---

## Node 08 — `refireAcceptance()` (the refire path) · [wire]

`acceptance.ts`

Reads the PRD and its **open** sibling slice numbers; a closed slice's work is already on main and
is never re-authored. For each open sibling whose criteria are already matched by an existing
authored test, it compares the body before the edit (`PRD_BODY_BEFORE`, GitHub's own
`changes.body.from`) with the body after: a criterion the edit itself took out of the spec makes
that slice *affected*, and `authorForSlice()` re-enters node 09 in-process for it. A criterion the
spec never carried is not affected, which is most of them, since the slicer writes its own wording
rather than copying the spec's ([ADR-0181](../adr/0181-a-spec-edit-re-fires-acceptance-only-for-what-the-edit-remov.md)). A criterion no existing test
names at all is ignored here — "that's a re-slice, not a re-entry." No earlier body — a title-only
edit, or a run by hand — re-authors nothing rather than everything.

---

## Node 09 — `authorAcceptanceTests()` · [model, opus-5] [stop]

`acceptance.ts`, `AUTHOR_MODEL = "claude-opus-5"`

Refuses upfront if the ticket names zero criteria. Otherwise the prompt
([`acceptance/author/prompt.md`](../../.Workflow/agent-workflows/acceptance/author/prompt.md)) is
rendered directly — **no toolbelt at all**, "you have no tools but the one you answer through" —
carrying the ticket body, the parent PRD body, every criterion pre-extracted and numbered, and the
**full contents of every claimed file, inlined** (a sentinel string stands in for a file that
doesn't exist yet, another for an empty claim). This inlining exists because a blind author can
only imagine a file it can't see — after this lane's first production run wrote two wrong-shaped
tests out of four.

Per test, the model must: quote the criterion block verbatim in a comment directly above the test
(so a later grep for it succeeds), name it `test.fails("#<n>.<i>: ...", ...)` where `<i>` is the
criterion's own index, import and exercise the
real subject (stubbing a not-yet-existing subject's exports to throw `new Error("#N: not built")`),
and mark it `test.fails` — green today means correctly not-yet-built; red today means it's
accidentally already satisfiable, or unsatisfiable, either way refused.

### edge — an authored file (excerpt)

```ts
// #421.1: the summary line quotes the run's own conclusion, never a stock string
test.fails("#421.1: writes a job summary that quotes the run's own conclusion", () => {
  ...
});
```

Post-response wire checks, before anything is written:

| Refuses when |
|---|
| A returned path isn't under `.Workflow/` or `.claude/` |
| Any criterion index has no `test.fails(`/`it.fails(` call naming `#<issueNumber>.<index>` across the batch (`authoredCriterionTitleRe`) |
| No file returned is a `.test.ts` at all |

---

## Node 10 — judge, commit, push · [wire] [stop]

`acceptance.ts`

Runs just the newly written test files against the target's own `vitest.config.ts`, then the
**stop** venue (`typecheck`, `lint_one`, `test_related`) on those files alone — not the full push
gate, which a branch has nothing to protect from and the pull request's own CI runs once at merge:

| Refuses when |
|---|
| The file fails to collect at all |
| Any test is *red* under `test.fails` semantics — meaning it already passes: "a vacuous test or one about work already done" |
| A returned path exists on disk and was not shown to the author, so it would be rewritten from memory |
| A shown file comes back with fewer test cases than it was given |
| The stop venue is red on an authored file |

A red batch is handed back to the same session with the judgement, up to `REPAIR_ROUNDS` times.
Only then: `git checkout -B implement/issue-N` (off `origin/implement/issue-N` where a sibling run
already pushed one), `git add`, `git commit`, `git push origin HEAD:implement/issue-N`, and a
`ticket-ready` dispatch when the payload said `ready`.

### edge — the commit message

```
test: author acceptance tests for #421 from the spec alone

Nobody has implemented #421 yet, so every test here is test.fails, green until the work
lands, and the implementer turns each on by dropping .fails from its line (#360).
.Workflow/agent-workflows/checkpoints/../canary-summary.test.ts

Part of #162
```

---

## What each stage may touch

| Stage | Model | Reads the target | Writes | Can act on the tracker |
|---|---|---|---|---|
| fetch state (node 01) | — | Open issues, branches, blocked-by graph | — | — |
| PRD self-close (node 02) | — | Runs the spec's own `check:` command | Closes the PRD via `bin/close-ticket` | Comments verdict/disagreement |
| `to-build` admission (node 03) | — | Ticket body | — | One standing comment per ticket |
| readiness + dispatch (node 04) | — | `.test.ts` files under `SUITE_ROOTS` | — | Two dispatch types |
| `refire`/`author` (nodes 08–10) | sonnet-5, no tools | Prompt-inlined claimed files and the tests beside them, plus the tests it just wrote | Pushes `implement/issue-N` | Marks `running`; dispatches `ticket-ready` |

---

## Where it stops

| Cost | Where | Fires when |
|---|---|---|
| free | `dispatch-reconcile.yml`/`acceptance.yml` job `if:`s | Wrong door, wrong label, or wrong sender |
| free, no comment | Node 01's fetch phase | Tracker reads fail → `degraded`, silent to the tracker |
| free, standing comment | `toBuildRefusal()` | Malformed shape or an immutable-set claim on a `to-build` issue |
| 0 model calls | `evaluateSpecCheck` | An unrunnable spec — comments and adds `needs-human` |
| 1 model call | `authorAcceptanceTests` post-response checks | Bad JSON; a file outside the suite roots; a `.test.ts` missing its `#N` marker; no test file returned at all; a path that exists and was never shown; a shown file returned with fewer test cases |
| after the model, before commit | `judgeAuthoredBatch` | Collection failure, an accidentally-green test, or a red stop venue on an authored file. Handed back to the same session up to `REPAIR_ROUNDS` times before it is a strike |
| after commit | `git push origin HEAD:implement/issue-N` | The push fails; the ticket takes a strike and the ladder says what runs next |
| 10 min / 30 min | job `timeout-minutes` | `dispatch-reconcile`: 10 min; `acceptance.yml`'s `refire`/`author`: 30 each, and its `wake-reconciler` tail 5. A cap death here is a strike on the ticket (node 04's ladder), so the wake it rings starts the author again at most twice |

---

## Two things worth knowing

**`EVENT_ACTION`'s collapse is load-bearing, not incidental** — see node 00's edge. Every one of
the four doors reaches `main()`'s same guard, but two of them get there by construction, not by
actually carrying the event name the guard checks for.

**`SUITE_ROOTS = [".Workflow", ".claude"]` is a hardcoded convention of this repo's own layout.**
`testsForCriteria`'s directory walk silently returns `[]` (a caught, swallowed `readdirSync` throw)
for any target lacking those directories. [ADR-0156](../adr/0156-an-enrolled-target-runs-vitest-under-a-config-of-its-own.md)
establishes that this lane's tests are meant to run generically against an enrolled target's own
vitest setup, but the *path* convention that finds those tests in the first place isn't
parameterized per target anywhere in the code. For an enrolled repo without `.Workflow/`/`.claude/`,
node 04 would always conclude "no test authored yet" and always route through `acceptance-wanted`
rather than `ticket-ready` directly — worth surfacing as an open question, not asserting it's a
bug; this apparatus may simply not have been generalized past self-hosting yet.

---

## Loose ends in the tree

- **No ADR governs the PRD self-close pass** (node 02, `evaluateSpecCheck`/`attemptSpecClose`).
  The introducing commit closed an issue but filed nothing — a real refusal/decision surface (the
  disagreement path in particular) with no record carrying a `reversal:`.
- **ADR-0104 is stale but not marked superseded.** Its status is still "constraint," but the
  mechanism it describes — a "Restore and run acceptance" step inside `verify.yml` that checked out
  a separate `tests/acceptance/` tree — was deleted along with that tree ("Put acceptance tests
  beside their source and let one diff rule guard them," 2026-09-03). The live guard is
  `shared/fails-rule.ts`, applied at lane 05's landing (documented in `implement-lane-edges.md`),
  not anywhere in this lane. ADR-0098 (superseded by 0128) and ADR-0120 (superseded by 0127)
  describe the same now-deleted architecture; 0128 is the one still describing a live mechanism —
  the criterion-comment convention `authorAcceptanceTests` still writes.
- [`ticket-format.md`](ticket-format.md)'s documented `## Parent`/`## Blocked by` headings don't
  match what lane 03's `renderBody()` actually publishes — see
  [`to-tickets-lane-edges.md`](to-tickets-lane-edges.md)'s own loose ends for the detail; it matters
  here too, since `toBuildRefusal()` and `bin/ticket_shape.py`'s `validate()` both read the
  *actual* shape, not the documented one.
