# The spec lane, edge by edge

Lane 02, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

The machine is [`.github/workflows/spec.yml`](../../.github/workflows/spec.yml) (reusable; enrolled
repositories carry only a caller stub). The state machine is
[`.Workflow/agent-workflows/spec/spec.ts`](../../.Workflow/agent-workflows/spec/spec.ts). Every model
call in the repository goes through
[`shared/stage.ts`](../../.Workflow/agent-workflows/shared/stage.ts).

Payload contents below are a worked example built to the real shapes and rules — the schemas, the
refusals, the field names and the ordering are what the code does. The example run: **issue #412**,
an accepted idea carrying a decision sheet, labelled `to-spec`, producing **PRD #419** carrying
`sliceable`.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript ·
**[stop]** can refuse and end the run.

---

## Node 00 — the label event · [stop]

`spec.yml` `jobs.spec.if`

GitHub wakes the workflow on every label applied to any issue. The `if:` decides this one is real,
before a runner is allocated — a refusal here costs nothing.

| | |
|---|---|
| **Passes when** | `repository_dispatch`; **or** label `to-spec` and `sender.login == repository_owner`; **or** label `prd` and the issue does **not** already carry `sliceable` and `sender.login == repository_owner` |
| **Why sender** | The repo is public. Anyone can label. A stranger's label would spend the Opus budget, so the gate is on *who performed the act*, not who owns the issue. |
| **Why `prd` excludes `sliceable`** | A spec that already passed the gate has nothing left for the critic to decide; re-labelling it would spend an Opus call to re-derive a result that already dispatched. |
| **Third door** | `repository_dispatch`, sent by the accept lane. Needed because a label applied by the bot token starts no workflow run — GitHub's own rule. |
| **Concurrency** | Grouped per issue number, `cancel-in-progress: false`. |
| **Re-run gesture** | Remove the label, re-add it. |

### edge — `env` · two variables set by YAML expression

```
# decided in the workflow, never re-derived in TypeScript —
# a second copy of a condition is a second thing that can disagree with it

ISSUE_NUMBER=412
SPEC_TRIGGER=to-spec        # 'critique' if the label was `prd`
```

The dispatch door falls through to `to-spec` because `github.event.label.name` is empty on a
dispatch — right, since an accepted sheet *is* a cold start.

Before any TypeScript runs, the job also: exports `DISPATCH_REQUESTS_PATH` into `$RUNNER_TEMP`,
checks out the machine repo and the target repo side by side, **refuses if
`CLAUDE_CODE_OAUTH_TOKEN` is empty** (before Node is installed), pins
`@anthropic-ai/claude-code@2.1.241`, and puts a running-label on the source issue.

---

## Node 01 — `planSpecRun` · [wire] [stop]

`spec.ts:216`

Two tracker reads, no model. Decides *whether* to run and *which collector* to use. Last free stop.

| | |
|---|---|
| **Critique short-circuit** | `trigger === "critique"` returns `{ path: "critique", issueNumber }` immediately — no `alreadySliced` check, no collector detection. |
| **Check 1** | `alreadySliced()` — lists up to 200 `prd` issues (`--state all`), looks for one whose hidden `spec-source:v1` trailer names #412 *and* that already carries `sliceable`. Found → **throw**. |
| **Why not YAML** | The label lands on the *source* issue, not on the spec it produces. Whether a spec already exists for it is not a fact an `if:` expression can see. |
| **Check 2** | `detectSourceKind()` — does any comment carry a decision-sheet marker? Yes → **sheet** collector. No → **map** collector. *The label that fired the run is never consulted.* |

### edge — `SpecPlan` · in-process object

```ts
{
  path: "author",
  input:  { kind: "sheet", gh: execGh, issueNumber: 412 },
  target: { kind: "sheet", issue: 412 }   // becomes the trailer on #419
}
```

The `map` variant additionally carries `repoRoot`, so the collector can read ADR files off the
checked-out target.

---

## Node 02 — the sheet collector · [wire]

`spec/collectors/sheet.ts`

Reads issue #412 and flattens it into **`DecidedContext`** — five strings. That shape is the whole
of what any downstream model is allowed to know about intent. Nothing else about #412 travels.

| | |
|---|---|
| **Reads** | The issue body, and `gh issue view 412 --json comments` |
| **Parses** | The *hidden HTML markers* in the comments — the sheet's JSON and the accept's payload JSON. **Never the rendered prose.** The marker exists precisely so nobody re-parses English (ADR-0058). |
| **Takes the last** | `sheets.at(-1)` and `payloads.at(-1)` — a re-run of the accept lane wins over the first one. |
| **Refuses** | **Throws** if there is no sheet marker, or no accept payload. |
| **Also returns** | `decisions: MarkedDecision[]` — the sheet's raw decisions, carried past the models for `unfiledMarks()` at node 05. |
| **Map variant** | Scrapes Markdown instead: `## Decisions so far` lines shaped `- [title](link): gist`, and for each one inlines the whole ADR file off disk when the gist names a `docs/adr/…md` path, falling back to that issue's **first comment** otherwise. Boundaries come from `## Out of scope`, open guesses from `## Not yet specified`. Refuses on zero decision entries. |

### edge — `DecidedContext` · five strings

**`ownerWords`** — the issue body, verbatim, untouched:

```
The nightly canary has been dead for eleven days and I found out
by accident, because I happened to open the Actions tab.

I don't want an alerting stack. I want the run itself to say what
it did, in the place I already look.

I'll know it works when I can open the last nightly run and read
its own summary without clicking into a job.
```

That last sentence is the only thing in a spec that is **not synthesis**. It has to come out the far
end byte-for-byte identical.

**`decisions`** — rendered from the sheet marker, one block per decision
(`question` / `recommendation` / `(Rejected: …)`), or `None recorded.`

```
- Where does the summary go?
  The run's own GitHub step summary. No new surface.
  (Rejected: a comment on a tracker issue; a Slack post)
```

**`rulings`** — the ADR paths the accept filed, plus a `Coined:` line for coined terms, or
`No rulings were filed.`

```
- docs/adr/0107-a-lane-reports-its-own-outcome-in-the-run-that-produ.md

Coined: canary summary
```

**`boundaries`** — `` Route: `lane`, `` followed by the sheet's `routeReason`.

**`openGuesses`** — the sheet's survivors, one per line, or `None.`

---

## Node 03 — sweep · [model 1 of 4]

`spec/sweep/prompt.md` · `spec/sweep.ts`

Sent to read the repo for whatever bears on this work. It exists because **a collector only carries
what its own source happened to cite** — a ruling filed the week after the sheet was written is
invisible to it. Cheap model, because this is search, not judgement.

| | |
|---|---|
| **Model** | `claude-haiku-4-5-20251001` |
| **Tools** | `Read`, `Grep`, `Glob` — the same `SPEC_AUTHOR_ALLOWED_TOOLS` array the author uses, enforced by the CLI flag, not by the prompt (ADR-0060) |
| **Sees** | `ownerWords` · `decisions` · `boundaries` · `openGuesses` |
| **Does not see** | **`rulings`** — deliberately. It is about to replace that field, and showing it the old value would anchor it. |
| **Told to** | Read `docs/adr/` filenames first (each filename *is* its ruling, stated as a sentence), then `CONTEXT.md`'s vocabulary, then the modules the work touches. Quote verbatim, cite the file. |
| **Empty is legal** | "When you find nothing, return an empty `rulings`; that is a real answer." |

### edge — `SpecSweep` · schema-validated JSON

```json
{"rulings":[
  {"ref":"docs/adr/0107-a-lane-reports-its-own-outcome-in-the-run-that-produ.md",
   "quote":"a lane reports its own outcome in the run that produced it"},
  {"ref":"docs/adr/0092-a-watchdog-counts-what-is-missing-never-what-failed.md",
   "quote":"a watchdog counts what is missing, never what failed"},
  {"ref":"CONTEXT.md",
   "quote":"canary — an enrolled repository that proves a machine change on real GitHub before it lands"}
]}
```

The third hit is the sweep doing its actual job: the accept coined *"canary summary"*, and
`CONTEXT.md` already uses *canary* to mean something else. The collector could never have known
that; the author now will.

### edge — `applySweep()` · [wire] one field overwritten

```
// context.rulings is REPLACED, not appended to.
// A ruling the sweep did not return does not reach the author,
// however the collector found it.

- docs/adr/0107-…md
  Coined: canary summary

+ **docs/adr/0107-…md**: a lane reports its own outcome in the run that produced it
+ **docs/adr/0092-…md**: a watchdog counts what is missing, never what failed
+ **CONTEXT.md**: canary — an enrolled repository that proves a machine change…
```

An empty sweep renders the literal line
`_The sweep found nothing. `none found` is a legal line here too._` — so `rulings` is never blank.

---

## Node 04 — author · [model 2 of 4]

`spec/author/prompt.md` · `spec.ts:69`

Writes the spec. May read the repository without limit and can reach **no second source of intent** —
no Bash, no web, no subagents, nothing that could see the tracker or another spec. The five fields
are the only intent in the world as far as it is concerned.

| | |
|---|---|
| **Model** | `claude-opus-5` |
| **Tools** | `Read`, `Grep`, `Glob` |
| **Rule 1** | **Criteria quote, never paraphrase.** A criterion that restates the owner in different words is one he cannot check at a glance. |
| **Rule 2** | **Every guess becomes a numbered open question, never a silent assumption.** Zero open questions is allowed — it just has to be true, not assumed. |
| **Rule 3** | The *"I'll know it works when I can ___"* sentence becomes the one check-marked criterion, shaped `<what is observably true> - check: <one command>`. If it cannot be mechanised, it becomes an open question — **never a guessed command.** |
| **Also handed** | `{{SPEC_FORMAT}}` — read live out of `docs/agents/spec-format.md` by `specFormat()`, which splices the core section together with the **`### Lane spec`** variant only, and throws if that variant is missing. The format lives in a doc a human maintains, not in a prompt string. |

### edge — `SpecAuthorOutput` · `title` · `body` · `openQuestions[]`

**title** — `The nightly canary reports its own outcome`. Names the work, not the ticket process.

**body** — headings in the order the Lane spec variant fixes:

```
## Problem Statement
## Solution
## User Stories
## Implementation Decisions
## Testing Decisions
## Out of Scope
## Further Notes
## Acceptance criteria
## Assumptions
```

```
## Acceptance criteria

- [ ] I'll know it works when I can open the last nightly run and read
      its own summary without clicking into a job - check: `gh run list
      --workflow=nightly.yml --json conclusion --jq '.[0].conclusion'`
```

The owner's sentence arrives intact. The command after the dash is the author's contribution.

**openQuestions**

```json
["How many consecutive missed runs before the watchdog gets loud? The sheet
  listed this as a survivor and the accept filed no ruling on it."]
```

---

## Node 05 — critic · [model 3 of 4]

`spec/critic/prompt.md` · `spec/critic.ts`

Reads the draft cold. All five context fields are dropped at this edge. It hunts exactly two things,
and it *resolves* what it finds rather than reporting it: a pen, and no outbox.

| | |
|---|---|
| **Model** | `claude-opus-5` |
| **Tools** | **unrestricted** — `critic.ts` passes no `allowedTools` at all. The one stage in the lane with no allow-list. |
| **Sees** | `TITLE`, `BODY`, and `ANSWERS` |
| **`ANSWERS`** | The issue's comment thread, blank-filtered, joined by `---`. On the cold path there are none, so the prompt is handed the literal `Nothing has been answered; this is the first read of this spec.` On the warm path (node 11) it carries the owner's replies, so a reply can settle an ambiguity before the critic decides it. |
| **Hunts** | 1. A sentence two engineers could both build differently and both call done. 2. A criterion nobody can observe — no command, no state to inspect, no verbatim quote behind it. |
| **Not a finding** | Style. A phrasing you'd have written differently but that is checkable as written. *Missing scope* — that is a new requirement, and inventing one is not its job. Anything the answers already settle. |
| **Hard bound** | **Sharpen, never remove.** It may make a criterion more specific. It may never delete one, and may never narrow the work to make an ambiguity disappear. |
| **Empty is fine** | A tight draft produces `[]`, and node 06 is skipped entirely. |

### edge — `SpecCriticOutput` · `resolutions[]`

```json
{"resolutions":[
  {"decision":"\"the run's step summary\" means the GitHub Actions job summary written via
     $GITHUB_STEP_SUMMARY, not a comment posted onto the run.",
   "reason":"The body's own Out of Scope rules out new surfaces, and ADR-0107 says a lane
     reports in the run that produced it."},
  {"decision":"The check command asserts the conclusion equals \"success\", not merely that a
     conclusion exists.",
   "reason":"As written the jq expression prints any conclusion, including \"failure\", and
     exits 0 — a criterion that cannot come out false."}
]}
```

The second one is the point of this stage: the author wrote a command that *runs*, not a command
that can *fail*.

### edge — `unfiledMarks()` · [wire] synthetic resolutions merged in

A sheet decision that carries a `mark`, has an empty `adrTitle`, and that no open question mentions
becomes a resolution too — written in TypeScript, not by a model:

```json
{"decision":"`watchdog-threshold` follows the sheet's own recommendation, with no ADR filed for it.",
 "reason":"The sheet decided `watchdog-threshold` and filed no ruling for it, and the draft asks
   about none of it."}
```

```ts
resolutions = [...critique.resolutions, ...marks.map(unfiledMarkResolution)]   // 2 + 1 = 3
```

---

## Node 06 — reconciler · [model 4 of 4] · [skipped if `resolutions` is empty]

`spec/reconcile/prompt.md` · `spec/reconcile.ts`

Folds the resolutions into the body. This matters because **the body is the only thing read
downstream** — lane 03 slices the body, and the acceptance lane later matches criterion text against
the body verbatim. A decision that stays off the page is a decision that never happened.

| | |
|---|---|
| **Model** | `claude-opus-5` |
| **Tools** | `Read`, `Grep`, `Glob` |
| **Told to** | **Revise, do not re-invent.** Untouched sentences come back byte for byte. Not improving the prose. Not restructuring. Never inventing a resolution of its own. Never dropping a heading or an untouched criterion. |
| **Returns** | The *whole* body, first line to last. Not a diff. There is no way to say "no change" — a run with nothing to fold is never started. |
| **Also handed** | `{{SPEC_FORMAT}}`, same as the author: the rewrite has to keep the contract too. |

Then two things the code does, not the model:

| | |
|---|---|
| **Rail 1** | `countCriteria(before)` vs `countCriteria(after)`. Fewer `- [ ]` items than it was handed → **throw**. A model that "tidies" a spec by quietly dropping a requirement never gets written. |
| **Rail 2** | Whatever `## Assumptions` the model wrote is **stripped** by `withoutAssumptions()`, and the section is rebuilt in TypeScript from the resolutions array — one `- **decision** reason` line each, appended after everything else. The model does not get to author that section. |

### edge — `body` · the complete replacement string

```
## Acceptance criteria

- [ ] I'll know it works when I can open the last nightly run and read
      its own summary without clicking into a job - check: `gh run list
      --workflow=nightly.yml --json conclusion --jq '.[0].conclusion == "success"'`

## Assumptions

- **"the run's step summary" means the GitHub Actions job summary written via
  $GITHUB_STEP_SUMMARY, not a comment posted onto the run.** The body's own Out of
  Scope rules out new surfaces, and ADR-0107 says a lane reports in the run that
  produced it.
- **The check command asserts the conclusion equals "success", not merely that a
  conclusion exists.** As written the jq expression prints any conclusion, including
  "failure", and exits 0.
- **`watchdog-threshold` follows the sheet's own recommendation, with no ADR filed
  for it.** The sheet decided it and filed no ruling, and the draft asks about none of it.
```

Criteria count in: **1**. Out: **1**. Rail 1 passes. The owner's sentence is still byte-identical;
only the command after the dash moved.

---

## Node 07 — `publishSpec` · [wire] [stop]

`spec/publish.ts` → `spec/validate-spec.ts` → `bin/ticket_shape.py`

Prefixes `PRD:` if absent, stamps a hidden `spec-source:v1` trailer at the top of the body,
**validates the assembled body**, and files the issue with the `prd` label.

Validation is TypeScript shelling out to `python3` and importing `bin/ticket_shape.py` — **the same
validator the CLI tooling uses.** Cross-language on purpose: one implementation of "what a valid
spec looks like", rather than a TypeScript copy that drifts. It runs *before* `gh issue create`, so
a rejected body is never filed.

| | |
|---|---|
| **Refuses** | No `## Acceptance criteria` heading. Not **exactly one** `- [ ]` item — three behavioural claims is three specs. A malformed trailing `check:` marker: no backtick-quoted command, or prose after the closing backtick. |
| **And this** | **It runs the command.** If the check already exits `0` against the tree at filing time, the filing is **refused outright** (ADR-0130) — a criterion true by accident proves nothing when it goes green later. It must be *red today*. 30-second budget. |
| **Only warns** | A command that cannot be run to a verdict at all — no such binary, or it outran the budget. That is not evidence either way; warnings go to stderr and the spec is still filed. |
| **The asymmetry** | A ticket's check reads the tree and must never touch the network. A spec's check *must* read the world — `gh run list`, a health endpoint, real data. Only production can answer whether the product does the thing. |
| **The trailer** | Load-bearing, not decoration. It is how `alreadySliced()` — back at node 01, on some future run — finds "a spec already exists for #412" and refuses *before* spending anything. |

### edge — verdict · JSON on the python process's stdout

```json
{"ok": true, "warnings": []}

// the other shape, and the run ends here:
{"ok": false, "error": "a spec's one acceptance criterion is already true before any work
  exists: `…` exited 0 against this tree right now…"}
```

### edge — `gh issue create` · argv

```
gh issue create \
  --title "PRD: The nightly canary reports its own outcome" \
  --label prd \
  --body  "<!-- spec-source:v1 {\"kind\":\"sheet\",\"issue\":412} -->

## Problem Statement
…"

→ https://github.com/collod873/claude-workflow/issues/419
```

---

## Node 08 — `applyGate` · [wire]

`spec/open-questions.ts`

Applies `sliceable`, then asks for the dispatch. Unconditional — the open question from node 04 does
*not* hold the spec back.

| | |
|---|---|
| **Order matters** | Label **first**, dispatch second. A spec carrying `sliceable` with no sub-issues behind it is a visible lost dispatch, and `lost-dispatch-counter.yml` counts it. Reversed, a failed send would leave no trace at all. |
| **Vestigial** | `applyGate` takes a `count` and immediately does `void count`. `gateCount` and `unfiledMarkGap` are still computed and reported but change nothing — dead weight from before the open-questions round-trip was removed. `GateOutcome` has exactly one value, `"dispatched"`. |

### edge — `dispatch-requests.jsonl` · one line appended in `RUNNER_TEMP`

```json
{"event_type":"prd-sliceable","client_payload":{"issue":419}}
```

Written to a file rather than sent, because this job is not allowed to send it — node 09 explains
why. Off CI, with `DISPATCH_REQUESTS_PATH` unset, `requestDispatch` calls `gh api` directly instead.

---

## Node 09 — the second job · [wire] no checkout

`spec.yml` `jobs.dispatch`

A whole separate machine that exists to run one API call. The job that spends a model holds
`contents: read` — deliberately, because a token that can spend a model should not also be able to
write the repo. `POST /dispatches` needs `contents: write`. Permissions are per-job, so the work is
split across two.

| | |
|---|---|
| **Handoff** | A file in `RUNNER_TEMP` dies with its runner, so the request is lifted into a *job output* for a second machine to read. |
| **Skipped when** | `needs.spec.outputs.dispatch-requests == ''` — a run that refused before spending anything produces no job here at all, rather than a green job that sent nothing. |

### edge — `repository_dispatch` · lane 03 wakes

```
printf '%s' "$request" | gh api --method POST 'repos/{owner}/{repo}/dispatches' --input -

→ to-tickets.yml starts. PRD #419 becomes sub-issues.
```

---

## What each stage may touch

Enforced by CLI flags on the spawned process, not by the prompt asking nicely.

| Stage | Model | Read the repo | Shell / gh / web | Sees the owner's words | Sees the draft |
|---|---|---|---|---|---|
| sweep | haiku-4-5 | Read Grep Glob | no | yes | — |
| author | opus-5 | Read Grep Glob | no | yes | — |
| critic | opus-5 | unrestricted | unrestricted | only via `ANSWERS` on the warm path | yes |
| reconcile | opus-5 | Read Grep Glob | no | no | yes |

The critic is the outlier: `critic.ts` passes no `allowedTools` at all.

---

## Where it stops

Ordered by how much has been spent when it fires. The first four are free.

| Cost | Where | Fires when |
|---|---|---|
| free | `spec.yml` `if:` | The labeller is not the repo owner; the label is neither `to-spec` nor `prd`; or it is `prd` on an issue already carrying `sliceable`. |
| free | preflight | `CLAUDE_CODE_OAUTH_TOKEN` is empty — checked before Node is installed. |
| free | `alreadySliced()` | A `sliceable` spec already names #412 in its trailer. A second `to-spec` is a no-op, not a second spec. |
| free | collector | The sheet marker or the accept payload is missing; or a map carries no `## Decisions so far` entries. |
| free | `specFormat()` | `docs/agents/spec-format.md` is unreadable or has no `### Lane spec` variant. |
| 1 call | structured output | A stage returns JSON that fails its schema. The raw response is written to `<handoff dir>/<stage>-raw-response.txt` and the error names the path — a long Opus response is never lost to a parse failure. |
| 4 calls | reconcile rail | The rewrite came back with fewer acceptance criteria than it was handed. |
| 4 calls | validate | Not exactly one criterion; a malformed check marker; or the check command already passes today. |
| 30 min | timeout | The job is *cancelled*, not failed — which is why the failure comment fires on `!success()` rather than `failure()`. |

Any of them posts a comment onto #412 itself, and the running-label comes off in an `always()` step.
Before that comment existed, a `to-spec` that fired, ran and died was indistinguishable from a label
that started nothing — a lane whose only failure channel is the Actions tab is a lane the tracker
reports as idle.

---

## Two things worth knowing

**Checkpoints — why re-running locally is free.** `runStage` keys every response on
`sha256(git HEAD + "\0" + the fully rendered prompt)` and writes an envelope to
`.Workflow/agent-workflows/checkpoints/<stage>.json` (override with `CHECKPOINTS_DIR`). Re-run on
the same commit with the same inputs and it replays from disk without calling Opus. Change one
character of the issue body — or move the commit — and the key misses and it pays again. Only one
file per stage, so the last run of a stage is the only one cached.

**Node 11 — the warm door: label `prd`, not `to-spec`.** When the spec was hand-written in a live
session, **the issue already is the draft**. `runSpecCritique` takes over: nodes 02, 03, 04 and 07
never happen — no collector, no sweep, no author, no publish. It reads the published spec, hands the
critic the body *and* the issue's comment thread as `{{ANSWERS}}`, reconciles only if there is
something to fold (the body stripped of its source marker first, the marker re-stamped after),
edits the issue in place with `gh issue edit`, and gates. **One model call instead of four.**

Note that this path does **not** re-run `validateSpecBody` — `updateSpec` writes the body straight
to the issue. Validation lives in `publishSpec` only.

---

## Prompt sizing

Every stage passes its prompt over **stdin**, not argv, so `runStage`'s 131,072-byte argv-element
check never fires for this lane — it is there for stages that do not set `promptViaStdin`. The
largest single input to both the author and the reconciler is `{{SPEC_FORMAT}}`, the lane-spec
contract: bigger than the owner's words plus every decision combined.

## Loose ends in the tree

- `.Workflow/agent-workflows/spec/amend/prompt.md` exists but nothing references it; there is no
  `amend.ts`.
- `gateCount()` / `unfiledMarkGap()` are computed and logged, but `applyGate` discards the count.
