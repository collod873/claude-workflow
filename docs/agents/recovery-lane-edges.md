# The recovery machinery, edge by edge

Followed end to end. Every **node** is something that executes; every **edge** is the payload
travelling between two nodes — what it is, and who is allowed to have read it.

This is not a numbered lane. It does not sit on a work item's own path from idea to merge the way
lanes 00 through 08 do, and it carries no lane number of its own. It is what notices that a lane
run died and gets the work moving again — three independent responses to three different shapes of
death, not three steps of one pipeline.

## The machines

Two workflows, each proven separately because neither hands off to the other:

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

Neither ever installs `@anthropic-ai/claude-code` or spends a model call — neither
`run-watchdog.yml` nor `walk-home.yml` references `CLAUDE_CODE_OAUTH_TOKEN` anywhere.
The paid work already happened upstream, in whatever died; this machinery reads its wreckage and
writes to the tracker, nothing more. `shared/stage.ts` — the model-calling infrastructure every
other lane's edge doc cites — never appears here. The one place a **checkpoint** written by that
infrastructure matters to this machinery is Two things worth knowing, below.

## The worked examples

This machinery sits off the main worked-example thread (issue #412 → PRD #419 → tickets #420/#421
→ PR #501 on `implement/issue-421`). Nothing below continues that thread, and #421's own run still
succeeds exactly as the other edge docs describe it. Run watchdog's worked example is a fictional dead
run of `to-tickets-caller.yml`, a real file in this repository, standing in for whatever lane
happens to have gone silent. Walk home's worked example runs against `collod873/Lumaria`, a real
enrolled repository named in ADR-0141 and in this repository's own research notes — not a
fictional stand-in, since walk-home's whole subject is *other* repositories and there is no reason
to invent one.

Legend: **[wire]** deterministic TypeScript or shell · **[stop]** can refuse and end the run. No
node in this document is tagged **[model]** — see above.

---

## Part one — a dead Implement run

There is no longer a machine for this. A run of lane 05 that dies is read off the Actions API by
the reconciler on the next ending of any lane, written to its ticket as a strike, and climbed as a
rung: [reconcile-lane-edges.md](reconcile-lane-edges.md), the ladder, and
[mechanic-lane-edges.md](mechanic-lane-edges.md) for the third rung. Recover, which listened for
one lane through one `if:`, is gone with #384.

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
`eventType: session-captured` — there is no `workflow_dispatch` door to take precedence.
`run-watchdog` carries no entry in `shared/canary-fixture.ts`'s `FIXTURES` either, and needs none:
it is handed nothing to act on — it reads the canary target's own real run history over the API,
so a bare fire is a meaningful proof here.

---

## Node 01 — read the window · [wire]

`run-watchdog.ts` `runWatchdog`

| | |
|---|---|
| **Reads** | `GET /actions/runs?per_page=100` (`RUN_PAGE_SIZE`), projected to `{id, name, path, status, conclusion, html_url, head_branch, created_at}`. |
| **Candidates** | `isCandidate()` — `status: completed`, `conclusion: failure`, and inside `LOOKBACK_DAYS = 7`. A `cancelled` run is *not* a candidate here — that is the reconciler's strike, not a silent death. |
| **Budget** | At most `MAX_JOB_READS = 60` candidates get a per-run jobs read (`GET .../runs/{id}/jobs`, `.total_count`). Past that, and past the one page of 100 runs, the sweep says so in its own log rather than silently under-counting. |
| **A jobs read with no count** | Throws rather than reading an empty response as zero — "refuses a jobs read that returns no count, rather than reading it as zero" (the suite's own words). |

---

## Node 02 — dead lanes, by job count alone · [wire]

`watchdog/dead-lanes.ts` `deadLanes` / `executedNothing`

The entire detection rule is one field: `run.jobCount === 0`. Nothing about *why* — a red gauntlet,
a cancelled step, a timeout — counts here; those are the reconciler's strikes or the fixer's
business, never this lane's. Grouped by workflow `path`, newest run first within each group.

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
| **Reads** | `gh run view <runId> -R collod873/Lumaria --log-failed` — only the failing step, the same read the reconciler makes for a strike's signature. |
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
| Run watchdog (all nodes) | the repository's own run + job history, existing signal issues | — | opens/comments/closes signal issues, no labels |
| Walk home (all nodes) | every enrolled repository's run history and issues, over the API | — | files a `to-build`/`needs-human`/unlabelled issue, there or here |

---

## Where it stops

Nothing here spends a model call, so cost is not dollars — it is how much work has already been
done, and how hard it would be to undo. Ordered by that instead.

| Done so far | Where | Fires when |
|---|---|---|
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

**A redispatch can still hit a checkpoint.** `shared/stage.ts`'s `runStageSession` keys every
model response on `sha256(machine HEAD + "\0" + the rendered prompt)` and writes it to
`.Workflow/agent-workflows/checkpoints/<stage>.json` before the run continues. When the reconciler
releases a dead claim and sends a fresh `ticket-ready`, that dispatch starts lane 05 over from its
own node 00 — and if the *machine's* ref has not moved and the ticket's own brief renders
byte-identical to what it did on the dead run, `implement.ts`'s own call into `runStageSession`
replays the checkpoint instead of spending Sonnet again. The strike comment on the ticket changes
the brief, so a re-dispatch after a strike renders differently and never replays a dead run's
answer.

**The canary fire's fidelity does not match its own topology.** Both lanes appear in
`bin/canary-graph`'s synthetic trigger map, but only one can actually be proven with real code
against a real target: run-watchdog fires meaningfully with no fixture at all, because it reads
whatever state the canary target already has; walk-home cannot be fired through `bin/canary` at
all, because the tool's own precondition is a caller stub this lane was built, on purpose, without.

---

## Loose ends in the tree

- **`walk-home.ts` redeclares `ENROLMENT_TOPIC` locally** (`"claude-workflow-enrolled"`) rather than
  importing the identically-named constant `enrol/enrol.ts` already exports. The two values agree
  today; nothing enforces that they keep agreeing.
- **`.Workflow/agent-workflows/checkpoints/author.json` is checked into the repository** carrying a
  response shaped like a local dev run against `Claude Projects/Lumaria` on disk, not this repository's
  own tree. Since only the last write to a stage's checkpoint file survives, this is a leftover from
  outside this repository sitting where a live checkpoint would be written — outside this document's
  remit to touch, but worth someone's notice.
