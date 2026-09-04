# The verify lane, edge by edge

Lane 06, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

The machine is [`.github/workflows/verify.yml`](../../.github/workflows/verify.yml) (reusable;
enrolled repositories carry only a caller stub, [`verify-caller.yml`](../../.github/workflows/verify-caller.yml)).
There is no TypeScript state machine the way lane 02 has `spec.ts` — the workflow file is the whole
of the logic. The one thing it calls out to is [`bin/gauntlet`](../../bin/gauntlet), the same runner
`turn`, `stop` and `push` use locally, pointed at whichever tree is being judged
([ADR-0139](../adr/0139-an-enrolled-repository-is-checked-by-the-machine-s-gauntlet.md)).

Payload contents below are a worked example built to the real shapes and rules. The example run:
lane 05's implementer opens **PR #501** on branch `impl/421`, implementing **ticket #421** (sliced
from PRD #419, the spec lane's own worked example), changing `scripts/canary-summary.ts` and
`scripts/canary-summary.test.ts`.

Legend: **[wire]** deterministic TypeScript or shell · **[stop]** can refuse and end the run.
Nothing in this lane spends a model call — that happens upstream, in lane 05. A refusal here is
handed to lane 07's fixer, not retried by this file.

---

## Node 00 — the two doors · [stop]

`verify-caller.yml` `on:`

This workflow is woken two ways, and they mean different things. A push to `main` is trunk judging
itself — nothing has been dispatched, there is no pull request, no ticket, no fixer to ring. A
`repository_dispatch` is a specific pull request asking to be judged.

| | |
|---|---|
| **Door 1 — push** | `branches: [main]`, `paths-ignore: **.md, docs/**, LICENSE` — prose-only commits never allocate a runner |
| **Door 2 — dispatch** | `repository_dispatch: implementation-opened` |
| **Who sends door 2** | Three callers, all through the same `dispatchVerify()`: lane 05's implementer opening a PR ([`implementation-landing.ts`](../../.Workflow/agent-workflows/shared/implementation-landing.ts)), the fixer re-dispatching after a repair ([`fixer.ts`](../../.Workflow/agent-workflows/fixer/fixer.ts)), and the ratifier landing a batch ([`ratify/land.ts`](../../.Workflow/agent-workflows/ratify/land.ts)) |
| **Same event, two workflows** | `integrate-caller.yml` listens for the identical `implementation-opened` dispatch and starts in parallel — see node 04. Nothing here tells it to wait |
| **Concurrency** | None declared, unlike `integrate.yml`'s `group: integrate` — see *Loose ends* |

### edge — `client_payload` · what a dispatch carries

```json
{"event_type": "implementation-opened",
 "client_payload": {
   "pr": "https://github.com/collod873/claude-workflow/pull/501",
   "changed_files": ["scripts/canary-summary.ts", "scripts/canary-summary.test.ts"],
   "criteria": ["I'll know it works when I can open the last nightly run and read its own summary without clicking into a job"]
 }}
```

`pr` and `changed_files` (flattened to a comma string on the wire) are read by node 01.
`criteria[]` is sent on every dispatch — and read by nothing in this lane; see *Loose ends*.

---

## Node 01 — the immutability job · [wire] [stop]

`verify.yml` `jobs.immutability`

Runs only on door 2 (`if: github.event.action == 'implementation-opened'`) — a push has nothing to
compare a diff against, so the job is skipped, not passed. No checkout happens before this job
either; it is a `gh api` read and a string comparison, so a refusal here is the cheapest one that
costs a runner at all.

| | |
|---|---|
| **Refuses when** | `CHANGED_FILES` is empty (the dispatch sent nothing to compare); or any changed path equals or starts with `vitest.config.ts` or `.github/` |
| **Why those two** | `.github/` is the workflow definitions themselves — the guarantee that a pull request is always judged by trunk's copy depends on the diff never touching them ([ADR-0054](../adr/0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)). `vitest.config.ts` is the test runner's own configuration — the one file a diff could edit to make its own red tests silently stop running |
| **Reads** | Nothing off disk — `IMMUTABLE_SET` is a two-entry constant (`.Workflow/agent-workflows/shared/immutable-set.ts`), matched against the `CHANGED_FILES` list the dispatch sent, not a live diff |

### edge — the log line · `judging <pr> on <branch>`

```
judging https://github.com/collod873/claude-workflow/pull/501 on impl/421
```

Printed to the job's own log, for no reason internal to this job. It is the rendezvous key node 04
greps for, minutes or workflows later, to prove which run judged which pull request — see *Two
things worth knowing*.

---

## Node 02 — the verify job · [wire] [stop]

`verify.yml` `jobs.verify`

`needs: [immutability]`, `if: always() && needs.immutability.result != 'failure'` — so a *skipped*
immutability job (the push door) still lets this run, and only an explicit `failure` blocks it. This
is the job that spends the 15-minute budget: checkout, lint the workflow files, install, then the
gauntlet itself.

| | |
|---|---|
| **Checks out** | The machine (`collod873/claude-workflow@main`) at the workspace root, and the target — the repository that dispatched this run — under `target/`, side by side, same as lane 02 |
| **Lints** | `.github/workflows/` with `actionlint`, against the machine's own checkout |
| **Installs** | The machine's dependencies via `.github/actions/node` (`npm ci`, cached); the target's via `.github/actions/target-deps`, which detects the target's own package manager rather than assuming npm — an enrolled repository owes this lane no lockfile shape at all ([ADR-0139](../adr/0139-an-enrolled-repository-is-checked-by-the-machine-s-gauntlet.md)) |
| **Runs** | `npm run check` with `TARGET_WORKSPACE` pointed at `target/` — the machine's own `bin/gauntlet push`, reading the *target's* `.claude/contract.json` (`GAUNTLET_CONTRACT` defaults to `$TARGET_WORKSPACE/.claude/contract.json`), never the machine's |
| **Same runner, different tree** | This is `push`'s own slot list — `typecheck lint test clones adrs` — run concurrently, same as a human's pre-push hook. Nothing about this job is bespoke to CI |

### edge — the gauntlet's own report

```
--- test ---
FAIL scripts/canary-summary.test.ts > writes a job summary that quotes the run's own conclusion
gauntlet: FAILED at test
```

One line per failed slot, each slot's captured stdout+stderr beneath it, on the job's own log.
There is no structured verdict object — node 04 reads this job's `conclusion`
(`success`/`failure`), never its output.

---

## Node 03 — the signal-fixer job · [wire]

`verify.yml` `jobs.signal-fixer`

`needs: [immutability, verify]`, fires only when **both** door 2 fired this run *and* one of the
two judging jobs came back `failure` or `cancelled`. A red push to `main` rings nobody — there is
no pull request for a fixer to fix and no ticket to escalate against; it stands as a red run in the
Actions tab.

| | |
|---|---|
| **Permission** | Declares its own `contents: write`, overriding the workflow's default `contents: read` — the only job in this lane that needs to write, because a `repository_dispatch` POST needs it. The job that spends the gauntlet stays read-only |
| **Sends** | One `repository_dispatch`, `fixer-needed`, carrying this run's own `$GITHUB_RUN_ID` |
| **Wakes** | `fixer-caller.yml`, which reads the failed run's log to build a failure signature and starts repairing |

### edge — `repository_dispatch` · `fixer-needed`

```json
{"event_type": "fixer-needed", "client_payload": {"run_id": 18234501177}}
```

The run id, not the PR — the fixer's first move is to look the failure up by run, not to be told
what it was.

---

## Node 04 — the sibling that reads the verdict · [wire] [stop]

`integrate-caller.yml` → `integrate.ts` (lane 08)

Not a job of this workflow — a wholly separate one, dispatched by the identical `implementation-opened`
event and started **in parallel** with node 01. There is no `needs:` across workflow files, so lane
08 cannot be told to wait; it finds out for itself by polling the GitHub API for the run node 01's
log line names.

| | |
|---|---|
| **Matches by** | `head_sha` on a `repository_dispatch`-event run of `verify-caller.yml`, newest id first — a re-judge supersedes what it re-judged, in either direction |
| **Confirms by** | Reading the immutability job's own log for `judging <pr> on ` — a run that merely shares a head commit is not enough; it has to be *this* pull request's own judgment |
| **Waits** | Up to 40 attempts, 15 seconds apart (10 minutes), for the gate job to leave `unjudged`. Past that it gives up — an absent verdict is a refusal, never a pass ([ADR-0054](../adr/0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)) |
| **On immutability failure** | Refuses outright, `reason: "immutable-set"` — whatever the gate job says |
| **On gate failure** | Refuses, `reason: "gate"`, and posts once to the pull request — see the edge below |
| **On green** | Rebases the branch onto trunk, merges, closes the ticket. That path is lane 08's own, not this lane's |

### edge — `VerifyVerdict` · in-process object

```ts
{ immutability: "passed", acceptance: "failed" }
```

### edge — the refusal comment · posted once, on the pull request

```
Lane 06's `Verify` job is **failed** for this head commit, so lane 08 did not merge.

`npm run check` is red against this diff: the ticket's own acceptance tests, or another
check, do not pass. The ticket is not built.

Re-dispatch the pull request once the cause is dealt with; nothing retries this on its own.
```

Green produces no comment at all — silence is the passing case, same as lane 02's gate.

---

## What each stage may touch

| Stage | Fires on push | Fires on dispatch | Checks out | Contents scope | Can act on the PR |
|---|---|---|---|---|---|
| immutability | no (`if` skips) | yes | nothing | read | no |
| verify | yes | yes | machine + target | read | no |
| signal-fixer | no (`if` requires dispatch) | only on a judged failure | nothing | **write** | no — sends a dispatch, not a comment |
| integrate (node 04) | no | yes, same event | machine + target | **write**, `pull-requests: write`, `issues: write` | yes — merges it, or comments the refusal |

---

## Where it stops

Ordered by how much has been spent when it fires.

| Cost | Where | Fires when |
|---|---|---|
| free | `verify-caller.yml` `on:` | Wrong branch, a docs-only push, or a dispatch type this workflow doesn't list — no runner is ever allocated |
| one runner, no checkout | `jobs.immutability` `if` | `github.event.action != 'implementation-opened'` — skipped, not refused; a push run proceeds straight to node 02 |
| one runner, no checkout | `jobs.immutability` body | `CHANGED_FILES` empty, or a changed path touches `vitest.config.ts` or `.github/` |
| up to 15 min | `jobs.verify` | Any gauntlet slot (`typecheck`, `lint`, `test`, `clones`, `adrs`) exits non-zero against the target |
| up to 10 min, then gives up | node 04's poll | The gate job never leaves `unjudged` within 40 tries — treated as a refusal, not a pass |
| 30 min | node 04's own job timeout | The whole integrate job, poll included, is cancelled |

An immutability failure is the cheapest possible refusal *and* the one that saves the most: `verify`'s
`if` reads its result and skips the 15-minute gauntlet entirely rather than running it and discarding
the answer.

---

## Two things worth knowing

**The log line is the rendezvous key.** Two workflows woken by the same event, with no `needs:`
between them, agree on which run judged which pull request through one printed sentence:
`jobJudged()` (`integrate.ts`) greps the immutability job's own log text for `judging ${pr} on `.
It is not a structured artifact, an output, or an API field — it is a string node 01 prints for
exactly this reason and node 04 reads back minutes later, possibly from a different machine.

**The caller stub renames the jobs.** `verify-caller.yml`'s job id is `verify`, so a reusable
workflow's own job names come back prefixed: `verify / Immutability`, `verify / Verify`. That is
why `findJobByName()` matches on `job.name === wanted || job.name.endsWith(" / " + wanted)` rather
than equality — `IMMUTABILITY_JOB` and `GATE_JOB` in `integrate.ts` are the *called* workflow's own
job names (`"Immutability"`, `"Verify"`), never the caller's.

---

## Loose ends in the tree

- `dispatchVerify()` sends `client_payload[criteria][]` on every dispatch. Neither `verify.yml` nor
  `integrate.yml` reads it.
- `verify.yml` declares no `concurrency:` group, unlike `integrate.yml`'s `group: integrate,
  cancel-in-progress: false`. Two dispatches close together for the same pull request can run two
  `verify` jobs — and, if both go red, two `signal-fixer` dispatches — at once.
