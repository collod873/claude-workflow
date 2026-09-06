# The bookkeeping machinery, edge by edge

Followed end to end. Every **node** is something that executes; every **edge** is the payload
travelling between two nodes — what it is, and who is allowed to have read it.

This is not a numbered lane. It does not sit on any work item's path from idea to merge — an issue
can travel from `to-spec` to a merged pull request without a single one of these five workflows
ever touching it. What it does instead is keep count of the ways the pipeline gets bypassed, drops
a dispatch it should have sent, or loses a message it should have written down. Each of the five is
wired to a door of its own, entirely off to the side of the lanes it counts against.

The five machines: [`bypass-counter.yml`](../../.github/workflows/bypass-counter.yml) (caller
[`bypass-counter-caller.yml`](../../.github/workflows/bypass-counter-caller.yml)),
[`lost-dispatch-counter.yml`](../../.github/workflows/lost-dispatch-counter.yml) (caller
[`lost-dispatch-counter-caller.yml`](../../.github/workflows/lost-dispatch-counter-caller.yml)),
[`missing-trailer-counter.yml`](../../.github/workflows/missing-trailer-counter.yml) (caller
[`missing-trailer-counter-caller.yml`](../../.github/workflows/missing-trailer-counter-caller.yml)),
[`back-stamp.yml`](../../.github/workflows/back-stamp.yml) (caller
[`back-stamp-caller.yml`](../../.github/workflows/back-stamp-caller.yml)), and
[`decline-on-revert.yml`](../../.github/workflows/decline-on-revert.yml) (caller
[`decline-on-revert-caller.yml`](../../.github/workflows/decline-on-revert-caller.yml)). All five
are reusable workflows, one job each, `timeout-minutes: 10`, and their own `concurrency:` group
named after themselves with `cancel-in-progress: false`. The state machines are
[`watchdog/bypass-counter.ts`](../../.Workflow/agent-workflows/watchdog/bypass-counter.ts) +
[`bypass.ts`](../../.Workflow/agent-workflows/watchdog/bypass.ts);
[`watchdog/lost-dispatch-counter.ts`](../../.Workflow/agent-workflows/watchdog/lost-dispatch-counter.ts)
+ [`lost-dispatch.ts`](../../.Workflow/agent-workflows/watchdog/lost-dispatch.ts);
[`watchdog/missing-trailer-counter.ts`](../../.Workflow/agent-workflows/watchdog/missing-trailer-counter.ts)
+ [`missing-trailer.ts`](../../.Workflow/agent-workflows/watchdog/missing-trailer.ts);
[`watchdog/back-stamp-walk.ts`](../../.Workflow/agent-workflows/watchdog/back-stamp-walk.ts) +
[`back-stamp.ts`](../../.Workflow/agent-workflows/watchdog/back-stamp.ts); and
[`ratify/run-revert-detector.ts`](../../.Workflow/agent-workflows/ratify/run-revert-detector.ts) +
[`revert-detector.ts`](../../.Workflow/agent-workflows/ratify/revert-detector.ts), leaning on
[`shared/ratification.ts`](../../.Workflow/agent-workflows/shared/ratification.ts) and
[`shared/notes-sync.ts`](../../.Workflow/agent-workflows/shared/notes-sync.ts).

Three of the five — bypass, lost-dispatch, missing-trailer — are **Counters** in this repo's own
vocabulary (`CONTEXT.md`): each names an event that happens on its own, a count at which it acts, the
issue it files, and the action that issue proposes ([ADR-0064](../adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)).
Their standing issue is what [ADR-0011](../adr/0011-a-refusal-ships-only-once-something-can-clear-it.md)
calls a **counter finding**: an unsatisfiable edge in the pipeline's own graph reported once, as a
running tally on one issue, never as a park that a human has to remember to revisit. Back-stamp is a
third kind of mechanism, distinct from a gate and from a lens: its output is the repaired record
itself, so it needs no reader at all. Decline-on-revert files nothing either — it writes a memory
entry nobody but a future ratify run will ever read.

Worked examples below are invented, built to the real shapes and rules each machine enforces; none
reuse the pipeline's own running thread (issue #412 → PRD #419 → tickets #420/#421 → PR #501).
Since these are five independent machines, each gets its own small example rather than one thread
strung through all five.

Legend: **[wire]** deterministic TypeScript or shell · **[stop]** a door that ends the run — or ends
it without acting — before the machine's default write happens. None of the five ever spends a
model call: none installs `@anthropic-ai/claude-code`, none sets `CLAUDE_CODE_OAUTH_TOKEN`, and
every one of them reads and writes exclusively through `gh` and `git`.

---

## Bypass counter

Counts a red tree that reached `main` despite every free venue that should have refused it first —
the event [ADR-0063](../adr/0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md)
named before it was superseded by [ADR-0071](../adr/0071-branch-protection-is-declined-so-move-10-retires-and-its-cou.md),
which declined to buy branch protection and left this counter running anyway, silenced only by a
carrier issue closed `not planned`.

**Worked example.** Over a bad week, four pushes reach `main` with a red `Gauntlet` step in lane
06's Verify job — a stale local clone whose hooks never ran `npm ci`, twice; one `--no-verify`
commit; one made outside a session entirely.

### Node 00 — the door · [stop]

`bypass-counter-caller.yml` `on:`

| | |
|---|---|
| **Fires on** | `workflow_run`, `workflows: ["Verify"]`, `types: [completed]` — every completion of lane 06, success or failure alike |
| **Job `if`** | `github.event.workflow_run.head_branch == 'main'` — a run judging a pull request's branch never counts here; only a push-door run against trunk itself can be a bypass |
| **Carries in** | `verify_workflow: verify-caller.yml`, read back at node 01 as the workflow file whose run history to page through |

### Node 01 — read and correlate the last 100 runs · [wire]

`runBypassCounter()`, `bypass-counter.ts`

Nothing about *this* completed run is trusted directly; the whole history is re-read and
re-derived, same as lane 04's readiness recompute.

| | |
|---|---|
| **Reads** | The last 100 runs of `verify_workflow` (`workflowRunsPath`), filtered to `conclusion === "failure"` |
| **Then, per failed run, capped at 60** | `runJobsPath(runId)` — the first step across all jobs whose own `conclusion` is `"failure"`, named `failedStep` |
| **Read budget** | `MAX_JOB_READS = 60` job reads per sweep; a run beyond that budget is logged as unread, not silently dropped |
| **The predicate** | `isBypass`: `headBranch === "main" && conclusion === "failure" && failedStep === "Gauntlet"` (`BYPASS_STEP`) — explicitly **not** `"Gauntlet could not run"` (an environment problem) or `"Lint workflow files"` (actionlint on the workflow YAML itself); neither is a bypass |

### edge — `VerifyRun[]` · one entry per read run

```ts
{ id: 18790304552, headBranch: "main", createdAt: "2026-09-01T03:14:00Z",
  htmlUrl: "https://github.com/collod873/claude-workflow/actions/runs/18790304552",
  conclusion: "failure", failedStep: "Gauntlet" }
```

### Node 02 — threshold and carrier history · [wire] [stop]

`runBypassCounter()`, `bypass-counter.ts` · `bypass.ts`

| | |
|---|---|
| **Threshold** | `shouldPropose(count)`: `count >= 3` (`BYPASS_THRESHOLD`). Below it, the sweep ends here — a red log line, nothing written |
| **Carrier lookup** | Up to 200 issues, `--state all`; a **carrier** is any whose body contains `<!-- bypass-counter:` |
| **A standing carrier is open** | Ends here — `"already-proposed"` |
| **A carrier is closed `NOT_PLANNED`** | Ends here for good — `"declined-for-good"`; the count is still computed and logged every run, never asked about again |
| **Otherwise** | The highest `markedCount()` among closed carriers is compared against the fresh count; not past it → `"declined-and-not-grown"` |
| **Past every carrier, or none exists** | Files a fresh issue, assigned to the repo owner |

### edge — the filed issue

```
gh issue create --title "The verification lane has bypassed the free gates; bring move 10 forward" \
  --assignee collod873 \
  --body "...four bypasses of \`Gauntlet\` on \`main\`...
  Most recent: [run 18790304552](...), 2026-09-01T03:14:00Z.
  ...
  **Proposal:** bring move 10 (branch protection, ~\$4/month) forward...
  <!-- bypass-counter:4 -->"

→ https://github.com/collod873/claude-workflow/issues/560
```

The marker carries the **count itself**, not just an anchor — a closed carrier's own body is enough
to answer "how many, last time this asked" without re-reading any prose.

---

## Lost-dispatch counter

Counts a `sliceable` label that never turned into sub-issues: a `repository_dispatch` that should
have reached lane 03 and apparently never arrived, or arrived and produced nothing. The label lands
on the *source* PRD, the same asymmetry spec's own `alreadySliced()` deals with from the other
direction.

**Worked example.** PRD #578 ("PRD: retry the nightly canary on a transient network failure")
receives `sliceable`, but the `to-tickets` dispatch is lost in flight; five minutes later the PRD
still has zero sub-issues and no completed slicing run since it was filed.

### Node 00 — the door · [wire] [stop]

`lost-dispatch-counter-caller.yml` `on:` · `countLostDispatch()`, `lost-dispatch-counter.ts`

| | |
|---|---|
| **Fires on** | `issues: [labeled]`, any label, any issue |
| **Caller `if`** | `github.event.label.name == 'sliceable'` |
| **Restated in TypeScript** | `countLostDispatch` also checks `labelName !== SLICEABLE_LABEL` and returns `{action: "skipped"}` — belt-and-suspenders against the caller's own gate, never reached in practice |
| **Carries in** | `slicing_workflow: to-tickets-caller.yml`, the run history node 01 pages through |

### Node 01 — assemble the candidate · [wire]

`countLostDispatch()`, `lost-dispatch-counter.ts`

| | |
|---|---|
| **Reads the PRD** | `title`, `createdAt`, `labels` |
| **Reads sub-issue count** | `subIssuesPath(prdNumber)`, length of the array |
| **Reads slicing history** | `hasCompletedSlicingRun`: any run of `to-tickets-caller.yml` whose `status === "completed"` and `created_at >= prd.createdAt` — checked against the run's own **status**, never its **conclusion**; a slicing run that started, ran, and crashed still counts as "happened" here |
| **The predicate** | `isLostDispatch`: `labels.includes("sliceable") && subIssueCount === 0 && !hasCompletedSlicingRun` |

### edge — `PrdCandidate`

```ts
{ number: 578, title: "PRD: retry the nightly canary on a transient network failure",
  labels: ["prd", "sliceable"], subIssueCount: 0, hasCompletedSlicingRun: false }
```

### Node 02 — carrier lookup and file · [wire] [stop]

`countLostDispatch()`, `lost-dispatch-counter.ts`

| | |
|---|---|
| **Clean** | `isLostDispatch` false → ends here, `"clean"` |
| **Carrier lookup** | Up to 100 open issues; the carrier is the one whose body contains `<!-- lost-dispatch -->` |
| **Already named** | The carrier's body or any of its comments already contains `#578 —` → ends here, `"already-named"` |
| **A carrier exists, not yet named** | One comment appended: `"Also lost:\n\n- [ ] #578 — ..."` |
| **No carrier** | A fresh issue is filed — with **no `--assignee`** at all; unlike the other two counters, this one names nobody |

### edge — the filed issue

```
gh issue create --title "Lost dispatch: a spec carrying \`sliceable\` never sliced" --body "
A \`repository_dispatch\` that never arrived leaves no run for a run-reading sweep to find...

**Carrying \`sliceable\` with no sub-issues and no completed slicing run:**

- [ ] #578 — PRD: retry the nightly canary on a transient network failure: carries \`sliceable\`
  with no sub-issues and no completed slicing run

**To clear a line:** slice it by hand, or investigate why the dispatch never arrived.

<!-- lost-dispatch -->"

→ https://github.com/collod873/claude-workflow/issues/582
```

---

## Missing-trailer counter

Counts an ADR that supersedes a predecessor without saying so, or a research note filed with no
pointer to what prompted it — the corpus's own memory of its edges, recomputed from scratch every
run rather than incrementally tracked.

**Worked example.** ADR-0201 lands, its body reading "retires ADR-0187" and linking it, but the
author forgets the frontmatter `amends: ADR-0187` line the successor is supposed to declare.

### Node 00 — the door · [stop]

`missing-trailer-counter-caller.yml` `on:`

`push`, `branches: [main]`, `paths: ["docs/adr/**", "docs/research/**"]` — the identical door
back-stamp's own caller listens on; see *Two things worth knowing*.

### Node 01 — read the whole corpus · [wire]

`countMissingTrailers()`, `missing-trailer-counter.ts` · `missing-trailer.ts`

Reads every file fresh each run; nothing is diffed against the push that triggered it.

| | |
|---|---|
| **ADR predicate** | `isMissingAmendsTrailer`: no `amends: ADR-\d{4}` line in frontmatter, **and** the body contains a supersession verb (retire/amend/struck/restate/replace, any tense), **and** it links a lower-numbered ADR by filename |
| **Research predicate** | `isMissingResolvesField`: the preamble (text before the first `##` heading) contains none of `Resolves:` / `Researches:` / `Unprompted:` / `Research for` |
| **Filters research notes** | Anything named `draft-*.md` is skipped |

### edge — `TrailerFinding[]`

```json
[{"kind": "adr", "filename": "0201-retry-the-nightly-canary-on-a-transient-network-failure.md",
  "title": "Retry the nightly canary on a transient network failure"}]
```

### Node 02 — standing-issue reconciliation · [wire] [stop]

`countMissingTrailers()`, `missing-trailer-counter.ts`

| | |
|---|---|
| **Zero findings, no carrier** | `"clean"` |
| **Zero findings, a carrier stands** | Comments a retirement note and **closes** the carrier — the one counter of the three that closes its own standing issue on a clean sweep |
| **Findings, no carrier** | Files one, assigned to the repo owner |
| **Findings, a carrier stands** | `saidOn()` joins the carrier's body and every comment; findings whose filename already appears there are dropped as `"silent"`; anything left is a fresh comment |

### edge — the filed issue

```
gh issue create --title "Missing supersession trailer: 1 ADR" --assignee collod873 --body "
This repo's record can't say its own mind changed until the trailer exists to read...

**ADRs missing an \`Amends:\` trailer:**

- [ ] \`0201-retry-the-nightly-canary-on-a-transient-network-failure.md\` carries a supersession
  verb and a lower-numbered ADR link, but no \`Amends:\` trailer

**To clear a line:** write the trailer (or the field), or reply here saying it is not a
supersession; this is a known-noisy heuristic and a false positive is an expected outcome here,
not a bug.

<!-- missing-trailer:corpus -->"

→ https://github.com/collod873/claude-workflow/issues/590
```

---

## Back-stamp

Not a counter — a third mechanism next to Gate and Lens. Its output is the repair itself: a
superseded ADR's frontmatter gains the `superseded_by:` and `status: superseded` lines its own
successor already declared, derived from the `amends:` trailer rather than hand-written
([ADR-0044](../adr/0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md); `docs/adr/README.md`
states `superseded_by:` is "derived by the back-stamp, never hand-written"). It needs no reader.

**Worked example.** Continuing the trailer this time written correctly: ADR-0212 lands with
`amends: ADR-0198` in its own frontmatter. Back-stamp finds ADR-0198 still says `status: constraint`
with no `superseded_by:` line and repairs it.

### Node 00 — the door · [stop]

`back-stamp-caller.yml` `on:` — the identical `push`/`docs/adr/**`+`docs/research/**` door
missing-trailer-counter listens on.

### Node 01 — derive the writes · [wire]

`backStampWalk()`, `back-stamp-walk.ts` · `back-stamp.ts`

| | |
|---|---|
| **Reads** | Every `.md` under `docs/adr/` off the **target** checkout |
| **Builds** | `trailerGraph()`: for every file, its own `amends:` numbers become edges *predecessor → this file's number* |
| **For each predecessor with successors** | `withStatusLine()` rewrites its frontmatter block: inserts or replaces `superseded_by: ADR-0212` (sorted, comma-joined if several), and flips `status:` to `superseded` if a `status:` key exists |
| **Nothing to stamp** | Ends here, `"clean"` — no commit at all |

### edge — the rewritten frontmatter (ADR-0198)

`superseded_by:` is inserted right after `date:` (or at the top of the block if there is no `date:`
line); `status:` is flipped to `superseded` in place, only when a `status:` key already exists:

```diff
 ---
-status: constraint
+status: superseded
 date: 2026-08-30
+superseded_by: ADR-0212
 ---
```

### Node 02 — commit and push · [wire]

`commitAndPush()`, `back-stamp-walk.ts`

| | |
|---|---|
| **Also writes** | `docs/adr/INDEX.md`, regenerated if it exists (`regenerateAdrIndex`) — added to the same commit when it changed |
| **Committer** | `github-actions[bot]`, configured by the caller's own step before this runs |
| **Sequence** | `git add` the stamped files (+ INDEX.md) → `git commit` → `git fetch origin main` → `git rebase origin/main` → `git push origin HEAD:main` — a direct push to trunk, no pull request, no gate |

### edge — the commit message

```
Back-stamp 1 predecessor a trailer already names

docs/adr/README.md said a superseded ADR gains a status line all along, and zero of 43 ever carried
one (ADR-0044); a convention with no reader does not hold. This derives it from the Amends: trailer
its successor already wrote, so nobody has to remember: 0198-....md.
```

---

## Decline-on-revert

Records that the owner declined a ratified finding — but the *deciding* is the owner's own act
(editing `CODING_STANDARDS.md` or `eslint.config.js` and pushing); this machine only notices and
writes it down. `CONTEXT.md`'s **Ratifier** entry states the rule directly: "ratified means merged,
and the owner declines by reverting." Like back-stamp, it needs no reader on GitHub itself — what it
writes is read only by a future ratify run, via `filterByRatificationMemory()`.

**Worked example.** A ratifier batch once landed a `CODING_STANDARDS.md` entry, `**No bare `catch
{}`**`, with `landedAs` recorded on the merge commit's git note. Months later the owner removes that
entry directly and pushes to `main`.

### Node 00 — the door · [stop]

`decline-on-revert-caller.yml` `on:` — `push`, `branches: [main]`, `paths: ["CODING_STANDARDS.md",
"eslint.config.js"]`. `fetch-depth: 0` on the target checkout, and a separate step fetches
`refs/notes/ratifications` before anything runs.

### Node 01 — read the whole ratification history · [wire]

`runRevertDetector()`, `revert-detector.ts`

| | |
|---|---|
| **Reads records** | `readRatificationRecords()`: `git log <head> --notes=ratifications`, no base — every note ever written on any reachable commit, not just this push's diff |
| **Reads what's in the tree now** | `CODING_STANDARDS.md`'s `## Standards` entries (`parseStandardEntries`), and every ESLint rule id enabled (severity not `"off"`/`0`) in `eslint.config.js`, loaded as a live module import |
| **`inTree`** | The union of both — the names a `ratified` record's `landedAs` is checked against |

### edge — `RatificationRecord[]` · one relevant entry

```ts
{ finding: "no-empty-catch", decision: "ratified", sites: ["scripts/canary-summary.ts:41"],
  reason: "landed as \"No bare `catch {}`\" in ratifier PR #501",
  landedAs: "No bare `catch {}`" }
```

### Node 02 — the revert predicate · [wire]

`scanForReverts()`, `revert-detector.ts`

| | |
|---|---|
| **Present** | A `ratified` record whose `landedAs` is still in `inTree` → recorded as `present`, no action |
| **Already declined** | `landedAs` missing, but that `finding` string already carries a `declined` record **anywhere** in the whole history, regardless of when → skipped. A finding declined once is never declined a second time, even after a later re-ratification and a second revert — the check has no notion of "declined, then re-ratified since" |
| **Newly reverted** | `landedAs` missing, no prior decline on record → a fresh `declined` record, `reason: reverted by owner at <sha>: "<landedAs>" is no longer in the tree` |
| **Nothing reverted** | Ends here — logged, no write at all |

### Node 03 — write the note · [wire] [stop]

`syncNotesRef()`, `notes-sync.ts` · `writeRatificationNote()`, `ratification.ts`

| | |
|---|---|
| **Writes** | One `git notes --ref=ratifications add -f -m <json> <head>` onto the triggering push's own commit |
| **Push** | `git push --no-verify origin refs/notes/ratifications:refs/notes/ratifications`; on a `[rejected]` push, fetches and retries once more, then throws — the only one of the five with an explicit retry-then-fail loop, because a shared notes ref is the one piece of state here two runs could race on |

### edge — the declined record, on the push's own commit

```json
[{"finding": "no-empty-catch", "decision": "declined",
  "sites": ["scripts/canary-summary.ts:41"],
  "reason": "reverted by owner at 9f2c1ab...: \"No bare `catch {}`\" is no longer in the tree",
  "landedAs": "No bare `catch {}`"}]
```

---

## What each stage may touch

| Machine | Reads | Writes | Acts on the tracker |
|---|---|---|---|
| Bypass counter | Verify's own run + job history, up to 200 issues | — | Opens, or reuses, one issue |
| Lost-dispatch counter | One PRD's shape, its sub-issues, `to-tickets` run history | — | Opens or comments one standing issue |
| Missing-trailer counter | The whole `docs/adr/` + `docs/research/` corpus, off the target checkout | — | Opens, comments, or closes one standing issue |
| Back-stamp | The whole `docs/adr/` corpus, off the target checkout | Commits and pushes to `main` directly | none |
| Decline-on-revert | `CODING_STANDARDS.md`, `eslint.config.js`, the entire `refs/notes/ratifications` history | Pushes one note onto `refs/notes/ratifications` | none |

Permissions match: `bypass-counter.yml` and `lost-dispatch-counter.yml` both declare
`contents: read, actions: read, issues: write` (the `actions: read` is for the run/job API reads
neither of the other three performs); `missing-trailer-counter.yml` declares
`contents: read, issues: write`; `back-stamp.yml` and `decline-on-revert.yml` both declare
`contents: write` alone — neither one ever opens an issue.

---

## Where it stops

Ordered by how much has been read or written when it fires. Nothing here spends 15 minutes on a
gauntlet or 10 minutes on Opus; the ceiling on all five is the job's own 10-minute
`timeout-minutes`.

| Cost | Where | Fires when |
|---|---|---|
| free | every caller's `on:`/`if:` | Wrong workflow, wrong branch, wrong label, wrong changed path |
| ~100 `gh api` reads | bypass counter's node 01 | Always runs to completion; ends without writing below the threshold of 3 |
| a handful of `gh` reads | lost-dispatch counter's nodes 01–02 | The PRD already sliced, or a standing carrier already names it |
| a full corpus read | missing-trailer counter's node 01 | Always runs to completion; ends without writing when the corpus is clean |
| a full corpus read, no write | back-stamp's node 01 | No predecessor is missing a `superseded_by:` line it should carry |
| the whole notes-ref history, no write | decline-on-revert's node 02 | Nothing ratified has left the tree since the last check |
| a rejected push, retried once | back-stamp's node 02, decline-on-revert's node 03 | A concurrent writer landed on the same ref first; the second attempt refetches and retries, then throws |

None of these can refuse a pull request, a ticket, or a spec — they have no downstream to refuse
into. The worst a bad read does here is a red row in the Actions tab.

---

## Two things worth knowing

**All three counters use the same "one hidden marker names the standing issue" trick, but the
marker plays a different role each time.** Bypass counter's `<!-- bypass-counter:N -->` carries the
*count itself*, so a closed carrier answers "how many, last time this asked" without re-reading any
prose — that is what lets `declined-and-not-grown` compare a fresh count against an old one in one
regex match. Lost-dispatch's `<!-- lost-dispatch -->` and missing-trailer's
`<!-- missing-trailer:corpus -->` are plain anchors instead: finding a carrier only earns a
substring check against the specific PRD number or filename already named in its body and comments.
The difference tracks what each counter needs to remember — a single number, versus an open list of
named lines.

**Back-stamp and missing-trailer-counter share one door, and back-stamp's own commit re-fires
both, without looping.** Both callers listen on the identical `push`, `branches: [main]`,
`paths: ["docs/adr/**", "docs/research/**"]`. A back-stamp commit is itself a push to `docs/adr/**`,
so it wakes both workflows again. It does not loop, for two independent reasons: `deriveBackStamps`
recomputes to a fixed point — once every predecessor named by some `amends:` trailer carries its
`superseded_by:` line, the next pass finds nothing left to write and stops at `"clean"`. And it
cannot manufacture new missing-trailer findings, because the two counters read disjoint fields —
missing-trailer's `isMissingAmendsTrailer` checks the **successor's own** `amends:` line, a field
back-stamp never writes; back-stamp only ever writes `superseded_by:`/`status:` onto the
**predecessor**.

---

## Loose ends in the tree

- **`lost-dispatch-counter.yml` checks out the target repository into `target/`, and nothing reads
  it.** `lost-dispatch-counter.ts` operates entirely through `gh` API calls keyed off `GH_REPO`; it
  never opens a file, never reads `TARGET_WORKSPACE` (which the workflow never sets either). The
  checkout step appears to be vestigial, unlike the identical-looking step in
  `missing-trailer-counter.yml` and `back-stamp.yml`, both of which genuinely read the target's
  `docs/adr/` off disk.
- **`decline-on-revert`'s "already declined" check has no notion of time.** `scanForReverts` builds
  its `alreadyDeclined` set from every `declined` record anywhere in the read history, keyed only by
  `finding`, with no ordering against the `ratified` record it is evaluating. A finding declined
  once, later re-ratified and put back in the tree, and reverted a second time, is never re-declined
  — the second revert produces no record at all, silently.
- **`decline-on-revert`'s current record supply may be stale scaffolding.** The `ratified` records
  its detector reads back are written exclusively by `run-ratification.ts`, wired in
  `shared/lane-wiring.ts` to a `pull_request: [closed]` door gated on the PR title `"Ratified:
  standards from this batch"` (`ratify-release.yml`). But
  [ADR-0122](../adr/0122-findings-land-through-the-implementation-door-the-release-pr.md) states
  plainly that "the release-PR channel it replaces... is deleted," with ratifier batches landing
  through the ordinary `implementation-opened` door instead. Both the release-PR workflow and the
  wiring entry describing it are still present in the tree. I could not establish from the code
  alone whether this is dead machinery nothing dispatches to any more, or whether the ADR is stale
  on this specific point — flagged here rather than guessed at.
- **`lost-dispatch-counter`'s freshness check reads a run's `status`, never its `conclusion`.**
  `hasCompletedSlicingRun` is true once a `to-tickets` run created after the PRD reaches
  `status: "completed"` — success or failure alike. A slicing run that started, then crashed,
  suppresses this finding exactly as a successful one would, even though the PRD was, in fact,
  never sliced.
