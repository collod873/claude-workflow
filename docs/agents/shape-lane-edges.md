# The shape lane, edge by edge

Lane 01, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

Unlike lane 02, this lane is two separately-triggered reusable workflows rather than two jobs in
one machine: the shape run,
[`.github/workflows/shape.yml`](../../.github/workflows/shape.yml) (caller stub
[`shape-caller.yml`](../../.github/workflows/shape-caller.yml)), and the accept run,
[`.github/workflows/shape-accept.yml`](../../.github/workflows/shape-accept.yml) (caller stub
[`shape-accept-caller.yml`](../../.github/workflows/shape-accept-caller.yml)). Nothing but the
tracker's own labels and comments passes between them — no `needs:`, no dispatch, no shared job.
The state machines are
[`.Workflow/agent-workflows/shape/shape.ts`](../../.Workflow/agent-workflows/shape/shape.ts) (the
shape run) and
[`.Workflow/agent-workflows/shape/accept.ts`](../../.Workflow/agent-workflows/shape/accept.ts),
invoked by
[`run-accept.ts`](../../.Workflow/agent-workflows/shape/run-accept.ts) (the accept run). Every
model call goes through
[`shared/stage.ts`](../../.Workflow/agent-workflows/shared/stage.ts) — except the accept run,
which spends no model at all; it is pure TypeScript shelling out to `git` and `bin/new-adr`.

Payload contents below are a worked example built to the real shapes and rules. The example run:
**issue #412**, filed with the `idea` label, carrying the owner's own words about a dead nightly
canary. Sweep, shaper and refuter turn it into a decision sheet recommending that the canary's own
run report its own outcome in its own step summary. The owner applies `approved`; the accept files
that ruling as an ADR, coins a term, pushes both to `main`, and dispatches lane 02 — which is where
[`spec-lane-edges.md`](spec-lane-edges.md) picks the story up, at **issue #412, an accepted idea
carrying a decision sheet, labelled `to-spec`**. Where #412 comes from — the idea being filed in
the first place — is [`intake-lane-edges.md`](intake-lane-edges.md)'s own story, lane 00.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript or
shell · **[stop]** can refuse and end the run.

---

## Part one — the shape run (`shape.yml`)

## Node 00 — the two doors · [stop]

`shape.yml` `jobs.shape.if`

Two events reach the same job, and they mean two different things: a fresh idea starting cold, and
the owner reacting to a sheet that already exists.

| | |
|---|---|
| **Door 1 — the label** | `github.event_name == 'issues' && github.event.label.name == 'idea' && github.event.sender.login == github.repository_owner` |
| **Door 2 — the comment** | `github.event_name == 'issue_comment' && !github.event.issue.pull_request && contains(github.event.issue.labels.*.name, 'idea') && github.event.comment.user.type != 'Bot' && contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)` |
| **Why door 2 is looser** | Door 1 checks the *event's sender* against the owner login, exactly; door 2 checks GitHub's own `author_association`, which admits `MEMBER` and `COLLABORATOR` too. Both are named explicitly by [ADR-0073](../adr/0073-a-lane-that-spends-model-fires-only-for-the-owner-because-a.md) as the two triggers this lane guards, because the repo is public and a stranger's label or comment would otherwise spend the owner's own Opus/Haiku/Sonnet budget. |
| **Why `!issue.pull_request`** | A pull request is also an "issue" to GitHub's comment API; this excludes PR review chatter from ever reaching a shape run. |
| **Concurrency** | `shape-${{ github.event.issue.number }}`, `cancel-in-progress: false` — a lane that spends a model queues behind itself rather than throwing away a paid call ([ADR-0111](../adr/0111-a-lane-that-spends-a-model-queues-behind-itself-rather-than.md)). |
| **Re-run gesture** | Not a relabel. A comment on the issue is door 2's own trigger, and it is how a refused idea, a needs-live-session hold, or an already-posted sheet gets a second pass — see node 03 and the "Two things worth knowing" below. |

### edge — `env` · what the job hands the TypeScript

```
IDEA_NUMBER=412
CHANGE_REQUEST=                 # the literal comment body on door 2; empty on door 1
```

Before any TypeScript runs, the job also: exports a checkpoints restore/upload pair keyed
`checkpoints-shape-412`, checks out the machine and the target side by side, runs `gh label create`
for all seven of this lane's own labels (`shape-refused`, `needs-human`, `approved`, `parked`,
`killed`, `go-long`, `go-short` — each with the `--force` flag, so a label already carrying a
different description is silently rewritten), **refuses if `CLAUDE_CODE_OAUTH_TOKEN` is empty**
(before Node is installed), pins `@anthropic-ai/claude-code@2.1.241`, and puts a `running` label on
the idea.

---

## Node 01 — `roundFor` and the change-request cap · [wire] [stop]

`rounds.ts`

One tracker read, no model: `issueComments()` pulls every comment body on the issue and classifies
each as a posted sheet (has a `decision-sheet:v1` trailer), a refusal (carries
`REFUSAL_MARKER`), or neither.

| | |
|---|---|
| **`spoken`** | The count of sheets plus refusals — how many times this lane has already answered on this issue |
| **`round`** | Set to `spoken`, and it is what lands in the sheet's own trailer; it never appears in the rendered Markdown itself |
| **`refusalApplies`** | `spoken === 0` — the stage-1 refusal (node 03) only fires on the *first* pass. A change-request re-run never gets refused before the shaper runs a second time, even if the sweep would find the same prior art |
| **`capped`** | `spoken > CHANGE_REQUEST_CAP` (2) — the third and every further comment on this issue is refused for free |
| **`accepted`** | `bodies.some(isAccepted)` — read again later, by the accept run's own idempotency guard (node 11) |

### edge — the capped comment · posted, no marker, no model spent

```
**Change requests are spent.** 2 re-runs is the cap, so the sheet above stands as posted.

`approved`, `parked` or `killed` are what remain.
```

This comment carries neither `REFUSAL_MARKER` nor a sheet trailer, so it does not itself add to
`spoken` on the next comment — the count stays fixed at whatever produced the cap, and every
further comment is capped identically rather than the threshold drifting.

---

## Node 02 — the sweep · [model 1 of 3]

`shape/sweep/prompt.md` · `runSweep()` in `shape.ts`

Reads the idea (`gh issue view --json title,body`, formatted as `**title**\n\nbody`) and searches
for anything already on the record that bears on it. Scope: this repo's checkout and its issues.
No web.

| | |
|---|---|
| **Model** | `claude-haiku-4-5-20251001` |
| **Denied tools** | `WebFetch`, `WebSearch`, `Task`, `Edit`, `Write`, `NotebookEdit` — keeps `Read`, `Grep`, `Glob`, `Bash` |
| **Job 1 — prior art** | `gh issue list --state all --search …` (skipping the idea's own number, which always matches its own title) plus `docs/adr/INDEX.md`. Every hit gets a `verdict`: `duplicate` (an issue, cites `#<n>`), `ruled` (a `constraint`-status ADR, cites `ADR-NNNN`), or `related` (worth the owner's eye, refuses nothing). **Only `status: constraint` binds** — a `superseded` ADR's filename still reads as a live ruling, and `INDEX.md`'s status column is the only way to tell |
| **Job 2 — the shaper's reading list** | The next stage runs with **zero tools**, so anything it needs to decide has to be listed here by path or issue number, with a `because`. The runner injects each ref in full; an unreadable one becomes a line saying it was dropped rather than silently vanishing |
| **`FOCUS`** | On a change-request re-run, `firstPassFocus()` prepends the owner's comment as an explicit sweep target: "if he is pointing at something the last pass missed, finding it is this pass's job." Empty on a cold start |

### edge — `Sweep` · schema-validated JSON

```json
{"priorArt":[],
 "readingList":[
   {"ref":".github/workflows/nightly.yml", "because":"the workflow whose own run would carry the summary"},
   {"ref":"docs/adr/0016-observations-live-in-git-notes-on-their-own-ref-keyed-to-the.md",
    "because":"a ruling about where run-produced records already live, which any answer to \"where does the summary go\" has to sit beside"}
 ]}
```

Empty `priorArt` is a real answer, not a gap: nothing on the tracker or in `docs/adr/` already
answers this, so the chain proceeds.

---

## Node 03 — the stage-1 refusal · [wire] [stop]

`refusal.ts`, gated by `round.refusalApplies`

Only reachable on the first pass. `refusalFor()` scans the sweep's own `priorArt` for a `duplicate`
(issue-shaped ref) or `ruled` (ADR-shaped ref) entry that doesn't cite the idea's own number.

| | |
|---|---|
| **Fires on** | The first `duplicate` or `ruled` hit found, in sweep order |
| **Does not fire on** | `related` hits, or any hit citing the idea's own issue number |
| **Cost** | The shaper is never spent — this is the cheapest stop after node 00 that has already paid for one model call |
| **Cleared by** | A comment on the issue (door 2), which reaches this node again with `refusalApplies` now `false` — the sweep runs again, but nothing can refuse the chain a second time on the same evidence |

### edge — the refusal comment · posted, with `REFUSAL_MARKER`

```
**Refused before shaping.** An ADR has already ruled on this: ADR-0016

Observations live in git notes on their own ref, keyed to the commit that produced them —
not a second surface a run writes to directly.

The shaper was not spent. If this is genuinely a different idea, say so in a comment and the
chain re-runs without this refusal.

<!-- shape-refused:v1 -->
```

(#412 does not take this path — its sweep found no `duplicate` or `ruled` verdict — but this is
the shape a refusal for it would have taken had ADR-0016 already settled the question outright,
rather than merely bearing on it.) The issue is also labelled `shape-refused`.

---

## Node 04 — the shaper · [model 2 of 3]

`shape/shaper/prompt.md` · `runShaper()` in `shape.ts`

**No tools at all** ([ADR-0030](../adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md)).
Everything it may know is in the prompt: the idea verbatim, `CONTEXT.md`, `CODING_STANDARDS.md`
(both fetched live off the target checkout, not a lane-owned copy — see *Loose ends*), the sweep's
reading list rendered in full, and its prior-art verdicts. Its output is read by the owner on a
phone in about two minutes.

| | |
|---|---|
| **Model** | `claude-opus-5` |
| **Denied tools** | `Read`, `Grep`, `Glob`, `Bash`, `BashOutput`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Task`, `TodoWrite` — enforced by the CLI flag, not the prompt |
| **Produces** | A restatement (≤1 paragraph, work not summary); up to five decisions, each a question, a recommended answer, and a rejected alternative — "you are deciding, not surveying" |
| **Assumption mark** | Names **the thing that moves** if the answer flips: another decision on the sheet, or an existing artifact — an ADR, a shipped lane's contract, a file. A mark naming nothing is stripped mechanically at node 07 |
| **ADR title + reversal** | Only on a decision that already carries a mark, and only where `docs/adr/README.md`'s three-part bar is met: hard to reverse, surprising, a real alternative weighed. `adrTitle` is the ruling stated as a sentence; `adrReversal` is what undoing it would cost, one sentence — not the mark restated |
| **New terms** | A word `CONTEXT.md` lacks, drafted here (term, definition, avoid-list, one of the file's four sections), filed only at accept |
| **The one re-sweep** | If the shaper's context is missing something load-bearing, it returns `{"kind":"re-sweep", needs, why}` instead of a sheet. `shape.ts` re-runs the sweep once, focused on exactly that gap, merges the two reading lists (deduped by `ref`), and re-runs the shaper telling it this is its last pass. **A second `{"kind":"re-sweep"}` throws** — ADR-0030's toolless bargain caps this at one, and a shaper that asks twice is a bug, not a retry |

### edge — `ShaperOutput` · discriminated on `kind`

```json
{"kind":"sheet",
 "restatement":"Make the nightly canary's own run report whether it worked, in a step summary on that run, so a missed or broken night is visible without opening the Actions tab.",
 "priorArt":[],
 "decisions":[
   {"question":"Where does the summary go?",
    "recommendation":"The run's own GitHub step summary. No new surface.",
    "rejected":"a comment on a tracker issue; a Slack post",
    "mark":"ADR-0016's git-notes-based observation record",
    "adrTitle":"A lane reports its own outcome in the run that produced it",
    "adrReversal":"Reversing it means moving the canary's outcome back out of the step summary into a comment or a separate observation record, undoing the one-run-one-place convention every later lane that reads it would otherwise have to special-case."},
   {"question":"How many consecutive missed nightly runs should make the watchdog loud?",
    "recommendation":"Three consecutive misses — matching run-watchdog.ts's existing parked-issue threshold, so a new number is not invented for a use nobody has needed it for yet.",
    "rejected":"alerting after the first miss, which would be loud every time the runner is merely flaky",
    "mark":"run-watchdog.ts's own threshold constant",
    "adrTitle":"",
    "adrReversal":""}
 ],
 "route":"long",
 "routeReason":"Long: the summary format is a new convention other runs will follow, worth a spec and a slice rather than a single-file patch.",
 "newTerms":[{"term":"canary summary","definition":"The nightly canary run's own GitHub step summary, written via $GITHUB_STEP_SUMMARY, naming its own outcome without a second surface.","avoid":["alert","notification","digest"],"section":"Mechanisms"}]}
```

Decision 2 carries a mark but no title — its bar is not met, so nothing is filed for it at accept
(node 11), and it is exactly the kind of gap [`spec-lane-edges.md`](spec-lane-edges.md)'s
`unfiledMarks()` later resurfaces as an open question on the spec that PRD #419 becomes.

---

## Node 05 — the decision cap · [wire] [stop]

`sheet.ts`, `capDecisions()`

Checked once, after any re-sweep has resolved to a real sheet, before the refuter is ever spent.

| | |
|---|---|
| **Fires when** | `decisions.length > 5` |
| **Not a failure** | A tree that needs a sixth decision to close is the shaper reporting a true fact about the idea, not a shaper that failed |
| **Cost** | Two of three models spent (sweep, shaper); the refuter never runs |

### edge — the needs-live-session comment · posted, `needs-human` applied

```
**This needs a live session.** The decision tree did not close under 5 decisions; the shaper found 7.

That is not a verdict on the idea. It is the shaper saying it cannot state this as work without
asking you things a sheet cannot ask.

Grill it at the desk, then re-file what comes out of that as an idea the tree can close on.
Nothing was posted, and the shaper was not asked to compress 7 decisions into 5 to fit.
```

This is the same `needs-human` label [`pipeline-labels.md`](pipeline-labels.md) documents for a
different situation entirely — see *Loose ends*.

---

## Node 06 — the refuter · [model 3 of 3]

`shape/refuter/prompt.md` · `runRefuter()` in `shape.ts`

Reads the decisions and the restatement cold, and is asked to kill them, not grade them: "assume
each recommendation is wrong and try to show it. Silence is your good outcome."

| | |
|---|---|
| **Model** | `claude-sonnet-5` |
| **Sees** | `DECISIONS` (the shaper's raw array, as JSON) and `RESTATEMENT` — nothing else; no idea, no reading list, no prior art |
| **A survivor names** | Something specific and checkable: a ruling or standard the sheet misquotes, a fact the restatement gets wrong, a rejected alternative rejected for a reason that doesn't hold, or a recommendation that cannot be built as stated |
| **Not a survivor** | That a decision is hard; that more information would help; that the alternative has merits too — those cost the owner screen space and are dropped |
| **Cap** | At most three, one line each. Empty is fine and is the design's stated success case |
| **On probation** | See node 08 — a stage retired on a count, not a convening ([ADR-0031](../adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md)) |

### edge — `Refutations` · `survivors[]`

```json
{"survivors":["Decision 2 borrows run-watchdog.ts's threshold for a different failure mode — a parked issue and a silent nightly run are not the same kind of miss, and the sheet gives no reason the same count should govern both."]}
```

---

## Node 07 — `applyGrammar` and the posted sheet · [wire]

`sheet.ts` → `render-sheet.ts`

Assembles the sheet the code, not the shaper, is responsible for.

| | |
|---|---|
| **Trims** | `mark`, `adrTitle`, `adrReversal` on every decision |
| **Caps** | `priorArt` to 3, `survivors` to 3 |
| **Forces long** | `marksForceLong()` — if more than half the decisions carry a mark, `route` becomes `long` regardless of what the shaper recommended, and `routeReason` is overwritten to say so mechanically. Triggered here: both of #412's decisions carry a mark, so the shaper's own `routeReason` ("the summary format is a new convention…") never reaches the page — the mechanical one below replaces it, even though the shaper's own route recommendation (`long`) already agreed |
| **Round** | Stamped from node 01's `roundFor`, into the trailer only — never into the visible Markdown |

### edge — the posted comment · rendered Markdown plus a hidden trailer

```
## Restatement

Make the nightly canary's own run report whether it worked, in a step summary on that run, so a
missed or broken night is visible without opening the Actions tab.

## Prior art

`none found`

## Decisions

**1. Where does the summary go?**
  The run's own GitHub step summary. No new surface.
  *Rejected:* a comment on a tracker issue; a Slack post
  **Moves if this flips:** ADR-0016's git-notes-based observation record

**2. How many consecutive missed nightly runs should make the watchdog loud?**
  Three consecutive misses — matching run-watchdog.ts's existing parked-issue threshold…
  *Rejected:* alerting after the first miss, which would be loud every time the runner is merely flaky
  **Moves if this flips:** run-watchdog.ts's own threshold constant

## Surviving refutations

- Decision 2 borrows run-watchdog.ts's threshold for a different failure mode — a parked issue
  and a silent nightly run are not the same kind of miss, and the sheet gives no reason the same
  count should govern both.

## Route

Long: 2 of 2 decisions carry an assumption mark, which is more than half.

<!-- decision-sheet:v1 {"restatement":"…","priorArt":[],"decisions":[…],"survivors":[…],"route":"long","routeReason":"Long: 2 of 2 decisions carry an assumption mark, which is more than half.","newTerms":[…],"round":0} -->
```

Everything downstream — the accept run, and later the spec lane's own sheet collector — reads the
trailer's JSON, never this rendered prose.

---

## Node 08 — the probation check · [wire]

`probation.ts`, `checkProbation()`

Runs unconditionally after every posted sheet, cold start or change-request re-run alike.

| | |
|---|---|
| **Counts** | Every sheet, across every issue, whose trailer has zero survivors — `countSilentSheets()` searches `decision-sheet:v1` across up to 100 issues and re-reads each one's comments |
| **This run's own sheet** | Does not count toward the tally: #412's sheet carries one survivor |
| **At 20 silent sheets** | Files an issue proposing the refuter's own deletion, citing [ADR-0031](../adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) — a probation held to an event that may never happen (an owner "kill this stage" convening) is retired on a count instead |
| **Already proposed** | `highestProposedAt()` reads the standing proposal's own marker (`<!-- refuter-probation:v1 silent=N -->`); a count no higher than what was already proposed does not re-propose |
| **Never deletes** | Only ever files an issue — [ADR-0064](../adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md): a counter names an event, a count, an issue, and an action; it does not perform the action |

---

## Part two — the accept run (`shape-accept.yml`)

## Node 09 — the accept door · [stop]

`shape-accept.yml` `jobs.accept.if`

```
(github.event.label.name == 'approved' ||
 github.event.label.name == 'parked' ||
 github.event.label.name == 'killed') &&
github.event.sender.login == github.repository_owner
```

| | |
|---|---|
| **Owner only** | The same sender gate as node 00's label door: only the repository owner's label starts the run, because this is the one place in the lane that pushes to `main` and files ADRs unattended (#480) |
| **Concurrency** | `shape-accept-${{ github.event.issue.number }}`, `cancel-in-progress: false` — this run writes to `main`, which alone earns it a concurrency group under [ADR-0111](../adr/0111-a-lane-that-spends-a-model-queues-behind-itself-rather-than.md) even though it spends no model |
| **Permissions** | `contents: write`, `issues: write` — the whole job, throughout; there is no split between a model-spending job and a write-capable one the way lane 02 splits `spec`/`dispatch`, because this job spends no model to protect a token from |
| **Checkout** | Machine and target side by side, plus a committer configured on the target as `github-actions[bot]` |

### edge — `env`

```
IDEA_NUMBER=412
VERB=approved
```

---

## Node 10 — the verb split · [wire] [stop]

`accept.ts`, `accept()`

| Verb | Does |
|---|---|
| `parked` | `dropIdea()` — removes the `idea` label. Nothing else: no comment, no ADR, no dispatch. The `parked` label itself is never removed, and its own seeded description says why: "Shaped and set down. No dispatch, and nothing ever re-raises it" |
| `killed` | `dropIdea()`, then `gh issue close --reason "not planned"` — deliberately **not** `"completed"`, which is what lane 04's own delivery check reads, so a killed idea is never mistaken for shipped work |
| `approved` | Falls through to node 11 |

Both `parked` and `killed` seed their own prior art: the sweep prompt names a closed `killed` or
`parked` idea as "the strongest prior art there is."

---

## Node 11 — `approve`: route, file, coin, land · [wire]

`accept.ts`, `approve()`

| | |
|---|---|
| **Idempotency guard** | `roundFor().accepted` — if any comment already carries `ACCEPTED_MARKER`, returns `{kind: "already-accepted"}` immediately. Re-applying `approved` a second time files nothing twice |
| **No sheet to read** | Comments a refusal ("Approved, but there is no sheet on this issue…remove and re-add `idea` to shape it first") and returns `{kind: "no-sheet"}` |
| **Route override** | `routeFor()` reads the issue's own labels: `go-long` or `go-short` — [ADR-0007](../adr/0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md)'s one-word override — beats the sheet's own `route`. If both are somehow present, `long` survives |
| **`fileAdrs()`** | For every decision carrying **all three** of `adrTitle`, `mark`, and `adrReversal` non-empty: `bin/new-adr <title>` drafts a numberless file, `withReversal()` writes the reversal sentence into its frontmatter (never the body), the decision's recommendation and rejected alternative and the assumption mark are appended as the body, citing [ADR-0005](../adr/0005-accepting-a-shaped-idea-is-what-files-its-adrs.md) and [ADR-0028](../adr/0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md), then `bin/new-adr --land` claims the next number against a freshly fetched `origin/main`. Decision 2 (mark, no title) files nothing |
| **`coinTerms()`** | For each of the sheet's `newTerms` not already present in `CONTEXT.md` (a literal `**term**:` check), `insertTerm()` splices the entry under the matching `### <section>` heading. A term whose section heading is gone is silently skipped |

### edge — the filed ADR · `docs/adr/0107-a-lane-reports-its-own-outcome-in-the-run-that-produ.md`

```
---
status: constraint
date: 2026-09-05
reversal: Reversing it means moving the canary's outcome back out of the step summary into a
  comment or a separate observation record, undoing the one-run-one-place convention every later
  lane that reads it would otherwise have to special-case.
---

# A lane reports its own outcome in the run that produced it

The run's own GitHub step summary. No new surface.

Decided on the decision sheet for #412, and filed by the `approved` label on it
(ADR-0005).

## Considered options

- a comment on a tracker issue; a Slack post

## Consequences

**ADR-0016's git-notes-based observation record** moves if this answer flips, and that pointer
is the assumption mark the sheet carried, and it is why this decision was written down rather
than left on the sheet (ADR-0028).
```

### edge — `CONTEXT.md`, one term inserted under `### Mechanisms`

```
**canary summary**:
The nightly canary run's own GitHub step summary, written via $GITHUB_STEP_SUMMARY, naming its
own outcome without a second surface.
_Avoid_: alert, notification, digest
```

`CONTEXT.md` already defines **canary** to mean something else entirely — an enrolled repository
that proves a machine change on real GitHub before it lands. The sweep at node 02 could not have
known that; the shaper, reading `CONTEXT.md` directly rather than through a lane-owned copy (see
*Loose ends*), did.

### edge — `git` · the commit, straight to `main`

```
git add docs/adr/0107-a-lane-reports-its-own-outcome-in-the-run-that-produ.md CONTEXT.md
git commit -m "docs: land the rulings and vocabulary #412's sheet decided, before a spec can re-decide them

The accept is the signature (ADR-0006), and ADR-0005 files at accept precisely so lane 02
cites these rather than restating them. Written from the decision sheet on #412."
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

No commit at all is written when a sheet decided nothing worth filing — `git` is never invoked.

---

## Node 12 — the comment, the swap, and the dispatch · [wire]

`accept.ts`, tail of `approve()`

Four acts, in this order, and the order is load-bearing
([ADR-0083](../adr/0083-the-accept-dispatches-lane-02-rather-than-lane-02-firing-on.md)): the push
already happened at node 11, **before any of this**.

| Order | Act |
|---|---|
| 1 | `dropIdea()` — removes `idea` |
| 2 | Posts the accept comment, carrying `ACCEPTED_MARKER`'s JSON payload |
| 3 | `handOffToSpec()` — adds `to-spec`, removes `approved` |
| 4 | `dispatchSpecAuthor()` — `repository_dispatch`, `sheet-accepted` |

### edge — the accept comment

```
## Accepted

**Filed:**
- `docs/adr/0107-a-lane-reports-its-own-outcome-in-the-run-that-produ.md`

**Coined:** `canary summary`

**Route:** `long`

<!-- shape-accepted:v1 {"adrPaths":["docs/adr/0107-a-lane-reports-its-own-outcome-in-the-run-that-produ.md"],"coinedTerms":["canary summary"],"route":"long"} -->

**Dispatched to lane 02.** This click filed what the sheet decided, so the spec cites the rulings
rather than re-deciding them, and then started the spec author on them. The spec arrives as its
own `PRD:` issue, carrying numbered open questions if it had to guess at anything, and nothing
further from you if it did not.
```

If the sheet's `route` and `routeFor()`'s resolved route differ, the comment says so explicitly:
`"**Route:** \`long\` (overriding the sheet's \`short\`)"`.

### edge — `repository_dispatch` · lane 02 wakes

```
gh api repos/{owner}/{repo}/dispatches \
  -f event_type=sheet-accepted \
  -f 'client_payload[issue]=412'
```

Sent directly via `gh`, not through a `RUNNER_TEMP` file for a second job to relay — this single
job holds `contents: write, issues: write` throughout, so there's no separate model-spending job
whose token needs protecting from write access (the same reasoning lane 04's recompute uses for
its own direct dispatch). This is also the trigger [`spec-lane-edges.md`](spec-lane-edges.md)'s own
node 00 calls "the third door" — lane 02 does not fire on the `approved` label at all.

---

## What each stage may touch

| Stage | Model | Reads | Writes | Can act on the tracker |
|---|---|---|---|---|
| sweep | haiku-4-5 | Read Grep Glob Bash (repo + `gh issue`/`gh search`) | — | — |
| shaper | opus-5 | nothing — prompt-only | — | — |
| refuter | sonnet-5 | nothing — prompt-only | — | — |
| `approve` (node 11) | — | Issue comments, labels, `CONTEXT.md` | ADR files, `CONTEXT.md`, pushes to `main` | Comments, labels |

The shaper and refuter are the two stages in this repository's pipeline with **no toolbelt at
all** — not even `Read`. Every other lane's model stage keeps at least a search allow-list.

---

## Where it stops

Ordered by how much has been spent when it fires.

| Cost | Where | Fires when |
|---|---|---|
| free | `shape.yml` `if:` | Neither door's condition holds |
| free | preflight | `CLAUDE_CODE_OAUTH_TOKEN` is empty — checked before Node is installed |
| free | `roundFor()` | More than 2 change-request comments already answered on this issue |
| free | `refusalFor()` | The sweep's own prior-art search finds a `duplicate` issue or a `ruled` constraint ADR, and this is the first pass |
| 1 model call | `capDecisions()` | The shaper's tree does not close under 5 decisions |
| 1 model call | structured output | A stage's JSON fails its schema; the raw response is saved to `<handoff dir>/<stage>-raw-response.txt` |
| 2 model calls | the re-sweep cap | The shaper asks for a second re-sweep — thrown, not refused gracefully |
| 30 min | shape run timeout | The job is cancelled |
| free | `shape-accept.yml` `if:` | The label is not one of `approved`, `parked`, `killed`, or someone other than the owner applied it |
| free | `roundFor().accepted` | The issue already carries `ACCEPTED_MARKER` — a second `approved` is a no-op |
| free | no sheet | `approved` applied to an issue with no posted sheet to read |
| 10 min | accept run timeout | The job is cancelled |

Any shape-run failure posts to #412 itself (`FAILURE_REASON_PATH`'s contents, plus the checkpoints
artifact name as evidence), and the running label always comes off. An accept-run failure posts a
narrower comment — see *Two things worth knowing*.

---

## Two things worth knowing

**The comment door is a re-run gesture, not just a trigger.** Door 2 does three different jobs
depending on what's already on the issue: it delivers a change request against a posted sheet
(`renderChangeRequest()`, capped at 2 per issue), it is what re-runs the chain past a stage-1
refusal that no longer applies (`refusalApplies` is false once anything has been said), and it is
the only way past a `needs-live-session` hold. All three read as the identical event at node 00;
`roundFor()` at node 01 is what tells them apart, entirely from what the comment thread already
contains.

**The accept's write happens before its receipt.** `approve()` pushes ADRs and `CONTEXT.md` to
`main` (node 11) *before* it posts the comment that proves it did (node 12), and posts that comment
*before* it dispatches lane 02. This ordering is deliberate — ADR-0083 exists precisely because
lane 02's collector cannot proceed without the accept payload the comment carries, so the dispatch
has to be last. But it also means a run that dies between the push and the comment leaves `main`
holding a ruling with no marker anywhere on the issue saying so. Nothing computes an answer for
this: `shape-accept.yml`'s own failure comment just says to go look — "check whether `docs/adr/`
and `CONTEXT.md` took the writes before re-applying the label" — and a naive re-apply would draft
and land the same ruling under a second ADR number, since `fileAdrs()` has no memory of a prior,
half-finished attempt.

---

## Loose ends in the tree

- **`needs-human` means two different things.** [`pipeline-labels.md`](pipeline-labels.md)
  documents it as "an agent tried and stopped: a criterion still unmet after one fix pass, or the
  merge gate rejected the same merge twice." `shape.ts`'s `NEEDS_LIVE_SESSION_LABEL` applies the
  identical string for a decision tree that would not close under five decisions — nothing about a
  fix pass or a merge gate. Same label, two unrelated documented meanings.
- **`ADR-0030`'s `superseded_by: ADR-0098` reads as a reversal it is not.** `shape.ts`'s
  `SHAPER_DENIED_TOOLS` still fully enforces ADR-0030's zero-toolbelt rule for this lane's shaper.
  ADR-0098 is about lane 04's acceptance author being handed inlined files instead of a read tool —
  a different lane, entirely. Following the corpus's own supersession pointer from ADR-0030 without
  reading ADR-0098's body suggests lane 01's shaper gained tools; it did not.
- **[ADR-0082](../adr/0082-a-lane-carries-the-vocabulary-it-works-in-rather-than-readin.md)'s
  "a lane carries the vocabulary it works in rather than reading the repo's" is written specifically
  about to-tickets' own `vocabulary.md` copy.** This lane does the opposite: `runShaper()` fetches
  `CONTEXT.md` and `CODING_STANDARDS.md` live off the target checkout via `fetchRef()`, with no
  lane-owned copy of either.
- `shape.yml`'s "Ensure the lane's labels exist" step creates seven labels
  (`shape-refused`, `needs-human`, `approved`, `parked`, `killed`, `go-long`, `go-short`) but not
  `running`, which `./.github/actions/running-label` applies and removes without ever creating it.
