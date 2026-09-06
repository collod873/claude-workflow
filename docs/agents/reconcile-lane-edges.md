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

## Node 00 — the four doors · [stop]

`dispatch-reconcile.yml` `jobs.reconcile.if`

```
github.event_name == 'workflow_dispatch' ||
github.event.action == 'session-captured' ||
github.event.action == 'graph-changed' ||
(github.event_name == 'issues' && github.event.label.name == 'to-build' &&
 github.event.sender.login == github.repository_owner)
```

| | |
|---|---|
| **Door 1 — manual** | `workflow_dispatch` |
| **Door 2 — session-captured** | `repository_dispatch`, sent by `.claude/hooks/session-capture-hook.mjs` at the end of a local session. The same dispatch also wakes `audit.yml`, `run-watchdog.yml`, and `walk-home.yml` — this lane is one listener among several, not the event's owner |
| **Door 3 — graph-changed** | Sent by lane 08 (`integrate.ts`, `announceGraphChanged`) once it merges — "a merge announces without interpreting" |
| **Door 4 — to-build label** | `issues:labeled`, `label.name == 'to-build'`, sender must be the repo owner — the hand-off door ([`pipeline-labels.md`](pipeline-labels.md)) |
| **Concurrency** | `dispatch-reconcile`, global, one at a time, `cancel-in-progress: false` — no per-issue key, because one run reconciles the whole tracker at once |

### edge — `EVENT_ACTION`, a collapse worth reading carefully

```
EVENT_ACTION = (github.event_name == 'repository_dispatch' && github.event.action) || 'session-captured'
```

`main()`'s own guard checks `EVENT_ACTION` against `[session-captured, graph-changed]`. On doors 3
and 4 — the label door and the manual door — `EVENT_ACTION` is synthesized as the literal string
`'session-captured'`, because neither is actually a `repository_dispatch` event and the expression
falls through to its own right-hand side. The guard passes for all four doors, but not because the
label and manual doors are secretly session-captured events; they simply never reach the branch
that would read a real one. Reading `main()`'s guard alone, without this, makes it look like doors
3 and 4 shouldn't pass it at all.

---

## Node 01 — fetch state · [wire] [stop-if-degraded]

`runReconcile()`, `reconcile.ts`

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

`admitToBuild()` / `toBuildRefusal()`, `reconcile.ts`

Every open issue carrying `to-build` is checked:

| Refuses when |
|---|
| `validateTicket(body)` throws — missing `## Acceptance criteria` or its `- [ ]` items, or missing `## Files claimed` |
| Any `## Files claimed` path touches the immutable set |

`recordToBuildShape()` posts **one standing comment per issue**, keyed by a hidden marker
(`<!-- to-build-refused:v1 -->`), rather than commenting every run:

### edge — the standing comment, refused

```
This is labelled `to-build` and lane 06 will not start against it: <reason>.

Refused here rather than three stages later: verify's Immutability job reads the same
`## Files claimed` section this pass just did.

Add what is missing and the next session end starts it.

<!-- to-build-refused:v1 -->
```

Cleared → the same comment is rewritten to say so. Unchanged from last pass → no-op, so a
persistently-refused ticket doesn't accumulate a comment per run.

---

## Node 04 — compute readiness and dispatch · [wire]

`reconcile.ts`

```ts
const startable = startableNumbers(issues, admitted);
// a published slice (## Parent PRD heading, lane 03's own output) OR the to-build label —
// intent to build is asserted, never inferred from shape alone
const ready = readySlices(graph).filter(s => startable.has(s.number));
```

For each `ready` slice, `testsForCriteria(criteriaOf(slice), targetWorkspace)` greps every
`.test.ts` under `SUITE_ROOTS = [".Workflow", ".claude"]` of the **target** checkout for the
criterion string, verbatim:

| No matching test found | A matching test already exists |
|---|---|
| `dispatchAcceptanceWanted(number, true)` — back into this same lane's own author | `dispatchTicketReady(number)` — rings lane 05 directly. This is the branch #421 takes once #420 delivers: its test was already authored back when lane 03 first published it, so the recompute finds it and skips straight past the author |

### edge — the two outbound dispatches

```json
{"event_type": "acceptance-wanted", "client_payload": {"issue": 421, "ready": 1}}
{"event_type": "ticket-ready", "client_payload": {"issue": 420}}
```

Sent directly via `gh`, no split-job file-collection like lanes 02 and 03 use — this workflow is a
single job holding `contents: write, issues: write` throughout, so there's no separate
model-spending job whose token needs protecting from write access.

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
| `refire` | `issues:edited`, PRD labelled, sender is the repo owner — the owner hand-edited a PRD body (a spec-gap amendment) | Checks out machine + target, notes `ACCEPTANCE_BASE = git rev-parse HEAD`, runs `acceptance.ts --refire "$PRD_NUMBER"` |
| `author` | `action == 'acceptance-wanted'` — node 04's own dispatch door | Marks the ticket `running`, runs `acceptance.ts "$TICKET_NUMBER"`, unmarks on `always()` |
| `land` | `needs: [refire, author]`, either upstream job set `authored == 'true'` | The only job with `contents: write` — both upstream jobs run with the workflow's default `contents: read` |

---

## Node 08 — `refireAcceptance()` (the refire path) · [wire]

`acceptance.ts`

Reads the PRD and its sibling slice numbers. For each sibling whose criteria are already matched
by an existing authored test, checks whether that criterion text is still present in the
just-edited PRD body. Gone → the slice is *affected*, and `authorForSlice()` re-enters node 09
in-process for it. A criterion no existing test names at all is ignored here — "that's a re-slice,
not a re-entry."

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

## Node 10 — `landAuthoredBatch()` · [wire] [stop]

`acceptance.ts`

Runs just the newly written `.test.ts` files against the target's own `vitest.config.ts`:

| Refuses when |
|---|
| The file fails to collect at all |
| Any test is *red* under `test.fails` semantics — meaning it already passes: "a vacuous test or one about work already done" |
| The authored files don't lint (`eslint`) |

Only then: `git add`, `git commit`. Landing mode (`ACCEPTANCE_LANDING` env, set to `"commit"` by
both jobs) stops here with no push — this job holds `contents: read` only.

### edge — the commit message

```
Author acceptance tests for #421 from the spec alone

Nobody has implemented #421 yet, so every test here is test.fails, green until the work
lands, and the implementer turns each on by dropping .fails from its line (#360).
.Workflow/agent-workflows/checkpoints/../canary-summary.test.ts

Part of #162
```

---

## Node 11 — bundle · [wire]

[`.github/actions/acceptance-bundle`](../../.github/actions/acceptance-bundle) (run by both
`refire` and `author`)

`git format-patch "$ACCEPTANCE_BASE..HEAD"`; a non-empty result is uploaded as the
`acceptance-commits` artifact, `authored=true`. This is the mechanism that carries commits over a
job boundary as a patch series rather than a push — the write-capable token lives only in `land`,
so the model job's own commits are smuggled out as an artifact instead of pushed directly.

---

## Node 12 — the `land` job · [wire] [stop]

`acceptance.ts`, `land` job

Checks out the target **fresh** at `main` (not the worktree the author job used), downloads the
patch artifact, replays it: `git am --3way`, `git fetch origin main && git rebase origin/main`,
then re-runs the **full gauntlet** (`npm run check` — the same command every other venue runs)
against the replayed tree, and only then `git push origin HEAD:main`.

### edge — the final ring to lane 05

```
if: github.event.action == 'acceptance-wanted' && github.event.client_payload.ready == '1'
gh api --method POST repos/{owner}/{repo}/dispatches -f event_type=ticket-ready -f 'client_payload[issue]=...'
```

Fires only on the `acceptance-wanted` door — never on `refire` — and only when the *original*
dispatch already said `ready: 1`. A slice authored while still blocked (#421, at publish time)
lands its test on `main` but isn't told to lane 05 yet; node 04's own next pass finds the
now-existing test via `testsForCriteria` and dispatches `ticket-ready` directly, once #420
delivers.

---

## What each stage may touch

| Stage | Model | Reads the target | Writes | Can act on the tracker |
|---|---|---|---|---|
| fetch state (node 01) | — | Open issues, branches, blocked-by graph | — | — |
| PRD self-close (node 02) | — | Runs the spec's own `check:` command | Closes the PRD via `bin/close-ticket` | Comments verdict/disagreement |
| `to-build` admission (node 03) | — | Ticket body | — | One standing comment per ticket |
| readiness + dispatch (node 04) | — | `.test.ts` files under `SUITE_ROOTS` | — | Two dispatch types |
| `refire`/`author` (nodes 08–10) | opus-5, no tools | Prompt-inlined claimed files only, plus the tests it just wrote | Commits (not pushed) | Marks `running` |
| `land` (node 12) | — | Replays a patch bundle onto fresh `main` | Pushes to `main` after a full gauntlet | Dispatches `ticket-ready` |

---

## Where it stops

| Cost | Where | Fires when |
|---|---|---|
| free | `dispatch-reconcile.yml`/`acceptance.yml` job `if:`s | Wrong door, wrong label, or wrong sender |
| free, no comment | Node 01's fetch phase | Tracker reads fail → `degraded`, silent to the tracker |
| free, standing comment | `toBuildRefusal()` | Malformed shape or an immutable-set claim on a `to-build` issue |
| 0 model calls | `evaluateSpecCheck` | An unrunnable spec — comments and adds `needs-human` |
| 1 opus call | `authorAcceptanceTests` post-response checks | Bad JSON; a file outside the suite roots; a `.test.ts` missing its `#N` marker; no test file returned at all |
| after the model, before commit | `landAuthoredBatch` | Collection failure, an accidentally-green test, or a lint failure |
| after commit, in `land` | `git am --3way` / rebase | The patch doesn't apply or the rebase conflicts |
| after replay | `land`'s `npm run check` | Any gauntlet slot red against the replayed tree |
| 10 min / 30 min | job `timeout-minutes` | `dispatch-reconcile`: 10 min; `acceptance.yml`'s three jobs: 30/30/10 |

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
  here too, since `toBuildRefusal()` and `validateTicket()` both read the *actual* shape, not the
  documented one.
