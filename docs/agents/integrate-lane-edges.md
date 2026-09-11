# The integrate lane, edge by edge

Lane 08, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

The machine is [`.github/workflows/integrate.yml`](../../.github/workflows/integrate.yml)
(reusable; enrolled repositories carry only a caller stub,
[`integrate-caller.yml`](../../.github/workflows/integrate-caller.yml)). The state machine is
[`.Workflow/agent-workflows/integrate/integrate.ts`](../../.Workflow/agent-workflows/integrate/integrate.ts) —
one exported function, `runIntegrate`. Structurally this is the plainest lane in the pipeline: a
single job, not verify's three or reconcile's two workflows, and it spends **no model call at
all** ([ADR-0040](../adr/0040-lane-08-merges-without-a-model-and-the-semantic-conflict-cla.md)).
Every node below is `[wire]` or `[stop]`; the legend carries no `[model]` tag because nothing in
this file would ever wear one. The workflow's `permissions:` block (`contents: write`,
`issues: write`, `pull-requests: write`, `actions: read`) is declared once, for the one job,
rather than split the way verify and reconcile split a model-spending job from a write-capable
one — there is no model-spending job here for a write scope to need protecting from.

Payload contents below are a worked example built to the real shapes and rules. The example run
continues [`verify-lane-edges.md`](verify-lane-edges.md)'s own: lane 06 has just judged **PR
#501** (branch `implement/issue-421`, implementing **ticket #421**, sliced from **PRD #419**)
green on both jobs — Immutability and Verify — for its head commit. This lane woke on the
identical `implementation-opened` dispatch, in parallel with lane 06, and now confirms that
verdict for itself before merging #501, closing #421, and ringing the `graph-changed` doorbell
that [`reconcile-lane-edges.md`](reconcile-lane-edges.md) answers. **Ticket #420** — #421's own
blocker — was merged and delivered by an earlier run of this same lane; that merge's own
`graph-changed` ring is the hop reconcile-lane-edges.md's node 04 describes as noticing "the
blocker cleared" and dispatching `ticket-ready` straight to lane 05 for #421, without waiting for
another authoring pass. This document's own worked example is that second, closing wave — #420
merged first, #421 second — and it is the last hop the six-document worked example thread
follows; nothing in it depends on #421, and node 07 below says what that means for the ring this
lane sends at the end.

Legend: **[wire]** deterministic TypeScript or shell · **[stop]** can refuse and end the run.

---

## Node 00 — the one door · [stop]

`integrate-caller.yml` `on:` · `integrate.yml` `jobs.integrate.if`

A single door, unlike lane 06's two: `repository_dispatch`, type `implementation-opened`. There
is no push door — nothing about merging trunk into itself is a thing this lane does.

| | |
|---|---|
| **Fires on** | `repository_dispatch: implementation-opened` |
| **Guarded by** | `jobs.integrate.if: github.event.action == 'implementation-opened'` — the `on:` block already lists only this one dispatch type, so this `if:` is closer to a restated confirmation than a second, independent filter |
| **Same event as** | `verify-caller.yml`'s door 2 (verify-lane-edges.md, node 00). Both workflows wake off the identical dispatch, in parallel; neither `needs:` the other — this lane finds out lane 06's verdict for itself, at node 04 |
| **Who sends it** | The callers `dispatchVerify()` funnels through: lane 05's implementer opening a pull request, the fixer re-dispatching after a repair, the ratifier landing a batch, and this lane's own node 08 draining the next PR |
| **Concurrency** | `group: integrate`, **global** — not scoped per pull request or issue the way `spec.yml` scopes per issue, and global for a different reason than `dispatch-reconcile.yml`'s own global group. Two pull requests merging at once would each rebase onto and push `main`; ADR-0040 keeps the merge serialised rather than building anything to arbitrate that race ("The merge stays serialised"). `cancel-in-progress: false` is **not a queue**: GitHub holds one running and one pending run per group, and each newer pending run cancels the older one. Seven PRs opening in three minutes on 2026-09-11 left five `cancelled` runs and five PRs unmerged (#516). Node 08's drain covers the dispatches the group drops |
| **Permissions** | `contents: write`, `issues: write`, `pull-requests: write`, `actions: read` — declared once, at the workflow's top level, for the lane's single job |

Before `integrate.ts` runs at all, the job also: checks out the machine
(`collod873/claude-workflow@main`) and the target (`fetch-depth: 0`, needed for the rebase) side
by side, the same layout lanes 02 and 06 use; sets a bot git identity
(`github-actions[bot]`) in the target checkout, since this is the one lane that commits to it
directly, via the rebase's own force-push; and installs Node and the target's own dependencies
through `.github/actions/node` and `.github/actions/target-deps`, exactly as lane 06's `verify`
job does.

### edge — `client_payload` · what this lane reads of it

```json
{"event_type": "implementation-opened",
 "client_payload": {
   "pr": "https://github.com/collod873/claude-workflow/pull/501",
   "changed_files": ["scripts/canary-summary.ts", "scripts/canary-summary.test.ts"],
   "criteria": ["I'll know it works when I can open the last nightly run and read its own summary without clicking into a job"]
 }}
```

Only `client_payload.pr` becomes anything here (`env.PR`, read at the job's own level).
`changed_files` and `criteria[]` ride on every dispatch — see verify-lane-edges.md's own *Loose
ends* — and nothing in this workflow reads either.

---

## Node 01 — `readPr` · [wire]

`integrate.ts` `readPr()`

Reads the pull request exactly once, for two facts: which branch to rebase, and which ticket, if
any, it built.

| | |
|---|---|
| **Reads** | `gh pr view $PR --json headRefName,body` |
| **Finds the ticket by** | Matching `TICKET_REFERENCE_RE` — `` /^Ticket: #(\d+)\b/m `` — against the pull request's own body text. Not a GitHub closing keyword: a `Closes #<n>` body lets anyone who merges the PR in the web UI close the ticket with no `## Closing record` ([ADR-0180](../adr/0180-a-commit-message-carrying-a-github-closing-keyword-is-refuse.md)'s bypass, by the PR route) |
| **Deliberately not** | GitHub's own `closingIssuesReferences` field. A test names this directly: the ticket comes from the body this lane reads for itself, never a second API's interpretation of it |
| **No match** | `ticket` is `undefined` — legal; node 06 reads that as "nothing to close" |

### edge — `PullRequest` · in-process object

```ts
{ branch: "implement/issue-421", ticket: 421 }
```

Read off PR #501's own body, `"Wrote the run's own step summary...\n\nTicket: #421"` — the exact
text implement-lane-edges.md's own worked example shows `gh pr create` writing.

---

## Node 02 — rebase onto trunk · [wire] [stop]

`rebaseOntoTrunk()`, `integrate.ts`

The git-level conflict class ADR-0040 assigns to this lane, in contrast with the *semantic*
conflict class it explicitly declines to hold a merge for (that class is the proposed lens's own,
per the same ADR). This runs before the gauntlet, before reading lane 06's verdict, before
anything else — a branch that cannot even replay onto trunk is not worth spending another read
on.

| | |
|---|---|
| **Sequence** | `git fetch origin main $BRANCH`; checkout the branch; `git rebase origin/main`; on success, `git push --force-with-lease origin HEAD:$BRANCH` |
| **On a real conflict** | The rebase throws; `git diff --name-only --diff-filter=U` names the unmerged paths; `git rebase --abort` restores the branch; returns `{conflicted: true, paths}` |
| **A rebase failure that leaves nothing unmerged** | Re-thrown, uncaught — not the conflict class this node exists to catch, and the whole job goes red |
| **Never force-pushes** | on a conflict — the abort runs first, so the remote branch is untouched |

### edge — the conflict refusal · ticket escalation + pull request comment

```
**Blocked: rebase conflict.** Lane 08 could not replay this branch onto current trunk, so it
aborted the rebase and merged nothing. No model ran and nothing here judged the diff.

Conflicting paths:

- `scripts/canary-summary.ts`

Rebase it by hand and re-dispatch the pull request; nothing retries this on its own.
```

Posted on the pull request. If the pull request names a ticket (node 01), that ticket is
labelled `needs-human` and assigned to `SIGNAL_ASSIGNEE` (`github.repository_owner`) first —
`escalateToOwner()`, the same function the fixer and the acceptance author call elsewhere in this
pipeline.

This is the one refusal in the lane that costs the job nothing in its own eyes: `main()` never
sets `process.exitCode` for a `conflict` outcome, so this run finishes **green** in the Actions
tab — see *Two things worth knowing*.

---

## Node 03 — the re-run gauntlet · [wire] [stop]

`runRealGauntlet()` → `shared/run-gauntlet.ts` → `bin/gauntlet push`

The insurance ADR-0040 names directly: lane 06 judged the pull request's head commit, and this
lane has just moved that commit onto a different tree by rebasing it. The gauntlet runs again,
against the rebased result, before anything is asked about lane 06's verdict at all.

| | |
|---|---|
| **Venue** | `push` — the same slot list a human's own pre-push hook runs: `typecheck lint test clones adrs` (`.claude/contract.json`), concurrently, via the same `bin/gauntlet push` |
| **Exit 0** | Continue to node 04 |
| **Exit 1** | `{merged: false, reason: "red"}` |
| **Any other exit** | `{merged: false, reason: "no-run"}` — a crash, or a tool that could not even run, is kept a distinct finding from a red test, even though neither merges |
| **On failure** | Captured stdout+stderr goes to the job's own log (`console.error`). Both `red` and `no-run` post one short pull request comment naming the refusal and carrying the refusal marker node 08 reads; neither touches the ticket — see *Where it stops* |

### edge — `GauntletResult` · in-process, exit code only

```ts
{ exitCode: 1 }
```

No structured report crosses this edge, same as lane 06's own gauntlet run (verify-lane-edges.md
node 02): the exit code is the whole of what the next node is told.

---

## Node 04 — await lane 06's verdict · [wire] [stop]

`awaitVerifyVerdict()` / `readVerifyVerdict()`, `integrate.ts`

This is the other half of verify-lane-edges.md's own node 04 — the identical function, read from
this side of the edge. It polls for the newest `repository_dispatch` run of the workflow named in
`verify_workflow` (`verify-caller.yml`) whose `head_sha` equals `HEAD_SHA` — the commit named by
this lane's own `$GITHUB_SHA`, off the same dispatch event both workflows woke to, and the commit
lane 06 actually judged, not the commit this lane's own rebase just produced — confirmed by
grepping the immutability job's own log for `` judging ${pr} on ``.

| | |
|---|---|
| **Waits** | Up to 40 attempts, 15 seconds apart (10 minutes), for the `Verify` job to leave `unjudged` |
| **Immutability failed** | `{merged:false, reason:"immutable-set"}` — one short pull request comment pointing at lane 06's log, carrying the refusal marker; no ticket touched |
| **Immutability not passed** (unjudged, still running, skipped) | `{merged:false, reason:"unjudged"}` — the same short comment |
| **Acceptance (`Verify` job) failed** | `noteAcceptanceRefusal()` posts once on the pull request, then `{merged:false, reason:"gate"}` |
| **Acceptance still unresolved after the wait** | The same comment function, worded for the timeout case, then `{merged:false, reason:"unjudged"}` |
| **Both jobs passed** | Falls through to node 05 |

ADR-0104 is the ruling actually in force: both of lane 06's jobs bind the merge, judged on the
pull request's own head commit rather than trunk. ADR-0095's own text — block on immutability,
only *warn* on acceptance — is superseded and no longer describes this code: every failure mode
above refuses the merge outright. Every refusal now leaves a pull request comment, because node
08 reads the comment's marker to know not to re-send the PR. An immutability refusal's comment
only points at lane 06's log, where the cause already is. A gate failure or a timeout gets the
longer comment below, since that verdict is one a pull request's author cannot see without opening
Actions.

### edge — `VerifyVerdict` · in-process object

```ts
{ immutability: "passed", acceptance: "passed" }
```

### edge — the gate refusal · posted once, on the pull request

```
Lane 06's `Verify` job is **failed** for this head commit, so lane 08 did not merge.

`npm run check` is red against this diff: the ticket's own acceptance tests, or another
check, do not pass. The ticket is not built.

Re-dispatch the pull request once the cause is dealt with; nothing retries this on its own.
```

Text identical to verify-lane-edges.md's own copy of this edge — the same `noteAcceptanceRefusal()`
call, read here from the emitting side rather than the receiving one.

### edge — the timeout wording · the other half of the same function

```
Lane 06's `Verify` job is **unjudged** for this head commit, so lane 08 did not merge.

The job never reached a verdict within the window this lane waits, and an absent verdict
is a refusal, never a pass (ADR-0054).

Re-dispatch the pull request once the cause is dealt with; nothing retries this on its own.
```

---

## Node 05 — merge · [wire]

`mergePr()`, `integrate.ts`

```
gh pr merge https://github.com/collod873/claude-workflow/pull/501 --merge --delete-branch
```

One call. `--merge`, never squash or rebase — the commit history node 02's own rebase already
produced on the branch is what lands, and the branch is deleted on GitHub in the same call.
Nothing native to GitHub gates any of this: `main` carries no required status checks
([ADR-0071](../adr/0071-branch-protection-is-declined-so-move-10-retires-and-its-cou.md) declines
branch protection), so the ordering this whole lane exists to enforce — rebase, re-run the
gauntlet, confirm lane 06, only then merge — is enforced entirely by this code, never by the
platform.

---

## Node 05a — ring the target's own CI · [wire]

`ringTrunkCi()`, `integrate.ts` — called immediately after `mergePr()`, before anything that
touches the ticket or the doorbell.

A merge landed by this lane runs under `GITHUB_TOKEN`, and GitHub fires no `push` event for a
commit `GITHUB_TOKEN` puts on a branch. A target repository whose own CI workflow triggers on
`push` — the ordinary way a project gates its trunk — therefore never runs on the commit this
lane just moved `main` to, unless something asks it to. This node is that ask.

| | |
|---|---|
| **Guarded by** | Whether the target checkout carries `.github/workflows/ci.yml`. Absent, this node does nothing — a target with no such file has no trunk-only job this lane could ring, and this repository's own trunk gate is Verify, run on the pull request, not a `ci.yml` on `main` |
| **Sends** | `gh workflow run ci.yml --ref main` — an argv, not a shell string, the same discipline every other call in this lane holds to |
| **Needs** | The dispatched workflow to answer `workflow_dispatch` as well as `push`; a `ci.yml` that only declares `on: push` has nothing for this call to trigger |
| **On failure** | Logged to the job's own console only. The merge already landed at node 05; a ring that cannot reach the target's Actions API is information about that repository's CI, not about this one, and reverses nothing this lane already did |

### edge — the dispatch

```
gh workflow run ci.yml --ref main
```

No payload beyond the ref — this is a trigger, not an announcement; node 05a tells the target
repository to run its own build, and node 07 below is what tells this repository's own
reconciler that anything happened here at all.

---

## Node 06 — close the ticket · [wire] [stop-per-ticket]

`closeMergedTicket()` → `bin/close-ticket`, via `closeTicketProcess()`

Runs only after the merge, and only in **ticket** mode — never `--spec`; that mode belongs to
reconcile-lane-edges.md's own node 02, closing a `prd` issue on its own check once every child is
delivered. The range closed against is captured **before** the merge moves trunk:
`origin/main..HEAD` at the point node 02's rebase left it, so its base is trunk's tip the instant
before this pull request lands on it.

| | |
|---|---|
| **No ticket named** (node 01) | `{closed:false, reason:"no-ticket"}` — `bin/close-ticket` is never invoked; the merge still stands |
| **Invocation** | `bin/close-ticket <ticket> <range> <target-checkout>` — no `--spec`, no `-R`; `gh`'s own repo resolution rides on the same `GH_REPO`/`GH_TOKEN` environment the parent process already carries (`childEnv()` forwards it, minus the `GIT_*` location variables) |
| **Refuses first on** | Any surviving `test.fails(`/`it.fails(` line under `.Workflow`/`.claude` still naming `#<ticket>` — the implementer's own convention (reconcile-lane-edges.md node 09) read back as a closing gate: a criterion cannot close true while its own acceptance test still says the work isn't built |
| **Then runs** | Each `## Acceptance criteria` item's own `check:` command against the target checkout, exactly as a hand-run close would |
| **Exit 0** | `{closed:true, ticket}` |
| **Exit non-zero** | `noteRefusal()` comments the ticket with `bin/close-ticket`'s own stderr tail (last 4,000 characters); **the merge stands regardless**. `{closed:false, reason:"refused", ticket}` |
| **`closeTicket` itself throws** (not merely a non-zero exit) | Caught, logged to the job's own console only — no ticket comment at all. Same `{closed:false, reason:"refused", ticket}` outcome |

### edge — the invocation

```
bin/close-ticket 421 3f0a91e..71cbf5a /home/runner/work/.../target
```

### edge — the closing record · posted as an issue comment, then the issue closes

```
## Closing record

Closed by #501 · merge `71cbf5a` · Verify: passed

1 of 1 criteria verified · 0 unverified

- writes a job summary that quotes the run's own conclusion (MET: `gh run list --workflow=nightly.yml --json conclusion --jq '.[0].conclusion == "success"'` exit 0)
```

The `Closed by #501 · merge … · Verify: …` header comes from `bin/close-ticket`'s **own,
independent** read of lane 06's verdict (`fetch_verify_verdict()`, Python) — the same
rendezvous-key algorithm as `integrate.ts`'s `readVerifyVerdict()` (newest dispatch run of
`verify-caller.yml`, matched by `head_sha`, confirmed against the same `` judging <pr> on ``
log line, the same two job names `Immutability`/`Verify`), reimplemented rather than shared. It
exists to decorate the record, not to gate anything — a failed lookup here only downgrades to a
`warning:` on stderr, and the close proceeds regardless.

### edge — the close refusal · posted on the ticket

````
Lane 08 merged https://github.com/collod873/claude-workflow/pull/501 and could not close this
ticket: `bin/close-ticket` exited 1, so no `## Closing record` was posted and this stays open.

The merge stands; a criterion that did not check out does not un-land it. Re-run the same
`bin/close-ticket` invocation once the criterion is satisfied; that is the whole recovery path.

```
error: 4 acceptance criteria and every criterion unverified
```
````

---

## Node 07 — ring `graph-changed` · [wire]

`announceGraphChanged()`, `shared/ready-set.ts` — called last, after both the merge and the close
attempt, whichever way the close went.

| | |
|---|---|
| **Sends** | `requestDispatch()` — no `DISPATCH_REQUESTS_PATH` is exported anywhere in `integrate.yml`, so this always takes the direct branch: `gh api repos/{owner}/{repo}/dispatches -f event_type=graph-changed -f 'client_payload[pr]=...'`, sent immediately, from the same job that already holds `contents`/`issues`/`pull-requests` write. No split-job handoff the way lane 02's dispatch or lane 04's own author job uses — the same reason reconcile-lane-edges.md gives for its own node 04: nothing here spends a model, so there is no read-only job whose token needs protecting from the write scope |
| **Carries** | The pull request URL. Nothing else — no issue number, no ticket, no delivery state |
| **Reads** | Nothing off the dependency graph — checked directly by a test: "the doorbell carries no graph read: ADR-0069 keeps the graph lane 03's" |
| **Ordering** | [ADR-0115](../adr/0115-the-doorbell-rings-after-the-close-it-announces-and-a-lane-h.md): ring **after** the close, never before. The superseded [ADR-0094](../adr/0094-lane-08-closes-the-ticket-it-merged-and-a-ticket-that-will-n.md) rang first; under that ordering every merge re-dispatched the very ticket it had just merged and withheld its successors, exiting green regardless |

### edge — `repository_dispatch` · `graph-changed`

```json
{"event_type": "graph-changed", "client_payload": {"pr": "https://github.com/collod873/claude-workflow/pull/501"}}
```

One more ring shares this node, and only for one kind of pull request. When the PR lane 08 merged
carries the ratifier's title (`RATIFIER_PR_TITLE`, `shared/ratification-dispatch.ts`), it rings
`ratifier-merged` with the same `{pr}` payload, right after the merge and before the close attempt.
That ring is the only thing that wakes `ratify-release.yml`
([ADR-0164](../adr/0164-the-ratifier-s-merge-is-announced-by-a-ring-from-lane-08-bec.md)). An
implementation PR, like #501 here, rings nothing extra.

This is the same shape of ring that, earlier in this worked example's own history, announced
ticket #420's merge and let reconcile-lane-edges.md's node 04 notice #421's blocker had cleared,
dispatching `ticket-ready` for #421 directly — the hop that put #421 in front of lane 05 and,
several documents later, produced this run. Rung again here for #421's own merge, the recompute
it wakes finds nothing else waiting on #421 in this worked example: a `graph-changed` ring is an
announcement, never a claim that something is now unblocked
([ADR-0084](../adr/0084-readiness-is-recomputed-rather-than-pushed-so-a-merge-announ.md), "a
merge announces without interpreting"), and reconcile-lane-edges.md's own node 06 calls that
outcome `"clear"` — a legitimate ending, not a lesser one than `"dispatched"`.

---

## Node 08 — drain the next pull request · [wire]

`drainNextPr()`, `integrate.ts` — runs after every run that reached an outcome, merged or refused,
so the queue does not depend on each PR's own dispatch surviving node 00's concurrency group.

| | |
|---|---|
| **Reads** | `gh pr list --state open --json number,url,headRefName,headRefOid,files,comments`, one call |
| **Picks** | The lowest-numbered open PR on an `implement/issue-*` branch that is not the one this run just judged and carries no refusal marker for its current head |
| **Refusal marker** | `<!-- integrate-refused:v1 <sha> -->`, written into every refusal comment nodes 02–04 post. `<sha>` is the head the refusal judged: the rebased head for every refusal after node 02, the unrebased head for a conflict. A push to the branch moves the head past the marker, so a fixed PR is drained again; an unchanged one never is, so a red PR cannot loop |
| **Sends** | `implementation-opened` through `dispatchVerify()`, carrying the PR's own `files` as `changed_files`, since lane 06 wakes on the same dispatch and its immutability job refuses an empty list. `criteria` is empty: nothing downstream reads it |
| **Drops** | Its own failure. A `gh` error here is logged and the run keeps the outcome it already had |
| **Not drained** | Branches the implementer did not open (a ratifier PR, a by-hand branch), which still need their own dispatch |

Each drained run sends the next one, and each send replaces whatever pending run the group was
holding, so at most one PR is in flight and one queued at any moment. A PR whose own dispatch was
already the pending one is simply re-sent; the group keeps one copy.

---

## What each stage may touch

| Node | Reads | Writes | Can act on the pull request / ticket |
|---|---|---|---|
| 00 — the door | the dispatch payload | — | — |
| 01 — `readPr` | the pull request's own `headRefName` + `body` | — | — |
| 02 — rebase | the target's git history, trunk | force-pushes the branch, on success | on conflict: labels + assigns the ticket, comments the pull request |
| 03 — gauntlet | the rebased target tree | — | on failure: one short refusal comment on the pull request |
| 04 — await verdict | lane 06's run history, the immutability job's own log | — | comments the pull request on every refusal |
| 05 — merge | — | merges and deletes the branch, on GitHub | merges the pull request |
| 06 — close | the ticket body, the target's `.test.ts` tree, each criterion's own check command | comments and closes the ticket | closes the ticket, or comments its own refusal |
| 07 — ring | — | sends one dispatch | — |
| 08 — drain | every open pull request's head, files and comments | sends at most one dispatch | — |

---

## Where it stops

Ordered by how much has been spent when it fires.

| Cost | Where | Fires when | Job outcome |
|---|---|---|---|
| free | `integrate-caller.yml`/`integrate.yml` `if:` | Wrong dispatch type or action — no runner is ever allocated | — |
| one checkout, no gauntlet spend | node 02 | The rebase leaves real conflicts | **green** — the one refusal that costs the job nothing in its own eyes |
| one checkout, no gauntlet spend, re-thrown | node 02 | The rebase fails with nothing left unmerged | red — an unhandled error, not this node's own refusal |
| up to 15 min | node 03 | Any gauntlet slot is red against the rebased tree, or the gauntlet cannot run at all | red, one short refusal comment on the pull request, silent to the ticket |
| up to 10 min, then gives up | node 04's poll | Lane 06's immutability job failed, or never resolves | red, one short refusal comment on the pull request |
| up to 10 min, then gives up | node 04's poll | Lane 06's gate job failed, or never resolves | red, pull request comment posted |
| after the merge | node 06 | `bin/close-ticket` refuses, or throws | **still green** — the merge already happened, and nothing here reverses it |
| 30 min | the job's own `timeout-minutes` | The whole job, poll included, is cancelled | red |

---

## Two things worth knowing

**A rebase conflict is the only refusal that leaves the job green.** `main()` sets
`process.exitCode = 1` for every unmerged outcome *except* `"conflict"`, and never sets it at all
once `merged: true` — regardless of how the ticket close went. The job's own colour in the
Actions tab tracks something narrower than "did everything succeed": it tracks whether the tree
itself needs another look. A rebase conflict and a ticket-close refusal are both told to the
place a human would look — the pull request, or the ticket — but neither reflects back onto this
run's own colour, because the one thing this lane exists to gate, the merge, already went through
clean in both cases.

**Two independent implementations read the same rendezvous key.** Node 04 documents
`readVerifyVerdict()`/`jobJudged()` in TypeScript; `bin/close-ticket`'s own
`fetch_verify_verdict()`/`job_matches_name()` (Python) walk the identical path — newest dispatch
run of `verify-caller.yml`, matched by `head_sha`, confirmed by the same `` judging <pr> on ``
log line, the same two job names `Immutability` and `Verify` — to fill in one cosmetic line of
the closing record (node 06). A change to lane 06's job names or its log-line wording has to be
made in both places to keep the record honest; nothing enforces that today.

---

## Loose ends in the tree

- ADR-0040 describes the merge warden's own steps as "rebase, re-run the gauntlet against current
  trunk, merge, deploy preview." There is no deploy-preview step anywhere in `integrate.ts`,
  `integrate.yml`, or `integrate-caller.yml` — `runIntegrate` ends at `announceGraphChanged()`.
  Either the ADR names a step that was never built, or one that lives somewhere this reading did
  not find.
- A gauntlet failure after the rebase (`red` or `no-run`, node 03) now comments on the pull
  request, but still escalates nothing on the ticket, and node 08 deliberately never re-sends
  it. A red caused by a flaky test (#517) strands the PR until someone re-dispatches it by hand
  or pushes to it.
- [`pipeline-labels.md`](pipeline-labels.md) describes `needs-human` as meaning "an agent tried
  and stopped: a criterion still unmet after one fix pass, or the merge gate rejected the same
  merge twice." Lane 08's own use of it (node 02, on a rebase conflict) is neither of those — a
  first-time git-level conflict, not a repeated rejection. The label's actual trigger set is
  wider than that table documents; `fixer.ts`, `acceptance.ts`, `implement.ts`, `mechanic.ts` and `reconcile.ts`
  each write it too, for their own reasons.
- `bin/close-ticket`'s own docstring says it "dispatches nothing." True of the script's own I/O
  boundary — but the ticket it closes is exactly what lets node 07's `graph-changed` ring carry
  meaning once reconcile-lane-edges.md's recompute reads the tracker again; the docstring is about
  what this script sends, not about what depends on what it did.
