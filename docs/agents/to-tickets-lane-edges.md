# The slice lane, edge by edge

Lane 03, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

The machine is [`.github/workflows/to-tickets.yml`](../../.github/workflows/to-tickets.yml)
(reusable; enrolled repositories carry only a caller stub,
[`to-tickets-caller.yml`](../../.github/workflows/to-tickets-caller.yml)). The state machine is
[`.Workflow/agent-workflows/to-tickets/to-tickets.ts`](../../.Workflow/agent-workflows/to-tickets/to-tickets.ts).
This is the one lane whose stages spend a model call without pinning a model: every other
`TypedStageConfig` in the tree sets `options.model` to a named constant
(`claude-opus-5`/`claude-sonnet-5`/`claude-haiku-4-5-20251001`); this lane's three stages run
whatever the `claude` CLI defaults to. None of the three restrict `allowedTools`/`disallowedTools`
either — the prompts have the model run `gh issue view ... --jq ...` itself, over Bash.

Payload contents below are a worked example built to the real shapes and rules. The example run
continues [`spec-lane-edges.md`](spec-lane-edges.md)'s own: **PRD #419** carries `sliceable`, and
this lane slices it into two sub-issues — **ticket #420** (wave 0, nothing blocks it) and
**ticket #421** (depends on #420) — the same #421
[`implement-lane-edges.md`](implement-lane-edges.md) and
[`verify-lane-edges.md`](verify-lane-edges.md) pick up downstream.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript or
shell · **[stop]** can refuse and end the run.

---

## Node 00 — the one door · [stop]

`to-tickets-caller.yml` `on:` / `to-tickets.yml` `jobs.to-tickets.if`

| | |
|---|---|
| **Fires on** | `repository_dispatch`, `types: [prd-sliceable]` |
| **Passes when** | `github.event.action == 'prd-sliceable'` |
| **Who sends it** | Exactly one caller: lane 02's own gate (`applyGate`, documented in `spec-lane-edges.md`'s later nodes), once a PRD's critique pass lands clean |
| **Concurrency** | `to-tickets-${{ client_payload.issue }}`, `cancel-in-progress: false` — grouped per PRD |

### edge — `client_payload` · one field

```json
{"event_type": "prd-sliceable", "client_payload": {"issue": 419}}
```

Same convention as every dispatch door in this pipeline: the id and nothing else. The PRD body,
its criteria, its shape — this lane reads all of it for itself off the tracker.

---

## Node 01 — preflight, before any model runs · [wire] [stop]

`to-tickets.yml`, shell steps ahead of the Node setup

| | |
|---|---|
| **Restore checkpoints** | `./.github/actions/checkpoints`, `phase: restore` — downloads the latest `checkpoints-to-tickets-<issue>` artifact and unpacks it into `.Workflow/agent-workflows/checkpoints/`. This is the one thing that makes this lane different from lanes 02 and 05: checkpoints here are persisted *across separate Actions runs*, not just within one job. `runStage`'s `sha256(HEAD + prompt)` key still governs whether a checkpoint actually pays off — this action only makes sure last run's checkpoint file is on disk to be found |
| **Refuses — already sliced** | `gh api .../sub_issues --jq length` non-zero. A PRD with existing sub-issues has already been through this lane once |
| **Refuses — is itself a slice** | GraphQL `issue(number: $num) { parent { number } }` returns a non-empty parent — this PRD is somebody else's ticket, not a spec to slice |
| **Refuses — no token** | `CLAUDE_CODE_OAUTH_TOKEN` empty, same precondition every model-spending lane checks before Node is even installed |

### edge — the two refusal comments

```
Refused to run: this PRD already has 2 sub-issue(s). Close or detach the existing
sub-issues, then remove and re-add `prd` to retry.
```

```
Refused to run: this issue is itself a sub-issue of #419. Detach it from its parent,
then remove and re-add `prd` to retry.
```

Both add `slice-failed` and exit 1. Zero model calls spent — these two run as plain shell before
`to-tickets.ts` is even invoked, the cheapest refusals this lane has.

**Upload checkpoints** (`phase: upload`, `if: always()`) re-uploads the checkpoint directory under
the same artifact name after the last stage runs, win or lose.

---

## Node 02 — seam sweep · [model] [stop]

`to-tickets.ts` `SEAM_SWEEP_CONFIG` · [`seam-sweep/prompt.md`](../../.Workflow/agent-workflows/to-tickets/seam-sweep/prompt.md)

Inputs: `{{ISSUE_NUMBER}}`, `{{VOCABULARY}}` — read live from
[`to-tickets/vocabulary.md`](../../.Workflow/agent-workflows/to-tickets/vocabulary.md), split on
its own `---` rule; an empty tail throws, a precondition rather than a request
([ADR-0082](../adr/0082-a-lane-carries-the-vocabulary-it-works-in-rather-than-readin.md)).

The model reads the PRD itself (`gh issue view 419 --json title,body`), explores the checkout, and
returns one line per primitive worth sharing across the slices it's about to draw: what it is,
where it lives, who would consume it. This is this lane's version of lane 02's own sweep, run with
a wider toolbelt and no cheap-model pin.

### edge — `SeamManifest`

```json
{"entries": [
  "canary summary formatter: renders a run's own conclusion into a job summary line, at scripts/canary-summary.ts, consumed by both slices of #419"
]}
```

`z.array(string.min(1))`, each entry newline-free, wrapped `{entries: [...]}`. Empty `[]` is legal
— "no primitives warrant sharing" is a real answer.

---

## Node 03 — slice · [model] [stop]

`to-tickets.ts` `SLICE_CONFIG` · [`slice/prompt.md`](../../.Workflow/agent-workflows/to-tickets/slice/prompt.md)

Inputs add `{{TICKET_FORMAT}}` (read live from
[`ticket-format.md`](ticket-format.md)'s `### Spec sub-issue` section — a missing section throws)
and `{{SEAM_MANIFEST}}` — node 02's checkpoint file, read straight off disk and re-parsed through
its schema, not re-validated against the current commit. On a retry, whatever the checkpoint
directory currently holds for that stage is what this stage sees; see *Two things worth knowing*.

Rules are read live, by path reference in the prompt rather than injected as variables, from
`references/headless-gate.md`, `chain-shape.md`, `slicing-rules.md`, `output-contract.md`. The
model draws a `Plan` — an array of `Slice`: `title`, `whatToBuild` (≤400 chars), `acceptanceCriteria[]`
(≤200 chars each, ≥1), `filesClaimed[]`, `seamsConsumed[]`, `whyNotMerged` (≤200 chars), `dependsOn[]`
(1-based index into earlier positions in the array).

`validatePlan` runs immediately after the schema parses:

| Refuses when |
|---|
| Any `dependsOn` is a self-reference or an out-of-range index |
| No slice has an empty `dependsOn` — **at least one** unblocked root, not exactly one, since [ADR-0113](../adr/0113-wave-0-may-hold-more-than-one-slice-so-validateplan-requires.md): wave 0 may hold more than one slice |
| A dependency cycle exists (named, both slices) |
| Any slice's own `renderBody()` would fail `validateTicket()` — missing `## Acceptance criteria`, no `- [ ]` items, missing `## Files claimed` |

### edge — `Plan` (excerpt)

```json
[
  {"title": "Ticket #420: canary summary formatter", "whatToBuild": "...",
   "acceptanceCriteria": ["I'll know it works when I can open the last nightly run and read its own summary without clicking into a job"],
   "filesClaimed": ["scripts/canary-summary.ts"], "seamsConsumed": [], "whyNotMerged": "...",
   "dependsOn": []},
  {"title": "Ticket #421: wire the formatter into the nightly job", "whatToBuild": "...",
   "acceptanceCriteria": ["..."], "filesClaimed": ["scripts/canary-summary.test.ts"],
   "seamsConsumed": ["canary summary formatter"], "whyNotMerged": "...", "dependsOn": [1]}
]
```

---

## Node 04 — audit-and-publish · [model] [wire] [stop]

`to-tickets.ts` `AUDIT_CONFIG` + `AUDIT_AND_PUBLISH_RUN` · [`audit/prompt.md`](../../.Workflow/agent-workflows/to-tickets/audit/prompt.md)

Input `{{PLAN}}` is node 03's checkpoint, read raw off disk the same way node 03 read node 02's.
The prompt grades the plan against four sizing calls (granularity, edge correctness,
merge/split candidates, balance) and resolves every concern itself, returning
`{notes: string, slices: Plan}` — `notes` is prose for the run log, read by nothing downstream.

Then, in the same step, `sliceAndPublish(audited.slices, prdNumber, gh)` runs, wrapped so that any
throw first writes the audited plan JSON to
`<handoff dir>/audit-and-publish-raw-response.txt` before rethrowing — a publish-time refusal never
loses the model's paid-for work.

Four validators run, all before the first `gh issue create`, so a bad batch never partially
publishes:

| Validator | Refuses when |
|---|---|
| `validatePlan` | Same graph/shape checks as node 03, re-run against the *audited* plan |
| `validateCriteriaShape` | A criterion's `check:` marker names `gh api\|issue\|pr\|run`, `curl`, or `wget` — "checks the tracker instead of the tree; it can never be answered by a diff" |
| `validateClaimsAreMutable` | Any `filesClaimed` path touches the immutable set (`vitest.config.ts`, `.github/`) — named, "lane 06 would refuse the implementation" |
| `validatePathsAreRooted` | A claimed path, or a path-shaped token in `whatToBuild`/`acceptanceCriteria`, has no real top-level repo root as its first segment — "Lane 04 and lane 05 read this ticket independently and cannot ask each other" ([ADR-0118](../adr/0118-a-ticket-roots-every-path-it-names-because-lane-04-and-lane.md)) |

Once all four pass:

1. `publishSubIssues` — `renderBody(slice, prdNumber)` hardcodes `## Parent PRD\n#<n>`,
   `## What to build`, `## Acceptance criteria`, `## Files claimed`, optional `## Seams consumed`;
   `gh issue create`; `attachUnderPrd()` via the native sub-issue API.
2. `wireBlockedByEdges` — one `POST .../dependencies/blocked_by` per `dependsOn`.
3. `verifyBlockedByGraph` — reads the graph back from GitHub and throws if any declared edge is
   missing. A write-then-verify rail, distinct from the four validators above, which all run
   *before* anything is written.
4. `dispatchReadySlices` — for **every** published slice, not only the ready ones, dispatches
   `acceptance-wanted` with a `ready` flag.

### edge — a published ticket body (`#420`)

```
## Parent PRD
#419

## What to build
...

## Acceptance criteria
- [ ] I'll know it works when I can open the last nightly run and read its own summary
      without clicking into a job
      check: npm run canary-summary -- --dry-run

## Files claimed
- scripts/canary-summary.ts
```

### edge — `acceptance-wanted` dispatch · one per published slice

```json
{"event_type": "acceptance-wanted", "client_payload": {"issue": 420, "ready": 1}}
{"event_type": "acceptance-wanted", "client_payload": {"issue": 421, "ready": 0}}
```

This is this lane's only edge into lane 04: the whole batch is handed to lane 04's author
immediately, whether or not a slice can actually start yet. `ready` is the only thing that varies
— see [`reconcile-lane-edges.md`](reconcile-lane-edges.md)'s node 06 onward for what each value
does once it lands there.

---

## Node 05 — the dispatch job · [wire]

`to-tickets.yml` `jobs.dispatch`, `needs: [to-tickets]`, `if: needs.to-tickets.outputs.dispatch-requests != ''`

The same two-job split as lane 02's own gate
([ADR-0091](../adr/0091-the-token-that-spends-a-model-and-the-token-that-starts-the.md)): the
model-spending job holds `contents: read` throughout; this job holds `contents: write` and does
nothing else. It collects the run's `DISPATCH_REQUESTS_PATH` file as a job output and loops its
lines, one `repos/{owner}/{repo}/dispatches` POST per line.

---

## What each stage may touch

| Stage | Model | Tools | Checkpointed cross-run | Writes the tracker |
|---|---|---|---|---|
| seam-sweep | unpinned (CLI default) | unrestricted (Bash, `gh`, everything) | yes, artifact-persisted | no |
| slice | unpinned | unrestricted | yes | no |
| audit-and-publish | unpinned | unrestricted | yes | files issues, wires blocked-by, dispatches |

---

## Where it stops

| Cost | Where | Fires when |
|---|---|---|
| free | `to-tickets.yml jobs.to-tickets.if` | Not a `prd-sliceable` dispatch |
| free | "already has sub-issues" | Sub-issue count ≠ 0 |
| free | "is itself a sub-issue" | GraphQL `parent { number }` non-empty |
| free | preflight | `CLAUDE_CODE_OAUTH_TOKEN` empty |
| free | `vocabulary()` / `ticketFormat()` | `vocabulary.md` empty below its `---`, or `ticket-format.md` has no `### Spec sub-issue` section |
| 1 call | seam-sweep schema parse | Model's JSON fails `SeamManifest`'s schema |
| 2 calls | slice schema parse + `validatePlan` | Malformed JSON, a dependency cycle, no unblocked root, or a shape `validateTicket()` would refuse |
| 3 calls | audit publish rails | A remote-reading `check:` marker, an immutable-set claim, or an unrooted path |
| 3 calls, mid-publish | `verifyBlockedByGraph` | The read-back graph is missing an edge the plan declared |
| 30 min | `timeout-minutes: 30` | Job cancelled |

All refusals past the two nested-sub-issue guards post one comment (`to-tickets run failed.\n\n
**Reason:** <reason>\n\n**Workflow run:** <url>\n**Checkpoints:** the
checkpoints-to-tickets-<PRD> artifact on that run.`) and add `slice-failed`.

---

## Two things worth knowing

**The checkpoint is written before validation runs, not after.** `SLICE_CONFIG.validate:
validatePlan` runs inside `runTypedStage`, but `runStage` has already written the slice checkpoint
by the time `validate` gets to see the parsed plan. A `validatePlan` throw does not un-write that
checkpoint — a retry against the same commit hits cache and fails the same validation
deterministically, spending zero further model calls but making zero progress, until the commit or
the prompt changes.

**Nodes 03 and 04 read the prior stage's output straight off the checkpoint file, not through the
checkpoint's own validity check.** `readPriorHandoff("seam-sweep", ...)` and
`readPriorHandoff("slice", ...)` load whatever is currently on disk for that stage and re-parse it
through the schema — they don't re-derive or re-verify it against `sha256(HEAD + prompt)` the way
`runStage`'s own cache hit/miss does. In the ordinary run this is exactly the file `runStage` just
wrote; it only matters on a hand-edited checkpoint directory or a partially-restored artifact.

---

## Loose ends in the tree

- This is the only model-spending lane with no pinned model and no tool restriction on any of its
  three stages — see the intro. Neither looks deliberate so much as simply never revisited since
  the lane was built; worth a decision either way, not a silent default.
- [`ticket-format.md`](ticket-format.md)'s `### Spec sub-issue` section — the text actually shown
  to the model as `{{TICKET_FORMAT}}` — documents `## Parent` and a `## Blocked by` section.
  `renderBody()`, the hand-coded function that actually publishes a slice, writes `## Parent PRD`
  and never writes `## Blocked by` at all (that edge is carried natively via
  `wireBlockedByEdges`/`blocked_by`, not in the body). The doc and the renderer drifted apart; the
  renderer is the one every downstream reader (lane 04's `toBuildRefusal`, lane 06's Immutability
  job) actually depends on.
