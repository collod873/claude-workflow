# The recovery machinery, edge by edge

Followed end to end. Every **node** is something that executes; every **edge** is the payload
travelling between two nodes — what it is, and who is allowed to have read it.

This is not a numbered lane. It does not sit on a work item's own path from idea to merge the way
lanes 00 through 08 do, and it carries no lane number of its own. It is what notices that a lane
run died and gets the work moving again — three independent responses to three different shapes of
death, not three steps of one pipeline.

## The machines

Three reusable workflows, each proven separately because none of them hands off to another:

- [`.github/workflows/recover.yml`](../../.github/workflows/recover.yml) (caller stub
  [`recover-caller.yml`](../../.github/workflows/recover-caller.yml)) reacts to one specific lane —
  Implement — dying loud: a run that started, executed jobs, and ended `failure` or `cancelled`.
  State machine: [`recover/recover.ts`](../../.Workflow/agent-workflows/recover/recover.ts).
- [`.github/workflows/run-watchdog.yml`](../../.github/workflows/run-watchdog.yml) (caller stub
  [`run-watchdog-caller.yml`](../../.github/workflows/run-watchdog-caller.yml)) reacts to *any* lane
  dying silent: a run that completed having executed zero jobs at all, the signature of a workflow
  file GitHub could not even parse. State machine:
  [`watchdog/run-watchdog.ts`](../../.Workflow/agent-workflows/watchdog/run-watchdog.ts), reading
  [`watchdog/dead-lanes.ts`](../../.Workflow/agent-workflows/watchdog/dead-lanes.ts).
- [`.github/workflows/walk-home.yml`](../../.github/workflows/walk-home.yml) carries **no caller
  stub**. `docs/agents/enrolment.md` says why directly: "Like `enrol.yml`, it is the other lane
  with no caller stub: it runs only here" — it never checks out a `target/` at all, because its job
  is to read *every other* enrolled repository's own run history over the API, under `ENROL_PAT`,
  and route a red run there by whether the failing path lives in the machine's own tree or the
  caller's. A caller stub exists so a repository other than the machine can invoke logic hosted
  here; walk-home's whole point is the opposite direction — it is invoked once, here, and reaches
  outward — so there is no second repository for a stub to live in. State machine:
  [`watchdog/walk-home.ts`](../../.Workflow/agent-workflows/watchdog/walk-home.ts).

None of the three ever installs `@anthropic-ai/claude-code` or spends a model call — `recover.yml`
asserts this of its own source (`shared/lane-wiring.ts`'s `LANE_WIRING["recover"].source.lacks`),
and neither `run-watchdog.yml` nor `walk-home.yml` references `CLAUDE_CODE_OAUTH_TOKEN` anywhere.
The paid work already happened upstream, in whatever died; this machinery reads its wreckage and
writes to the tracker, nothing more. `shared/stage.ts` — the model-calling infrastructure every
other lane's edge doc cites — never appears here. The one place a **checkpoint** written by that
infrastructure matters to this machinery is Two things worth knowing, below.

## The worked examples

This machinery sits off the main worked-example thread (issue #412 → PRD #419 → tickets #420/#421
→ PR #501 on `implement/issue-421`). Nothing below continues that thread, and #421's own run still
succeeds exactly as the other edge docs describe it. Recover's worked example is two separate,
fictional Implement runs against two separate tickets — **#431**, sliced from a different PRD
(#429), and **#435** — neither of which is #421. Run watchdog's worked example is a fictional dead
run of `to-tickets-caller.yml`, a real file in this repository, standing in for whatever lane
happens to have gone silent. Walk home's worked example runs against `collod873/Lumaria`, a real
enrolled repository named in ADR-0141 and in this repository's own research notes — not a
fictional stand-in, since walk-home's whole subject is *other* repositories and there is no reason
to invent one.

Legend: **[wire]** deterministic TypeScript or shell · **[stop]** can refuse and end the run. No
node in this document is tagged **[model]** — see above.

---

## Part one — Recover

## Node 00 — the three doors · [stop]

`recover-caller.yml` `on:` and `jobs.recover.if` — `recover.yml`'s own job carries no `if:` at all

```yaml
"on":
  workflow_run:
    workflows: ["Implement"]
    types: [completed]
  repository_dispatch:
    types: [implement-failed]
  workflow_dispatch:
    inputs:
      run_id:
        default: ""
```

| | |
|---|---|
| **Signal 1** | `implement.yml`'s own `if: failure() \|\| cancelled()` step fires `repository_dispatch: implement-failed`, carrying `client_payload.run_id` and `client_payload.issue`. Needs the job to survive long enough to reach that step. |
| **Signal 2** | GitHub's own `workflow_run: [Implement], types: [completed]` event, filtered in `recover-caller.yml`'s own `if:` to `conclusion == 'failure' \|\| conclusion == 'cancelled'` (`recover.yml`'s reusable job carries no `if:` of its own at all — the caller alone decides whether to `uses:` it). Fires even when the runner is killed before signal 1's step ever runs — the harder case, and the reason a second door exists at all. |
| **Either wakes** | `recover.yml`, `RUN_ID` resolved by `github.event.workflow_run.id \|\| github.event.client_payload.run_id \|\| github.event.inputs.run_id` — GitHub's own event first, the self-report second, a manual dispatch last. |
| **`client_payload.issue` unread** | Signal 1 sends the ticket number along with the run id. Nothing in `recover.ts` ever reads it — `resolveRecoveryTarget` re-derives the ticket for itself from the run's own artifact or log, never trusting a value the dying process supplied about itself. |
| **Concurrency** | `recover-${{ inputs.run_id \|\| github.run_id }}`, `cancel-in-progress: false` (ADR-0111: a lane that writes queues behind itself). Both signals for the *same* dead run resolve to the *same* group, so GitHub serialises them; by the time the second one runs, node 02's own ledger already marks the run handled. |
| **Re-run gesture** | `gh workflow run recover-caller.yml -f run_id=<id>` — the `workflow_dispatch` door exists for exactly this. |
| **Simpler than its sibling** | `fixer-caller.yml`'s identical `deadRunCaller()` shape adds `github.event.workflow_run.event != 'push'`, because `Verify` also fires on a bare push to `main` and there is no pull request there for the fixer to fix. `recover-caller.yml` carries no such clause — `Implement` has exactly one door, `ticket-ready`, and never fires on push, so there is nothing to exclude. |

### The canary fire

Recover shares its trigger shape (`workflow_run` + `repository_dispatch` + `workflow_dispatch`,
built by the same `deadRunCaller()` helper in `shared/lane-wiring.ts`) with `fixer`. `bin/canary`'s
own plan (`shared/canary-fire-plan.ts`) checks `on.push`, then `on.workflow_dispatch`, before it
ever looks at `repository_dispatch` — so both lanes fire via **`workflow_dispatch`**, not the
dispatch door either one owns. That is where the two lanes stop matching: `fixer`'s entry in
`shared/canary-fixture.ts`'s `FIXTURES` supplies `payload: { run_id: "@run" }`, which
`bin/canary` resolves to the newest completed run on the canary target and sends as
`inputs[run_id]` (ADR-0152, ADR-0153 — the fire satisfies the guard the lane's job actually reads).
`recover` has no such entry. `fixtureFor("recover")` returns `undefined`, `add_fixture_payload
"inputs"` is a no-op, and `bin/canary prove --lane recover` fires with `inputs.run_id` at its
declared default, `""`. `recover.ts`'s own `main()` reads that as `!runIdArg` and exits having done
nothing: `"no Implement run named; nothing to recover"`. The fire is real — the job runs, on the
right ref, past the right guard — but it currently proves only the empty branch, never the artifact
replay or the redispatch this document is mostly about. See *Loose ends*.

---

## Node 01 — resolve what died · [wire] [stop]

`recover.ts` `resolveRecoveryTarget`

Two independent reads, tried in order, because the run that died may never have gotten far enough
to leave the better of the two.

| | |
|---|---|
| **First** | `resolveTicketFromArtifacts` — `GET .../actions/runs/{runId}/artifacts`, matched against `/^implementer-answer-(\d+)$/`. Present → `{ ticket, hasArtifact: true }`, and node 01 stops here. |
| **Second** | `resolveTicketFromLog` — `gh run view <runId> --log` (the **whole** log, not `--log-failed`; the `implementing #<n>` line is an ordinary echo from a step that may itself have succeeded), matched against `/implementing #(\d+)/g`, last match wins. |
| **Also from the log** | `failureFromLog` — the last `implement failed: (.+)$` line, capped at 300 characters with `-->` stripped (so it can sit inside an HTML comment marker without closing it early). |
| **Refuses** | Neither source names a ticket → outcome `nothing-to-recover`. Nothing is written anywhere; a run that named nothing did not necessarily fail at something this lane can act on. |

### edge — `RecoveryTarget` · in-process object

```ts
{ ticket: 431, hasArtifact: false, failure: undefined }
```

Run 19204471002, `Implement #431`, was cancelled outright — the runner was killed mid-repair, after
the implementer model had already answered but before `implementer-answer.json` was ever written to
`$RUNNER_TEMP`. No artifact exists; the log names #431 and carries no `implement failed:` line,
because nothing in the process ever got to print one.

---

## Node 02 — the attempt ledger · [wire] [stop]

`recover.ts` `priorAttempts` / `runRecover`

Every prior reaction to this *ticket* — not this run — lives as a marked comment on the ticket
itself. This is the only memory the lane has; nothing is written to a file or a database.

| | |
|---|---|
| **Read** | `issueComments(gh, ticket)`, matched against `<!-- recover-attempt:(\d+) -->` and, on the same comment, `<!-- recover-failure:(.*) -->`. |
| **Already handled** | This run's own id is already among the prior attempts (both signals fired for the same dead run) → outcome `already-handled`, nothing written. |
| **The cap, checked first** | `priorRuns.length >= MAX_RECOVER_ATTEMPTS` (3) → `stopAndEscalate`: `needs-human`, the owner assigned, every run URL listed. A ticket with three prior attempts already stops here, before the failure text below is even read. |
| **The repeat, checked below the cap** | Only reached with fewer than three priors: the *previous* attempt's own failure text equals this run's → `stopOnRepeatedFailure` fires the same escalation early — "a second identical failure is deterministic," so a flake still gets a retry but a repeat does not have to wait out the remaining two. |

The test suite's own note on the cap — `"MAX_RECOVER_ATTEMPTS is 3, ADR-0041's ceiling"` — names
the fixer's own cap, not recover's; see *Loose ends*. The ADR that actually governs this number is
[ADR-0114](../adr/0114-a-red-lane-05-run-is-recovered-from-its-own-artifact-and-han.md): "the third
recovery of one ticket reaches the owner."

### edge — the standing comment, cap reached

```
<!-- recover-attempt:19204471480 -->
Stopped after 3 recovery attempts on #431; a human needs to look at it.

Runs:
- https://github.com/collod873/claude-workflow/actions/runs/19204471002
- https://github.com/collod873/claude-workflow/actions/runs/19204471201
- https://github.com/collod873/claude-workflow/actions/runs/19204471480
```

---

## Node 03 — no artifact: release the claim and try again · [wire]

`recover.ts` `runRecover` (the `!hasArtifact` branch) → `shared/implementation-landing.ts`
`releaseDeadClaim`

The genuinely answerless case: the model itself never returned, or the process died before it
could act on what it returned.

| | |
|---|---|
| **Release** | `releaseDeadClaim(gh, "implement/issue-431", "main", log)` — deletes the branch ref *only* if it carries no pull request and no commits ahead of `main`. Either signal reads as "somebody's work" and the ref is left alone. |
| **Fires anyway** | `redispatchImplement` is called unconditionally after the release attempt, whether or not the release actually happened. A branch that turned out to carry a PR just means the fresh dispatch will hit lane 05's own node 01 and read `already-claimed` — a silent no-op there, not a second implementer run. |
| **Why release before dispatch, not after** | The dead run's own claim ref would otherwise block the fresh `ticket-ready` dispatch from ever claiming the branch — the same ordering concern spec lane's own gate-then-dispatch has, inverted: here the stale thing must go *before* the new attempt, not after. |

### edge — `redispatchImplement` · `repository_dispatch`

```json
{"event_type": "ticket-ready", "client_payload": {"issue": 431}}
```

The exact door [`implement-lane-edges.md`](implement-lane-edges.md#node-00-the-one-door-stop)
documents — this run starts lane 05 over from its own node 00, claim and all.

### edge — the marker comment

```
<!-- recover-attempt:19204471002 -->
Re-dispatched #431. Run https://github.com/collod873/claude-workflow/actions/runs/19204471002
ended with no implementer answer to recover, so this sent a fresh `ticket-ready` dispatch.
```

---

## Node 04 — an artifact: read the implementer's answer back · [wire] [stop]

`recover.ts` `runRecover` (the `hasArtifact` branch)

The case ADR-0114 exists for: the one thing that costs money already happened.

| | |
|---|---|
| **Downloads** | `gh run download <runId> -n implementer-answer-435 -D <tmp dir>`, then reads `implementer-answer.json` out of it. |
| **Validates** | `ImplementerAnswer.parse(JSON.parse(raw))` — the same schema `implementation-landing.ts` defines for lane 05's own node 04b output: `files[]`, `deleted[]`, `summary`, `outOfBriefReads[]`, `declaredEdits[]`. |
| **A malformed artifact** | `.parse()` throws, uncaught inside `runRecover`; `main()`'s own `try/catch` logs `recover failed: …` and exits 1. No comment is posted and no claim is touched — unlike every refusal below, this one is silent to the ticket. |

### edge — `ImplementerAnswer` · schema-validated JSON, read back unchanged

```json
{"files": [
  {"path": "scripts/canary-summary.ts", "content": "..."},
  {"path": "scripts/canary-summary.test.ts", "content": "..."}
],
 "deleted": [],
 "summary": "Wrote the run's own retry-count line to the step summary.",
 "outOfBriefReads": [],
 "declaredEdits": []}
```

Run 19204471055, `Implement #435`, produced this and then died in the "Keep the implementer's
answer" step or after it — the model already answered; only the landing steps were lost.

---

## Node 05 — the two guards before landing · [wire] [stop]

`recover.ts` `runRecover`

Both guards run against the *answer*, before the branch is even reclaimed — the same two rules
lane 05's own `landAnswer` (node 06 there) would apply eventually, checked here first so a doomed
answer never gets as far as a git ref.

| | |
|---|---|
| **Immutable set** | `touchesImmutableSet(answer.files.map(f => f.path))` — any path equal to or starting with `vitest.config.ts` or `.github/`. Refused → `escalateToOwner`, a marker comment naming the forbidden paths (never the allowed ones alongside them), outcome `immutable`. Zero git calls made. |
| **Gate growth** | `gateGrowth(git, paths)` — any of `answer.files`' paths that is untracked *and* falls in `shared/gate-files.ts`'s `GATE_FILES`/`GATE_DIRS` list (`bin/gauntlet`, `.claude/hooks/*`, `.github/workflows/*`, `vitest.config.ts`, `eslint.config.js`, …). Refused → the same escalation, outcome `gate-growth`. One read-only `git ls-files` call made, no writes. |
| **Both** | Escalate before claiming — a branch is never reclaimed for an answer that is going to be refused anyway. |

### edge — the refusal comment, immutable set

A third, separate run — ticket **#438**, run 19204471099 — to keep this refusal from
contradicting #435's own clean landing two nodes down:

```
<!-- recover-attempt:19204471099 -->
Not recovered: the implementer's answer for #438 (run https://.../19204471099) writes into
the immutable set, which no pull request may change; the ticket itself needs fixing.

- `.github/workflows/canary-summary.yml`
```

---

## Node 06 — reclaim the branch · [wire] [stop]

`shared/implementation-landing.ts` `claimImplementationBranch`

Identical to lane 05's own node 01 — recover does not re-implement the claim, it calls the same
function. `POST /git/refs` creating `refs/heads/implement/issue-435` at the target's current
`HEAD`; a live claim (a PR, commits ahead, or an unreadable creation time) → outcome
`already-claimed`, no comment, nothing past the console log — a genuinely stale claim past 45
minutes is taken over instead. See
[`implement-lane-edges.md`](implement-lane-edges.md#node-01-claim-the-branch-wire-stop) for the
full staleness rule; nothing about it changes when the caller is recovery rather than a fresh
dispatch.

---

## Node 07 — land it: lane 05's own machinery, replayed · [wire] [stop]

`shared/implementation-landing.ts` `landAnswer`, called with a commit message recover writes
itself

The `ImplementerAnswer` downloaded at node 04 is fed straight into the same `landAnswer` lane 05's
own node 06 calls — every guard documented there (nothing changed, the immutable set again as a
second check against the *diff* rather than the declared paths, the fails-rule check on any
`test.fails(` line, the rebase onto trunk, the push) runs unmodified. The only thing recovery
supplies that a fresh implement run would not is the commit message and the fact that the
implementer never runs again.

### edge — the commit message

```
Recover #435 from run 19204471055

Wrote the run's own retry-count line to the step summary.

Part of #435
```

`Recover #<ticket> from run <runId>`, not `Implement #<ticket>` — the only textual difference from
a fresh landing; `landAnswer` itself cannot tell which caller it was invoked from.

### edge — `gh pr create` and the dispatch onward

```
gh pr create --title "Report the retry count" --body "..." --head implement/issue-435
→ https://github.com/collod873/claude-workflow/pull/512

{"event_type": "implementation-opened",
 "client_payload": {"pr": ".../pull/512", "changed_files": [...], "criteria": [...]}}
```

The exact door [`verify-lane-edges.md`](verify-lane-edges.md#node-00-the-two-doors-stop)
documents — a recovered PR is judged by lane 06 exactly as a fresh one is; nothing downstream can
tell the two apart.

`landAnswer` can also resolve to `nothing-to-build` (the answer matches trunk exactly),
`fails-rule-refused` (the only outcome that exits the process non-zero), `immutable-refused`, or
`rebase-conflict` — every one of them already documented at
[`implement-lane-edges.md`'s node 06](implement-lane-edges.md#node-06-land-the-answer-wire-stop),
unchanged here.

---

## Node 08 — the marker comment closes the loop · [wire]

`recover.ts` `postAttemptComment`

Whatever node 03 or node 07 produced, one comment lands on the ticket, carrying
`<!-- recover-attempt:<runId> -->` and, where a failure text exists,
`<!-- recover-failure:<text> -->`. This is the whole of the lane's memory — node 02 reads it back
on the next dead run of the same ticket, and it is the only thing that makes `already-handled`,
the cap, and the repeat-failure stop possible without a database anywhere in the system.

### edge — the comment, recovery path

```
<!-- recover-attempt:19204471055 -->
Recovered #435 from run https://github.com/collod873/claude-workflow/actions/runs/19204471055:
opened https://github.com/collod873/claude-workflow/pull/512.
```

---

## Part two — Run watchdog

## Node 00 — the one door · [stop]

`run-watchdog-caller.yml` `on:` / `run-watchdog.yml` `jobs.watch.if`

```yaml
"on":
  repository_dispatch:
    types: [session-captured]
```

| | |
|---|---|
| **Fires on** | `repository_dispatch: session-captured`, the same dispatch `.claude/hooks/session-capture-hook.mjs` sends at the end of every local session, and the same one `dispatch-reconcile.yml`, `audit.yml` and `walk-home.yml` all listen for independently. This lane is one reader among several, not the event's owner. |
| **Why not `workflow_run`** | [ADR-0049](../adr/0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md): `workflow_run` is keyed on the completed workflow's own `name:` field, and the exact failure this lane exists to find — a file GitHub could not parse — is a file GitHub could not read a `name:` out of either. A trigger keyed on the thing the failure erases can never fire on it. |
| **Job `if:`** | `github.event.action == 'session-captured'`, checked again inside `runWatchdog()` itself against `WATCHDOG_DISPATCH_ACTION` — belt-and-suspenders on the identical condition, not a case YAML couldn't express. |
| **Concurrency** | `run-watchdog`, global, `cancel-in-progress: false`. |
| **Scope** | Whichever repository's own copy of this stub is running: `GH_REPO: ${{ github.repository }}`. A session ending in an enrolled repository sweeps that repository's own run history; there is no cross-repo reach here — that is walk-home's job. |

### The canary fire

`bin/canary`'s plan for this lane (`shared/canary-fire-plan.ts`) resolves to `repository_dispatch`,
`eventType: session-captured` — there is no `workflow_dispatch` door to take precedence the way
recover's does. `run-watchdog` carries no entry in `shared/canary-fixture.ts`'s `FIXTURES` either,
and needs none: unlike recover, it is handed nothing to act on — it reads the canary target's own
real run history over the API. A bare fire is a meaningful proof here in a way it currently is not
for recover.

---

## Node 01 — read the window · [wire]

`run-watchdog.ts` `runWatchdog`

| | |
|---|---|
| **Reads** | `GET /actions/runs?per_page=100` (`RUN_PAGE_SIZE`), projected to `{id, name, path, status, conclusion, html_url, head_branch, created_at}`. |
| **Candidates** | `isCandidate()` — `status: completed`, `conclusion: failure`, and inside `LOOKBACK_DAYS = 7`. A `cancelled` run is *not* a candidate here — this is not recover's own signature. |
| **Budget** | At most `MAX_JOB_READS = 60` candidates get a per-run jobs read (`GET .../runs/{id}/jobs`, `.total_count`). Past that, and past the one page of 100 runs, the sweep says so in its own log rather than silently under-counting. |
| **A jobs read with no count** | Throws rather than reading an empty response as zero — "refuses a jobs read that returns no count, rather than reading it as zero" (the suite's own words). |

---

## Node 02 — dead lanes, by job count alone · [wire]

`watchdog/dead-lanes.ts` `deadLanes` / `executedNothing`

The entire detection rule is one field: `run.jobCount === 0`. Nothing about *why* — a red gauntlet,
a cancelled step, a timeout — counts here; those are candidates for recover or the fixer, never
this lane. Grouped by workflow `path`, newest run first within each group.

| | |
|---|---|
| **Zero jobs is not a decline** | A job whose own `if:` was false still counts as one job, `skipped`. Zero means the run *could not start*, almost always an unparseable workflow file. |
| **Stub vs reusable** | `reusableHalf()` / `callerHalf()` map `<lane>-caller.yml` ↔ `<lane>.yml` by string suffix alone. GitHub always attributes a run reached through `uses:` to the *caller's* file, so a stub's own dead-lane signal names the file most likely to actually hold the break: the reusable workflow underneath it. |

### edge — `DeadLane`

```ts
{
  path: ".github/workflows/to-tickets-caller.yml",
  name: ".github/workflows/to-tickets-caller.yml",
  runs: [
    { id: 19301004471, htmlUrl: ".../actions/runs/19301004471", headBranch: "main", createdAt: "2026-09-04T03:11:00Z", jobCount: 0 },
  ],
}
```

`name` equalling the file's own path (rather than a declared `name:`) is itself a symptom GitHub
could not parse far enough to read one out — `signalBody()` says so explicitly when it happens.

---

## Node 03 — report or stay quiet · [wire]

`run-watchdog.ts` `report`

| | |
|---|---|
| **No standing signal** | Opens a new issue, `--assignee $SIGNAL_ASSIGNEE` (the repo owner), no label. Capped at `MAX_SIGNALS = 3` per sweep. |
| **A standing signal, open, with fresh runs** | Comments on it — never opens a second issue for the same lane, matched by a hidden `<!-- dead-lane:<path> --> `marker. `unreportedRuns()` diffs against every run id the standing issue's own body and comments already cite, so a repeat sweep with nothing new says nothing. |
| **A standing signal, closed** | Silently ignored *if* every dead run in this sweep predates the signal's own `closedAt` — a lane that died again strictly after its last signal closed gets a fresh issue instead of reopening the old one. |

### edge — the opened issue

```
Title: .github/workflows/to-tickets-caller.yml is dead: its runs execute zero jobs
       (its machinery: to-tickets.yml)

`.github/workflows/to-tickets-caller.yml` has produced 1 run in the last 7 days that
completed having executed **zero jobs**.

`.github/workflows/to-tickets-caller.yml` is a caller stub (a trigger and `uses:`, six lines)
that delegates to `to-tickets.yml`. That is almost always where a break like this actually
lives...

**To confirm:**

    gh run view 19301004471 --log
    actionlint .github/workflows/to-tickets-caller.yml
    actionlint .github/workflows/to-tickets.yml

<!-- dead-lane:.github/workflows/to-tickets-caller.yml -->
```

---

## Node 04 — retire what came back to life · [wire]

`run-watchdog.ts` `retireRecovered`

Skipped entirely on a sweep that did not see its whole window (the page was clipped, or the job-read
budget ran out) — "no diff" is not a claim this sweep is entitled to make on partial information.

| | |
|---|---|
| **A standing signal whose lane ran again** | Matched on the marked path *or* its caller/reusable counterpart (`callerHalf`/`reusableHalf`), any `completed` run inside the lookback window. Closed with a retirement comment, `reason: completed`. |
| **A standing signal whose lane has not run** | Left open, logged, nothing written — absence of a fresh dead run is not evidence of a fresh live one. |

### edge — the retirement comment

```
## Closing record

No diff.

`.github/workflows/to-tickets-caller.yml` starts again: [run 19301009000](...) on `main`
executed jobs (2026-09-04T09:00:00Z), and nothing in the last 7 days executed zero. The signal
has nothing left to stand for.

This closes the signal, never the mechanism: the next run of this lane that executes nothing
opens a fresh one against the same marker.
```

---

## Part three — Walk home

## Node 00 — the one door, no caller stub · [stop]

`walk-home.yml` `jobs.walk.if` — there is no `walk-home-caller.yml`

```yaml
"on":
  repository_dispatch:
    types: [session-captured]
```

| | |
|---|---|
| **Runs where** | Only here, in `collod873/claude-workflow` itself — a single `actions/checkout@v4` with no `path:`, so this job's own working tree *is* the machine, never a target. Every other lane in this repository checks the machine out at the workspace root and a caller's own tree at `target/`; walk-home checks out nothing else at all. |
| **Credential** | `GH_TOKEN: ${{ secrets.ENROL_PAT }}` — the same fine-grained PAT `enrol.yml` already sends outward to every enrolled repository ([ADR-0136](../adr/0136-a-caller-s-red-run-is-swept-from-here-under-enrol-pat-never.md)). No enrolled repository is ever handed a credential that writes *here*; rotating one key covers the whole estate. |
| **Job `if:` re-checked in TS** | `walkHome()`'s own `eventAction !== WATCHDOG_DISPATCH_ACTION` guard imports that constant from `./run-watchdog` rather than declaring its own — the two lenses share one name for the one dispatch both answer, even though they are otherwise unrelated files. |
| **Cannot be canary-fired at all** | `bin/canary`'s own precondition is `[ -f "$repo_root/.github/workflows/$lane-caller.yml" ]`, and for `walk-home` that file does not exist: `die "no $stub_path in the machine; lane 'walk-home' has no caller stub"`. `bin/canary-graph` still models walk-home's trigger shape as one node in its synthetic topology check, but that tool runs no real code at all — it fires a disposable mirror of every lane's dispatch wiring to prove the *graph*, never this lane's own logic against a real target. Proving walk-home for real means dispatching `session-captured` against the machine's own default branch and reading what it files. |

---

## Node 01 — every other enrolled repository · [wire]

`walk-home.ts` `enrolledRepositories`

`GET /search/repositories?q=topic:claude-workflow-enrolled`, filtered to drop the machine
repository itself. `ENROLMENT_TOPIC` is declared as its own local constant here
(`"claude-workflow-enrolled"`) rather than imported from `enrol/enrol.ts`'s exported one of the
same name — see *Loose ends*. Zero repositories carrying the topic → outcome code
`no-enrolled-repositories`, nothing filed. Repositories found but nothing worth filing after
sweeping them all → `all-clear` instead, a different code for a different reason to stop.

---

## Node 02 — its failed machine-lane runs · [wire]

`walk-home.ts` `failedRuns` / `ranMachineLane`

For `collod873/Lumaria`: `GET /repos/collod873/Lumaria/actions/runs`, filtered to `completed` +
`failure` inside the same 7-day lookback run-watchdog uses, **and** `ranMachineLane(run.path)` —
the run's own workflow path ends in `-caller.yml`. A red run of a workflow Lumaria owns outright
(one it authored, not one the machine ships) is not this sweep's business at all.

| | |
|---|---|
| **Already walked** | `readWalkedHome(gh)` — every issue anywhere this repository can see, scanned for `<!-- walk-home:<repo>:<runId> -->`. A run already carrying that marker on some issue is skipped; the sweep stores no cursor of its own, deriving "already handled" the same way run-watchdog does. |
| **Budgets** | `MAX_LOG_READS = 30` and `MAX_FILED = 5` per sweep, shared across every enrolled repository in one pass — a noisy repository cannot starve the rest. |

---

## Node 03 — the failing step's own log, one path · [wire]

`walk-home.ts` `failingStepLogTail` / `failingPath`

| | |
|---|---|
| **Reads** | `gh run view <runId> -R collod873/Lumaria --log-failed` — only the failing step, unlike recover's own `--log`, which reads everything because it is hunting an ordinary echo line, not a failure. |
| **Names a path** | The last 80 lines, matched against a single path-shaped regex (`(?:target/)?word(/word)+\.ext`). No match → logged and skipped; this sweep cannot route what it cannot name. |

### edge — the log tail (excerpt)

```
 FAIL .Workflow/agent-workflows/implement/implement.test.ts > gatherBriefContext inlines the
      seam manifest
 AssertionError: expected undefined to contain 'Seam manifest lines consumed'
```

---

## Node 04 — whose tree is it in · [wire]

`walk-home.ts` `routeFor` / `machineFilesFrom`

[ADR-0141](../adr/0141-an-unrecognised-failing-path-routes-to-the-caller-and-the-ma.md): the
machine is proven positively, never assumed by elimination. `git ls-files` inside *this* checkout
(the machine's own) is the whole list; a path either appears there or it does not.

| Path starts with `target/`, or is bare `target` | Path is tracked by `git ls-files` here | Neither |
|---|---|---|
| routes **caller** | routes **machine** | routes **caller** (the safer default — ADR-0141 again: "a wrong caller ticket costs one issue its owner can close, a wrong machine ticket a model run and a pull request here") |

`.Workflow/agent-workflows/implement/implement.test.ts` is tracked here → routes **machine**.

---

## Node 05 — file it, there or here · [wire] [stop]

`walk-home.ts` `file`

| Routed **caller** | Routed **machine**, touches the immutable set | Routed **machine**, otherwise |
|---|---|---|
| `gh issue create -R collod873/Lumaria` — no label, this repository's own tracker and fixer take it from there | `gh issue create --label needs-human` — no pull request could ever land a fix, so it never reaches `to-build` at all | `gh issue create --label to-build` — lane 04's next recompute starts an implementer against it with no spec chain in front of it |

### edge — the machine-side ticket

```
Title: collod873/claude-workflow: .Workflow/agent-workflows/implement/implement.test.ts failed
       inside the machine checkout

A run of `.github/workflows/implement-caller.yml` in `collod873/Lumaria`, an enrolled
repository (docs/agents/enrolment.md), failed with its failing step naming
`.Workflow/agent-workflows/implement/implement.test.ts`, a path inside the machine checkout
rather than the caller's own tree (ADR-0135)...

- Run: https://github.com/collod873/Lumaria/actions/runs/...
- Machine SHA: `abc1234f`

## Acceptance criteria

- [ ] `.Workflow/agent-workflows/implement/implement.test.ts` no longer fails this way, at or
      after machine SHA `abc1234f` - check: `npx vitest run .Workflow/agent-workflows/implement/implement`

## Files claimed

- .Workflow/agent-workflows/implement/implement.test.ts

<!-- walk-home:collod873/Lumaria:19301100200 -->
```

This is this repository's own `to-build` door — the same one every other lane's own implementer
watches — filed by a sweep instead of a person, carrying the check command derived straight from
the failing path's own suffix (`derivedCheckCommand`).

---

## What each stage may touch

| Stage | Reads | Writes | Can act on the tracker |
|---|---|---|---|
| Recover: resolve + ledger (nodes 01–02) | run artifacts/logs, ticket comments | — | escalates (`needs-human`) on the cap or a repeat |
| Recover: no artifact (node 03) | branch state | may delete a stale ref | redispatches `ticket-ready`, comments |
| Recover: with artifact (nodes 04–07) | the downloaded artifact, the target worktree | commits, rebases, pushes (via `landAnswer`), opens a PR | comments; `needs-human` on any refusal |
| Recover: marker (node 08) | — | — | one comment per run reacted to |
| Run watchdog (all nodes) | the repository's own run + job history, existing signal issues | — | opens/comments/closes signal issues, no labels |
| Walk home (all nodes) | every enrolled repository's run history and issues, over the API | — | files a `to-build`/`needs-human`/unlabelled issue, there or here |

---

## Where it stops

Nothing here spends a model call, so cost is not dollars — it is how much work has already been
done, and how hard it would be to undo. Ordered by that instead.

| Done so far | Where | Fires when |
|---|---|---|
| no runner allocated | `recover-caller.yml` `on:`/`if:` | Neither door's condition holds |
| reads only | node 01 (recover) | Neither an artifact nor a log line names a ticket |
| reads only | node 02 (recover) | This run already reacted to; the third attempt on a ticket; a second identical failure |
| a comment, a label | node 05 (recover) | The recovered answer touches the immutable set or adds a gate file |
| reads only | node 06 (recover) | The branch is already claimed and live |
| an artifact downloaded, silent | node 04 (recover) | The downloaded artifact fails `ImplementerAnswer.parse()` — `main()`'s catch logs and exits 1, nothing reaches the ticket |
| a branch claimed | node 07 (recover) | Every refusal `landAnswer` can produce — documented at [`implement-lane-edges.md`](implement-lane-edges.md#where-it-stops) |
| 15 min elapsed | `recover.yml` `timeout-minutes` | The job is cancelled outright — nothing currently re-reacts to *that* |
| no runner allocated | `run-watchdog.yml` `if:` | Not a `session-captured` dispatch |
| reads capped | node 01 (run watchdog) | `MAX_JOB_READS = 60` job reads, one page of 100 runs — past either, the sweep says what it could not see |
| writes capped | node 03 (run watchdog) | `MAX_SIGNALS = 3` new/updated signals per sweep |
| 10 min elapsed | `run-watchdog.yml` `timeout-minutes` | The job is cancelled |
| no runner allocated | `walk-home.yml` `if:` | Not a `session-captured` dispatch |
| reads and writes capped | node 02 (walk home) | `MAX_LOG_READS = 30`, `MAX_FILED = 5` per sweep, shared across every enrolled repository |
| one repository's sweep abandoned | `walkOneRepository` | One repository's own API failure is caught, logged, and the sweep continues over the rest — the run still exits non-zero |
| 15 min elapsed | `walk-home.yml` `timeout-minutes` | The job is cancelled |

---

## Two things worth knowing

**A redispatch can still hit a checkpoint, even though recovery never touches one itself.**
`shared/stage.ts`'s `runStageSession` keys every model response on
`sha256(machine HEAD + "\0" + the rendered prompt)` and writes it to
`.Workflow/agent-workflows/checkpoints/<stage>.json` before the run continues. When node 03 releases
a dead claim and sends a fresh `ticket-ready`, that dispatch starts lane 05 over from its own node
00 — and if the *machine's* ref has not moved and the ticket's own brief renders byte-identical to
what it did on the dead run, `implement.ts`'s own call into `runStageSession` for whichever stage
already wrote a checkpoint on that exact key replays it instead of spending Sonnet again. Recovery
does not know this is happening; it is a property of the lane it redispatches into, not of recovery
itself — the "genuinely answerless death falls back to running this lane over from node 00" line in
`implement-lane-edges.md` is only free of a *second* full price when the checkpoint happens to
still be live.

**The canary fire's fidelity does not match its own topology.** All three lanes appear in
`bin/canary-graph`'s synthetic trigger map, but only two can actually be proven with real code
against a real target: run-watchdog fires meaningfully with no fixture at all, because it reads
whatever state the canary target already has; recover fires along the identical `workflow_dispatch`
path fixer uses, but lacks the fixture entry that gives fixer's fire a `run_id` to act on, so it
currently proves only its own empty branch; and walk-home cannot be fired through `bin/canary` at
all, because the tool's own precondition is a caller stub this lane was built, on purpose, without.

---

## Loose ends in the tree

- **Recover's canary fire is currently vacuous.** `shared/canary-fixture.ts`'s `FIXTURES` has an
  entry for `fixer` (`payload: { run_id: "@run" }`) but none for `recover`, despite both lanes
  sharing the identical `deadRunCaller()` shape and both firing via `workflow_dispatch` under
  `bin/canary`'s own precedence. `bin/canary prove --lane recover` today exercises only the
  "no Implement run named; nothing to recover" branch.
- **`walk-home.ts` redeclares `ENROLMENT_TOPIC` locally** (`"claude-workflow-enrolled"`) rather than
  importing the identically-named constant `enrol/enrol.ts` already exports. The two values agree
  today; nothing enforces that they keep agreeing.
- **`recover.test.ts` cites the wrong ADR for its own cap.** `"MAX_RECOVER_ATTEMPTS is 3, ADR-0041's
  ceiling"` names the fixer's three-attempt cap ("The fixer stops when it stops making progress,
  with three attempts as the ceiling"), a different lane's own note. The ADR that actually states
  recovery's cap is [ADR-0114](../adr/0114-a-red-lane-05-run-is-recovered-from-its-own-artifact-and-han.md).
- **`.Workflow/agent-workflows/checkpoints/author.json` is checked into the repository** carrying a
  response shaped like a local dev run against `Claude Projects/Lumaria` on disk, not this repository's
  own tree. Since only the last write to a stage's checkpoint file survives, this is a leftover from
  outside this repository sitting where a live checkpoint would be written — outside this document's
  remit to touch, but worth someone's notice.
- **Nothing re-reacts to `recover.yml` itself dying.** Its own `workflow_run` door listens to
  `Implement`, never to `Recover`; a schema failure at node 04 exits non-zero having posted nothing,
  and because the job still executes real steps before that, run-watchdog's own zero-jobs signature
  never catches it either.
