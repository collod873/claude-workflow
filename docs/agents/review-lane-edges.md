# The review lane, edge by edge

Lane 07, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

The machine is two reusable workflows, not one: [`.github/workflows/review.yml`](../../.github/workflows/review.yml)
(enrolled repositories carry only a caller stub, [`review-caller.yml`](../../.github/workflows/review-caller.yml))
and [`.github/workflows/fixer.yml`](../../.github/workflows/fixer.yml) (stub:
[`fixer-caller.yml`](../../.github/workflows/fixer-caller.yml)). There is no single state machine the
way lane 02 has `spec.ts`: the review half is orchestrated by
[`.Workflow/agent-workflows/review/review.ts`](../../.Workflow/agent-workflows/review/review.ts),
which calls out to four small modules of its own (`structural-refusal.ts`, `refuter.ts`,
`counter.ts`, `publish-findings.ts`); the fixer half is one self-contained file,
[`.Workflow/agent-workflows/fixer/fixer.ts`](../../.Workflow/agent-workflows/fixer/fixer.ts). Every
model call in both still goes through
[`shared/stage.ts`](../../.Workflow/agent-workflows/shared/stage.ts), checkpoints included.

What is structurally unusual here, twice over. First: unlike lane 08's `integrate.ts`, which races
lane 06 by waking on the *same* `implementation-opened` dispatch verify-lane-edges.md's node 00
describes, both halves of this lane wake only once lane 06's entire run has *finished* —
`workflow_run: [Verify], types: [completed]` — and split on which way its conclusion went. Second:
the fixer has the same "two doors" shape lane 06's own dispatch does, for a different reason: it
answers both the `workflow_run` completion directly *and* the `fixer-needed` `repository_dispatch`
that `verify.yml`'s `signal-fixer` job sends on that same run (documented in
[`verify-lane-edges.md`](verify-lane-edges.md#node-03-the-signal-fixer-job-wire)) — two wakes
naming the identical run id, deduplicated by a marker comment rather than by picking one door to
listen at.

Payload contents below are a worked example built to the real shapes and rules, continuing
[`verify-lane-edges.md`](verify-lane-edges.md)'s own thread: **PR #501** on branch
`implement/issue-421`, implementing **ticket #421** (sliced from **PRD #419**), changing
`scripts/canary-summary.ts` and `scripts/canary-summary.test.ts`. This document shows both ways
lane 06's verdict on that commit can go: nodes 00–07 follow the run where `Verify` passed and
review reads the diff; nodes 08–12 follow the run where it failed on the exact test
verify-lane-edges.md's own worked example names —
`scripts/canary-summary.test.ts > writes a job summary that quotes the run's own conclusion` — and
the fixer takes over. The clean path lets [`integrate-lane-edges.md`](integrate-lane-edges.md)
(lane 08, a sibling document) merge; the red path either lands green under the fixer's own repair
or stops at `needs-human` for a human to pick up where lane 08 would have.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript or
shell · **[stop]** can refuse and end the run.

---

## Node 00 — review's door · [stop]

`review-caller.yml` `on:` / `review.yml` `jobs.review`

Woken by lane 06's own completion, not by the dispatch that started it.

| | |
|---|---|
| **Fires on** | `workflow_run: [Verify], types: [completed]` |
| **Passes when** | `github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event != 'push'` |
| **Why `event != 'push'`** | Door 1 of lane 06 is trunk judging itself — no pull request, nothing for this lane to read either. The exclusion is identical to the one on the fixer's own door (node 08) |
| **Hands off** | `head_sha: ${{ github.event.workflow_run.head_sha }}` — the one fact this lane inherits from lane 06's run, rather than reading `client_payload` itself |
| **Concurrency** | `review-${{ inputs.head_sha }}`, `cancel-in-progress: false` |
| **Permissions** | `contents: read`, `issues: write` — this lane never writes to the repository or the pull request, only to issues |

### edge — `workflow_run` completed · the one field this lane reads

```json
{"workflow_run": {"conclusion": "success", "event": "repository_dispatch",
  "head_sha": "9f2e7a1c4b8d3f0a5e6c7b8d9a0f1e2d3c4b5a6f"}}
```

---

## Node 01 — the diff · [wire]

`review.yml` `jobs.review` steps · `review/review.ts` `main`

Checkout, preflight, install, then one invocation. No `pull-requests` API call happens here at
all — the diff comes from two commits, not from asking GitHub what changed.

| | |
|---|---|
| **Checks out** | The machine (`collod873/claude-workflow@main`) at the workspace root, and the target at `ref: inputs.head_sha`, `fetch-depth: 0`, under `target/` |
| **Refuses** | `CLAUDE_CODE_OAUTH_TOKEN` empty, before Node is installed — same preflight every model-spending job runs |
| **Runs** | `npx tsx .Workflow/agent-workflows/review/review.ts "origin/main" "${{ inputs.head_sha }}"` |
| **The diff** | `execGit(["diff", "origin/main...HEAD_SHA"])` — three-dot, so what shows is what `HEAD_SHA` carries since it diverged from `origin/main` |
| **What `HEAD_SHA` is, precisely** | Whatever `github.event.workflow_run.head_sha` named on lane 06's own run — see *Loose ends* for what that is worth, given how that run itself woke |

### edge — the diff · raw `git diff` text

```diff
diff --git a/scripts/canary-summary.ts b/scripts/canary-summary.ts
index 3a1c9de..7b02f41 100644
--- a/scripts/canary-summary.ts
+++ b/scripts/canary-summary.ts
@@ -10,6 +10,17 @@ export function readLastRun(): NightlyRun {
   return JSON.parse(readFileSync(RUN_CACHE_PATH, "utf8"));
 }

+export function summariseRun(conclusion: string): string {
+  const line = conclusion === "success" ? "passed" : "did not pass";
+  return `Last nightly run ${line} (${conclusion}).`;
+}
+
+export function writeStepSummary(run: NightlyRun): void {
+  appendFileSync(process.env.GITHUB_STEP_SUMMARY!, `${summariseRun(run.conclusion)}\n`);
+}
```

Everything downstream in the review half — both reviewers, the refuter — reads this string and
nothing else off the target's tree; there is no second checkout, no `gh pr diff`, no file list.

---

## Node 02 — correctness reviewer · [model]

`review/correctness-reviewer/prompt.md` · `review/review.ts` `runCorrectnessReview`

Reads one diff, hunts defects, nothing else.

| | |
|---|---|
| **Model** | `claude-opus-5` |
| **Tools** | unrestricted — `runCorrectnessReview` passes neither `allowedTools` nor `disallowedTools` to `runStage`. It does not need any: the diff arrives inline in the prompt, so there is nothing to read that isn't already there |
| **Sees** | `{{DIFF}}` only |
| **Hunts** | A defect the diff introduces that lint, typecheck, the suite, and the ticket's own acceptance tests — already green before this reviewer ever runs — did not exercise |
| **Refuses to write** | A restatement of a rule a green gate already covers; a style preference; anything about whether the diff matches its ticket's *intent* (the conformance reviewer's question, not this one's) |
| **Mechanical filter** | A finding naming no `path:line` is refused before its reasoning is read — enforced downstream at node 05, not here |
| **Empty is legal** | Nothing found, `findings: []` |

### edge — `CorrectnessReviewerOutput` · schema-validated JSON

```json
{"findings":[
  {"message":"scripts/canary-summary.ts:17. `writeStepSummary` writes to `process.env.GITHUB_STEP_SUMMARY!` with a non-null assertion; run this outside Actions (a local `npm test`, or a future venue that shells out to it) and it throws instead of skipping, which the suite never exercises because vitest always runs inside a workflow step."}
]}
```

---

## Node 03 — resolving the ticket, for conformance · [wire]

`review/review.ts` `resolveSpec`

Only the conformance reviewer needs to know which ticket this diff answers to; the correctness
reviewer at node 02 never asked.

| | |
|---|---|
| **Finds the pull request** | `gh api repos/{owner}/{repo}/commits/HEAD_SHA/pulls` (`commitPullsPath`), matched to the one whose `head.sha` equals `HEAD_SHA` exactly |
| **Names the ticket** | `implementationBranchTicket(branch)` — parses `implement/issue-421` back into `421`, the same pattern `shared/ready-set.ts` builds |
| **Reads the spec** | `parentPrdNumber(ticket.body)` — if the ticket names a `## Parent PRD`, that PRD's body is `specText`, `prdIssueNumber`; otherwise the ticket's own body stands in for both |
| **Refuses (caught)** | No pull request has that head commit; the branch isn't `implement/issue-*` shaped; the ticket read fails. None of these end the run — `reviewConformance` catches the throw, logs it, and returns `findings: []`. Correctness review still stands |
| **The concrete case this excludes** | A ratifier's pull request ([ADR-0122](../adr/0122-findings-land-through-the-implementation-door-the-release-pr.md)) opens on a branch of its own naming, not `implement/issue-N` — so `implementationBranchTicket` returns `undefined` and conformance review never runs against one. Only the correctness reviewer reads a ratifier's diff |

### edge — `ResolvedSpec` · in-process object

```ts
{ specText: "<PRD #419's body>", criteria: ["I'll know it works when I can open the last nightly run and read its own summary without clicking into a job - check: `gh run list --workflow=nightly.yml --json conclusion --jq '.[0].conclusion == \"success\"'`"],
  prdIssueNumber: 419, ticketNumber: 421 }
```

---

## Node 04 — the conformance reviewer's scope · [wire]

`review/review.ts` `untestedCriteria` → `shared/affected-tests.ts` `testsForCriterion`

Not every criterion is this reviewer's to re-decide — only the part no acceptance test already
encodes.

| | |
|---|---|
| **Per criterion** | `testsForCriterion(421, index+1)` greps every suite file for a title matching `` #421.<index>: `` — the acceptance lane's own authoring grammar (`shared/affected-tests.ts` `authoredCriterionTitleRe`), never the looser ticket-wide `` #421: `` form |
| **In scope** | Only a criterion with no matching test file — the residue no machine verdict already covers |
| **This ticket's own case** | Ticket #421 carries exactly one criterion, and lane 04's acceptance author titled its test to that grammar (`#421.1: writes a job summary that quotes the run's own conclusion`) before lane 05 ever ran. `testsForCriterion(421, 1)` finds it, so the one criterion this ticket has is **excluded** — `SCOPE` renders as the empty string |

### edge — `SCOPE` · the empty string

Passed to `{{SCOPE}}` unchanged — not the sentinel `"(none)"` other lanes render for an empty
section, just `""`. The conformance reviewer's own prompt still runs; it is simply told, correctly,
that nothing here is left for it to judge.

---

## Node 05 — conformance reviewer · [model]

`review/conformance-reviewer/prompt.md` · `review/review.ts` `runConformanceReview`

Reads the spec **before** the diff — "an anchored reading rationalises whatever the diff already
does instead of checking it" — then decides, for whatever node 04 left in scope, which side is
wrong when the two disagree.

| | |
|---|---|
| **Model** | `claude-opus-5` — the same constant, `CORRECTNESS_REVIEWER_MODEL`, node 02 uses; conformance never defines one of its own |
| **Tools** | unrestricted, same as node 02 |
| **Sees** | `{{SPEC}}`, `{{SCOPE}}`, `{{DIFF}}` |
| **`divergence`** | The spec is clear and the diff does something else — an ordinary finding, `path:line` required, refused mechanically without one |
| **`gap`** | The spec is silent, ambiguous, or self-contradicts, and no clear reading exists to diverge from — **not** a finding against this diff. Filed as `spec/gap` against the PRD instead (node 06) |
| **The rule** | Never both for the same observation. If the spec is clear, `divergence`; if it isn't, `gap` |
| **This run's case** | `SCOPE` is empty, so there is nothing in scope to classify either way: `items: []` |

### edge — `ConformanceReviewerOutput` · schema-validated JSON

```json
{"items": []}
```

The shape the prompt itself illustrates, for a run where `SCOPE` is not empty:

```json
{"items":[
  {"classification":"gap","message":"The spec never says what happens when the nightly run has no conclusion yet (still in progress) — the diff's own summary prints \"did not pass\" for that case, and nothing here says whether that's right."}
]}
```

### edge — `fileConformanceGap` · a `spec/gap` issue, when `classification` is `gap`

```
gh issue create --title "spec/gap: #419's spec is silent on part of this diff" \
  --body "Filed against #419 (ADR-0034).

Filed by lane 07's conformance reviewer (ADR-0038).

The spec never says what happens when the nightly run has no conclusion yet..." \
  --label spec/gap
```

This is the routing the task at hand called out: the diff is not wrong here — the contract is
silent — so nothing is filed against the pull request. `spec/gap` lands on the PRD and is read by
lane 02's own amendment path ([ADR-0034](../adr/0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md)),
never by whoever wrote this diff. See [`pipeline-labels.md`](pipeline-labels.md) and
[`issue-tracker.md`](issue-tracker.md) for the label itself.

---

## Node 06 — structural refusal · [wire]

`review/structural-refusal.ts` `isStructurallyRefused`

A free filter ahead of the refuter ([ADR-0036](../adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md)): a finding a green gate already covers, or one that
names no real place in the diff, never spends a Sonnet call to be told so.

| | |
|---|---|
| **Refuses when** | The finding cites no `path:line` that appears verbatim in the diff text (`citesLocationInDiff`); **or** its message includes one of `greenGateChecks` (`restatesAGreenCheck`) |
| **Applies to** | The pooled output of both reviewers — `candidates = [...correctness, ...conformance]` — `gap` items excluded, since those never reach this filter at all |
| **`greenGateChecks` in production** | `review.ts`'s own `main()` reads it from `process.argv.slice(4)`; `review.yml`'s invocation passes exactly two arguments (`origin/main`, the head sha) and no more. See *Loose ends* |

### edge — `Finding[]` · survivors passed to the refuter

```json
[{"message":"scripts/canary-summary.ts:17. `writeStepSummary` writes to `process.env.GITHUB_STEP_SUMMARY!` with a non-null assertion; ..."}]
```

---

## Node 07 — refuter, then publish, then count · [model] [stop] [wire]

`review/refuter.ts` `runRefuter` · `review/publish-findings.ts` · `review/counter.ts` `runCounter`

One model call per surviving candidate, then two wire steps that always run regardless of what
survived.

| | |
|---|---|
| **Model** | `claude-sonnet-5` — cheaper than the reviewers, since judging one already-filtered finding is a narrower question than reading the whole diff |
| **The question** | Not "is this good code" — "is this finding actually wrong" |
| **The bar** | A refusal must name the gate that already covers the finding, or a `path:line` by which it is unreachable (`refusalNamesReason` — checked the same two ways as node 06). A refusal naming neither does not count as one: the finding stands regardless of what else the model wrote ([ADR-0035](../adr/0035-lane-07-ships-with-one-refuter-and-a-refusal-that-names-no-r.md)) |
| **Serial, not parallel** | `runRefuter` loops `for (const finding of findings)`, one `claude` invocation per finding |
| **Publish** | Every survivor becomes its own issue: `gh issue create --label lane-07-finding --assignee <owner>`, title `` lane-07 finding: <first line, ≤80 chars> `` |
| **Count** | `runCounter` always runs after, in-process — its own CLI `main()` (reading `REFUTER_TALLY_REACHED`/`REFUTED` from the environment) has no caller; nothing invokes it that way |

### edge — `RefuterVerdict` · schema-validated JSON

```json
{"refuted": false, "reason": ""}
```

The shape a refusal takes, when one survives its own bar:

```json
{"refuted": true, "reason": "scripts/canary-summary.ts:17. This line runs only inside `writeStepSummary`, which the ticket's own acceptance test calls with `GITHUB_STEP_SUMMARY` already set in its fixture — the case the finding describes cannot occur on the path the diff added."}
```

### edge — `gh issue create` · the published finding

```
gh issue create \
  --title "lane-07 finding: scripts/canary-summary.ts:17. `writeStepSummary` writes to..." \
  --body  "scripts/canary-summary.ts:17. `writeStepSummary` writes to `process.env.GITHUB_STEP_SUMMARY!`..." \
  --label lane-07-finding \
  --assignee collod873
```

### edge — `CounterOutcome` · the common case

```ts
{ falseAlarmCount: 0, tally: { reached: 1, refuted: 0 },
  grow: { code: "below-threshold" }, delete: { code: "below-threshold" } }
```

`grow` fires only past **3** false alarms (a survivor closed `not planned`, or left untouched
5 days — `FALSE_ALARM_EXPIRY_DAYS`); `delete` fires only past **20** findings reached with **0**
ever refused ([ADR-0037](../adr/0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)).
Both write a proposal issue naming the fleet size, not a code change — "adding a refuter is a
prompt edit."

---

## Node 08 — the fixer's two doors, and the dedup · [stop]

`fixer-caller.yml` `on:` / `fixer.yml` `jobs.fixer.if`

The mirror image of node 00: wakes on lane 06's own run going the other way, from either of two
independent signals for the identical run.

| | |
|---|---|
| **Door 1** | `workflow_run: [Verify], types: [completed]`, passing when `conclusion` is `failure` or `cancelled` **and** `event != 'push'` |
| **Door 2** | `repository_dispatch: fixer-needed` — sent by `verify.yml`'s own `signal-fixer` job, carrying `client_payload.run_id`, documented at [`verify-lane-edges.md`](verify-lane-edges.md#node-03-the-signal-fixer-job-wire) |
| **Door 3** | `workflow_dispatch`, `run_id` optional — empty resolves no pull request and exits |
| **Both doors 1 and 2 name the same run** | `signal-fixer` fires *because* `verify`/`immutability` already went red on that run, which is the identical condition door 1's own `if` re-checks independently. Whichever fires first reaches node 09; the other is deduplicated there, not here |
| **Concurrency** | `fixer-${{ inputs.run_id \|\| github.run_id }}`, `cancel-in-progress: false` |
| **Permissions** | `contents: write`, `pull-requests: write`, `issues: write`, `actions: read` |

---

## Node 09 — resolving the run: model, escalate, or nothing · [wire] [stop]

`fixer.yml` "Resolve the pull request that Verify run was judging" step

Bash, not TypeScript — the only place in this lane's two workflows where the routing logic lives
in a workflow step rather than a `.ts` file.

| | |
|---|---|
| **Polls** | `gh run view $RUN_ID --json status`, up to 30 times / 10s, for `status == completed`. Still not completed after 5 minutes → `::error::` and the job fails outright — the one wake in this node that is a real failure, not a silent no-op |
| **No-op exits (code 0, nothing done)** | `RUN_ID` empty; the run carries no `Immutability` job; the Immutability job's own log names no `judging <pr> on implement/issue-<n>` line (the same rendezvous key node 04 of `verify-lane-edges.md` reads — reused here verbatim); the named pull request's `state` isn't `OPEN`; a comment on the PR already carries `` <!-- fixer-run:$RUN_ID --> `` — the mark this exact step leaves a few lines later, and the mechanism that lets doors 1 and 2 both fire on the same run without double-reacting |
| **`MODE=model`** | The `Verify` job's own conclusion (job named `Verify` or `* / Verify` — the same caller-stub renaming `verify-lane-edges.md`'s "Two things worth knowing" describes, re-implemented here in `jq` rather than imported from `shared/job-match.ts`) is `failure` — a real red gate, something the fixer can try against |
| **`MODE=escalate`** | Anything else red on the run — most often `Immutability` itself, which the fixer is never allowed to touch (see node 11's own rule) |
| **Escalate's own reads** | The first job with `conclusion == failure`, and the first `::error::` line in its log, or `(no ::error:: line found in the <job> log)` |
| **The marker, posted either way** | `` <!-- fixer-run:$RUN_ID --> `` plus a one-line comment naming the run, posted once regardless of which mode follows |

### edge — the marker comment · posted once per run, on the pull request

```
<!-- fixer-run:18234501177 -->
[Verify run 18234501177](https://github.com/collod873/claude-workflow/actions/runs/18234501177) came back red; the fixer is reacting to it.
```

### edge — the step's own output · what the rest of the job branches on

```
mode=model
pr=501
branch=implement/issue-421
issue=421
```

---

## Node 10 — rebase onto trunk, or escalate the conflict · [wire] [stop]

`fixer.yml` "Rebase onto trunk so trunk's fixer runs" step · `fixer/fixer.ts` `runEscalate`

Runs only in `mode=model`, before any model is spent this run.

| | |
|---|---|
| **Does** | `git fetch origin main && git rebase origin/main` on the target checkout, at `implement/issue-421` |
| **On conflict** | Aborts the rebase and calls `fixer.ts escalate 421 501 "rebase onto trunk" "conflicts in: <paths>"` — no model runs, `conflicted=true` short-circuits the "Run the fixer" step entirely |
| **Why here, not deferred to the loop** | A branch that cannot even replay onto trunk has nothing a fix could land on; spending an attempt to discover that would waste one of the three the ticket has |

### edge — `unfixableComment` · posted on the pull request, escalate path (conflict or otherwise)

```
**Needs a human.** `rebase onto trunk` failed without a test failing, so there is nothing this lane can reproduce and fix.

conflicts in: scripts/canary-summary.ts
```

`escalateToOwner(gh, 421, assignee)` runs first — `needs-human` on the ticket, the owner assigned —
then this same comment shape lands whether the escalation came from a rebase conflict, a pre-gate
job failure (node 09's own `MODE=escalate`), or the fixer's own crash (node 12).

---

## Node 11 — the fixer stage, attempt by attempt · [model]

`fixer/prompt.md` · `fixer/fixer.ts` `runFixer`

Up to three attempts, `already` (prior attempts still sitting on this branch from earlier fixer
runs) subtracted from the budget before this loop starts.

| | |
|---|---|
| **Model** | `claude-sonnet-5` |
| **Tools** | unrestricted — no allow-list and no deny-list. Unlike lane 05's implementer (node 04 of `implement-lane-edges.md`), which backs "don't commit or push" with `IMPLEMENTER_DENIED_TOOLS` denying the git verbs that would, nothing here technically stops this model from running `git commit`, `git push`, or `gh` itself — only the prompt's own instruction not to |
| **Brief** | `assembleFixBrief`: `## Attempt N of 3`, the currently-failing tests (name + error), and every prior attempt's own summary, or `(none: this is the first attempt)` |
| **The two non-negotiables** | Never touch the immutable set (`vitest.config.ts`, `.github/`); a `test.fails(` line may only lose its `.fails`, never be rewritten to pass |
| **Answers with** | A summary only — "the working tree is your answer," the same rule the implementer's node 04 and [ADR-0121](../adr/0121-the-fixer-s-fix-is-the-working-tree-it-edited-not-a-file-lis.md) use. `changedPaths(git)` reads back whatever the model actually touched |
| **Gate-growth check first** | `gateGrowth(git, paths)` — any *newly added* path matching the gate file list (`bin/`, `.claude/hooks/`, `.husky/`, `.github/workflows/`, `.github/actions/`, or a fixed list including `bin/gauntlet`, `vitest.config.ts`, `eslint.config.js`, `tsconfig.json`...) stops the attempt **before it is committed at all** — a broader, separate rule from the two-entry immutable set above, load-bearing on "a lane may shrink and never grow" (#360) |
| **If nothing grew** | Commit `fix: attempt N at #421` with the model's own summary, `git push --force-with-lease` |
| **Then** | Runs the target's suite scoped to `TEST_DIR` (`.Workflow` in this lane's own caller — see *Loose ends*) via `runVitestJsonForFixer` |
| **Checkpointed** | Same `sha256(HEAD + prompt)` keying every stage uses; in practice each attempt commits, so `HEAD` moves and the checkpoint almost never hits within one fixer run |

### edge — the brief · `{{BRIEF}}`

```
## Attempt 1 of 3

## Currently failing

### #421.1: writes a job summary that quotes the run's own conclusion

expected job summary to include "success" but got undefined

## What prior attempts already tried

(none: this is the first attempt)
```

### edge — `FixerAnswer` · schema-validated JSON

```json
{"summary": "Guarded `writeStepSummary` against a run whose conclusion hasn't landed yet by reading it from the run object instead of a stale cache."}
```

---

## Node 12 — how the loop ends · [wire] [stop]

`fixer/fixer.ts` `runFixer` (continued) · `escalateToOwner` · `shared/spec-gap.ts` `fileSpecGap`

Four ways out, checked in this order after each attempt's tests run.

| Outcome | Fires when | Files `spec/gap`? |
|---|---|---|
| **green** | `result.failures.length === 0` | no |
| **no-progress** | `attempt >= 2` and this attempt's failures are byte-identical (order-independent) to the previous attempt's | only this one — and only if the ticket names a `## Parent PRD` |
| **capped** | The attempt budget (`MAX_ATTEMPTS = 3`, minus any already spent on this branch by earlier fixer runs) is exhausted without landing green or repeating a failure | no |
| **gate-growth** | Already caught mid-attempt at node 11, before any commit | no |

`no-progress` is [ADR-0119](../adr/0119-a-fixer-that-stops-making-no-progress-files-spec-gap-rather.md)'s
own case: an acceptance test that will not move under two independent attempts is not being failed
by the diff — it is asking for something the ticket never decided, and the spec, not the test,
settles that ([ADR-0034](../adr/0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md)).
This is the distinction the task at hand asked
this document to draw sharply: a `divergence` (node 05) says the diff is wrong; `no-progress` here
says the same thing about a test the fixer cannot make pass, and both routes end at the same place —
`spec/gap`, filed against the PRD, read by lane 02's amendment path — never at the pull request.

### edge — `blockedComment` · posted on the pull request, `no-progress`

```
**Blocked.** Two consecutive attempts left the identical tests failing with the identical errors, and nothing further will change that.

What was tried:

1. Guarded `writeStepSummary` against a run whose conclusion hasn't landed yet by reading it from the run object instead of a stale cache.
2. Read the conclusion from the workflow run's own polling loop instead of the cache file.

Filed as `spec/gap` #423: an immovable test is a defect in the contract, not in this diff (ADR-0119).
```

### edge — `fileSpecGap` · the issue `no-progress` files

```
gh issue create --title "spec/gap: #421's acceptance test does not move under any fix" \
  --body "Filed against #419 (ADR-0034).

The fixer made 2 attempt(s) at #421 and two consecutive ones left the identical tests failing with the identical errors.

An acceptance test that does not move under two independent attempts is not being failed by the
diff: it is asking for something the ticket did not decide, and ADR-0034 rules that the spec,
not the test, is what settles that...

## What stayed red, unchanged
### #421.1: writes a job summary that quotes the run's own conclusion

expected job summary to include \"success\" but got undefined

## What the fixer tried

1. Guarded `writeStepSummary`...
2. Read the conclusion from the workflow run's own polling loop..." \
  --label spec/gap
```

### edge — green: `rejudge` · a fresh `implementation-opened` dispatch

```json
{"event_type": "implementation-opened",
 "client_payload": {"pr": "https://github.com/collod873/claude-workflow/pull/501",
   "changed_files": ["scripts/canary-summary.ts", "scripts/canary-summary.test.ts"],
   "criteria": ["I'll know it works when I can open the last nightly run and read its own summary without clicking into a job"]}}
```

No comment is posted for green — silence is the passing case here too. This is the exact door
verify-lane-edges.md's node 00 documents, so this one dispatch re-wakes the entire fan-out: lane 06
judges the rebased branch again, lane 08 races to merge it again, and — if it comes back green this
time — this lane's own node 00 wakes again on that new run and reviews the repaired diff, same as
any other pull request reaching that door.

---

## What each stage may touch

| Stage | Model | Reads | Writes | Can act on the PR / ticket |
|---|---|---|---|---|
| the diff (node 01) | — | machine + target, `origin/main...head_sha` | — | no |
| correctness reviewer (node 02) | opus-5, unrestricted | the diff text only | — | no |
| resolve ticket / scope (nodes 03–04) | — | the tracker, the suite tree | — | no |
| conformance reviewer (node 05) | opus-5, unrestricted | spec text, scope, diff | files `spec/gap` on a `gap` | issues only |
| structural refusal (node 06) | — | the diff text, `greenGateChecks` | — | no |
| refuter (node 07) | sonnet-5, unrestricted | one finding + the diff | publishes findings, proposes fleet changes | issues only |
| resolve the run (node 09) | — | the run's own jobs and logs | posts the marker comment | PR comment |
| rebase (node 10) | — | the target checkout | rebases, force-pushes the branch | escalates on conflict |
| fixer stage (node 11) | sonnet-5, unrestricted | the checkout, the failing tests, prior summaries | edits the worktree; the lane commits and pushes what it left | no |
| loop's end (node 12) | — | — | commits already pushed; on green, re-dispatches Verify; on any blocked outcome, `needs-human` + PR comment, and `no-progress` files `spec/gap` | ticket label/assignee, PR comment |

---

## Where it stops

Ordered by how much has been spent when it fires.

| Cost | Where | Fires when |
|---|---|---|
| free | `review-caller.yml` `on:` | Not a completed `Verify` run, the run failed, or it was a push |
| free | `fixer-caller.yml` `on:` | Neither door's condition holds |
| one runner, before any model | node 09's no-op exits | Empty `RUN_ID`; no `Immutability` job; the log names no pull request; the PR isn't `OPEN`; the marker is already there |
| one runner, real failure | node 09's poll | The named run is still not `completed` five minutes in |
| one runner, no model | node 10 | Rebase onto trunk conflicts |
| 1 opus call (node 02), or 2 (node 02 then 05) | node 02 / node 05 | Either reviewer's JSON fails its schema — the whole run dies uncaught, unlike node 03's own throw a few lines later, which `reviewConformance` catches. The raw response is saved either way, same as every other stage in this repository |
| 1 model call | node 09's escalate path | A job other than `Verify` failed first — nothing here for the fixer to reproduce |
| up to `MAX_ATTEMPTS` (3) sonnet calls | node 12 | `capped`, `no-progress`, or `gate-growth` — none of the three ever un-does a commit already pushed |
| — | node 07's refuter | Never a run-level stop: it vetoes one finding at a time, and a refusal that names no gate or `path:line` does not count as one |

---

## Two things worth knowing

**Silence is the passing case in three different places here.** A correctness/conformance run that
finds nothing publishes nothing. A refuter that finds a finding sound lets it stand without
comment. A fixer attempt that goes green re-dispatches Verify and says nothing on the pull
request. The only things this lane ever writes back are a finding, a `spec/gap`, a blocked comment,
or `needs-human` — every quiet outcome is invisible by design, same as lane 06's own gate and lane
08's own merge.

**The fixer's cap is the branch's, not the run's.** `priorAttempts(git)` counts every
`fix: attempt N at #421` commit already on `implement/issue-421`, from however many separate
fixer.yml runs put them there across however many red-then-repaired cycles. A ticket gets three
attempts in its whole lifetime on that branch, not three per invocation — the same branch-as-claim
discipline lane 05's node 01 uses for who owns `implement/issue-421` at all.

---

## Loose ends in the tree

- `review.ts`'s `main()` reads `greenGateChecks` from `process.argv.slice(4)`. `review.yml`'s own
  invocation supplies exactly two arguments (`origin/main`, the head sha) — no third. In production
  this list is always empty, so `restatesAGreenCheck` (node 06) and the matching half of
  `refusalNamesReason` (node 07) never have anything to match against; only the `path:line`
  citation half of either check ever fires.
- `structural-refusal.test.ts`'s own fixture diff embeds `src/widget.ts:12` as a fabricated
  trailing context on an `@@ ... @@` hunk header to give `citesLocationInDiff` a literal
  `path:line` substring to find. A real `git diff` does not print `path:line` anywhere in its own
  text — file paths appear on `+++`/`---` lines, line numbers appear as `@@ -a,b +c,d @@` ranges,
  never joined by a colon. What a real correctness or conformance finding would have to say for
  its citation to land inside a real diff's text is not established by anything this lane's tests
  exercise.
- What `github.event.workflow_run.head_sha` actually names, for a `Verify` run woken by
  `repository_dispatch` (door 2 of that lane, the only door this lane's own gate admits), is not
  settled by anything in `client_payload` — the `implementation-opened` payload
  (`verify-lane-edges.md`'s own node 00) carries `pr` and `changed_files`, never a sha or a ref. A
  `repository_dispatch`-triggered run's own `github.sha` context is documented to be the default
  branch's tip at dispatch time, not a value the payload names, and nothing in `verify.yml`'s
  `jobs.verify` checkout (also unreffed) overrides it either. What relationship `origin/main...HEAD_SHA`
  (node 01) bears to the pull request's real diff is not something this document can establish from
  the code alone.
- `fixer-caller.yml` hardcodes `test_dir: .Workflow`. `enrol.ts`'s `syncStubs` copies every
  `*-caller.yml` byte-for-byte into every enrolled repository
  ([ADR-0133](../adr/0133-enrolment-is-a-repository-topic-and-an-enrol-lane-writes-stu.md)'s own
  commit message: "the stubs...are the machine's and are overwritten from it"), so every enrolled
  target's fixer looks
  for failing tests under `.Workflow/` — this machine's own directory name — regardless of where
  that target's own suite actually lives. `verify.yml`'s own gauntlet, by contrast, detects the
  target's package manager and runs its own `npm run check` rather than assuming a layout
  (`.github/actions/target-deps`).
- `review/counter.ts` carries its own `main()`, reading `REFUTER_TALLY_REACHED`/`REFUTER_TALLY_REFUTED`
  from the environment. Nothing invokes it that way; production always calls `runCounter()`
  in-process from `review.ts`, right after `publishFindings`.
- `implement-lane-edges.md`'s own worked example titles ticket #421's acceptance test
  `` test.fails("#421: writes a job summary...", ...) `` — the ticket-wide grammar
  (`ticketTitleRe`), not the per-criterion `` #421.1: `` grammar the acceptance author's own prompt
  is pinned to (`acceptance/author-prompt-pin.test.ts`). This document uses the per-criterion form,
  since that is what `testsForCriterion` (node 04) actually requires to count a criterion as
  tested; the two documents disagree on that one string.
