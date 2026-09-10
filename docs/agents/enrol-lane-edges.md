# The enrol machinery, edge by edge

The enrol machinery, followed end to end. Every **node** is something that executes; every
**edge** is the payload travelling between two nodes — what it is, and who is allowed to have read
it. This is machinery, not a numbered pipeline lane, and the difference is not cosmetic: nothing
here sits on a work item's path from idea to merge, there is no issue riding through it, and it
holds no one kind of judgement the way [`CONTEXT.md`](../../CONTEXT.md) defines a Lane. What it
does instead is put the lanes themselves — as callers — into a second repository, and keep that
repository's tracker, settings and secrets level with this one. See
[`enrolment.md`](enrolment.md) for the why; this file is its edge-by-edge companion.

The machine is [`.github/workflows/enrol.yml`](../../.github/workflows/enrol.yml). The state
machine is [`.Workflow/agent-workflows/enrol/`](../../.Workflow/agent-workflows/enrol/) — four
files (`enrol.ts`, `stub-set.ts`, `labels.ts`, `secrets.ts`) and their tests, no prompt, no model.
Structurally this is the odd one out among every workflow this repository ships: it is one of only
two files with **no caller stub** of its own (the other is `walk-home.yml`, node 09 below) — every
enrolled repository runs the lanes this machine ships, and none of them enrols anyone else
(`enrolment.md` around line 9 and again around line 114). It runs only in this repository, on a
push to `main` that changes the stub set, or by hand via `workflow_dispatch`.

**Worked example.** `collod873/kestrel`, a second repository, has just been tagged
`gh repo edit collod873/kestrel --add-topic claude-workflow-enrolled` and `enrol.yml` dispatched by
hand for its first pass (`enrolment.md`'s own instructions for a new repository — the topic change
itself is invisible to this machine). Machine SHA
`f2c9a1e8b7d4c3f2a1e0d9c8b7a6f5e4d3c2b1a0`. Kestrel carries none of this repository's 22
`*-caller.yml` stubs yet, none of its labels, `can_approve_pull_request_reviews` off (the default
on every new repository), and neither of the two secrets the lanes spend today. Nodes 04–07 bring
all four current.

Legend: **[wire]** deterministic TypeScript or shell · **[stop]** can refuse and end the run, or
end this one repository's pass, without ending the others. Nothing in this machinery spends a
model call.

---

## Node 00 — the trigger · [stop]

`enrol.yml` `on:`

Two doors, both cheap: a push to `main` whose diff touches
`.github/workflows/*-caller.yml`, or a manual `workflow_dispatch`. There is no `if:` narrowing
either door further — unlike `spec.yml`'s sender check, there is nobody to distrust here: only
someone who can push to this repository's `main`, or run a dispatch by hand, can reach this job at
all.

| | |
|---|---|
| **Door 1** | `push`, `branches: [main]`, `paths: [".github/workflows/*-caller.yml"]` — a push that never touches a caller stub allocates no runner |
| **Door 2** | `workflow_dispatch` — the only way to force a first pass over a repository that just gained the topic (`enrolment.md`, *Enrolling a new repository*) |
| **Concurrency** | `group: enrol`, `cancel-in-progress: false` — a second push queues behind the first rather than racing it |
| **Permissions** | `contents: read`, declared at the workflow level (there is only the one job) — irrelevant to every write this job actually makes, because every one of them goes out through `ENROL_PAT`, a separate credential, never the job's own `GITHUB_TOKEN` |
| **`ENROL_PAT`'s scope** | Bound only to the one step that runs `enrol.ts`, as `GH_TOKEN`. The `Checkout` step above it checks out this repository under the job's own default token, never `ENROL_PAT` — that credential is reserved for reaching *outward*, the same separation a caller stub relies on when it checks out this repository with no credential at all because it is public ([ADR-0132](../adr/0132-a-caller-checks-out-the-machine-with-no-credential-at-all-be.md)) |
| **Timeout** | 20 minutes |

### edge — `env` · what the one spending step receives

```
GH_TOKEN: ${{ secrets.ENROL_PAT }}
CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
KNOWLEDGE_BASE_DEPLOY_KEY: ${{ secrets.KNOWLEDGE_BASE_DEPLOY_KEY }}
```

`GH_TOKEN` is what every `gh` call inside `enrol.ts` authenticates as — write-scoped to every
enrolled repository. The other two are not consulted by this job's own logic at all; they exist
here only so `process.env` carries a value to hand onward at node 07. A lane that starts spending a
third secret needs a fourth line added here by hand — `secrets.ts`'s scan finds the new name on the
next push, but GitHub Actions has no API letting a job read a secret's value without being handed
it by name first (`enrolment.md`).

---

## Node 01 — what this repository has to give · [wire] [stop]

`enrol.ts:329` (`runEnrol`, its first three reads)

Three reads, no network write yet, each feeding one of the four writes below. The first can end the
whole run before a single repository is touched.

| | |
|---|---|
| **`readStubSet(workflowsDir)`** | Globs `*-caller.yml` directly under `.github/workflows`, sorted. **Refuses** — throws — if the glob is empty: *"enrolling an empty set would delete every stub in every enrolled repository."* Nothing downstream runs. |
| **`readLabels(gh, machineRepository)`** | This repository's own live labels — `repos/{machine}/labels`, paginated — feeds node 05. Read once, not per target. |
| **`derivedSecretNames(workflowsDir)`** | Scans every file under `.github/workflows` (not only the stubs) for `secrets.<NAME>` references, drops `GITHUB_TOKEN` (ambient everywhere already) and drops `OUTWARD_CREDENTIAL` itself (`"ENROL_PAT"` — the one name this scan may never propose, however this lane is called, per `registration.test.ts`). Feeds node 07. Read once. |

### edge — `Stub[]` · the shipped set, worked example

```
readStubSet(".github/workflows") →
  [{name:"acceptance-caller.yml", content:"...", sha:"…"}, …,
   {name:"verify-caller.yml", content:"...", sha:"…"}]   // 22 entries, sorted
```

### edge — the refusal · thrown, not returned

```
Error: no *-caller.yml stubs found in .github/workflows: enrolling an empty set would
delete every stub in every enrolled repository
```

`blobSha()` hashes each stub exactly the way git hashes a blob
(`sha1("blob " + byteLength + "\0" + content)`), so a stub that already matches the target compares
equal to what GitHub's own contents API reports, with no extra round trip.

---

## Node 02 — `enrolledRepositories` · [wire]

`enrol.ts:81`

The whole enumeration mechanism, and the reason there is no `bin/install`
([ADR-0133](../adr/0133-enrolment-is-a-repository-topic-and-an-enrol-lane-writes-stu.md)): no file
on either side names a target repository. This call is it.

### edge — the search · argv and result

```
gh api --paginate 'search/repositories?q=topic:claude-workflow-enrolled&per_page=100' \
  --jq '.items[].full_name'

→ collod873/claude-workflow
  collod873/kestrel
  collod873/aurelia
```

A stale or over-broad topic silently enrolls a repository — the topic decides, not the token's own
selection (ADR-0133's accepted cost).

---

## Node 03 — the machine skips itself · [wire] [stop]

`enrol.ts:344`

One string comparison, before any `gh` call against that name.

| | |
|---|---|
| **Fires when** | `repository === machineRepository` |
| **Why it can carry the topic at all** | Nothing stops the machine's own repository from being tagged by accident; this is the backstop, not the topic query |
| **Outcome** | `{ code: "skipped", why: "the machine does not enrol itself" }` — no `gh` call naming that repository is ever made |

`collod873/claude-workflow` never reaches this line in the worked example; only `collod873/kestrel`
does, and it is not itself.

---

## Node 04 — the stub commit · [wire] [stop]

`enrol.ts:266` (`syncStubs`) → `stub-set.ts:41` (`planFor`) → `enrol.ts:135` (`commitPlan`)

The first of the four writes, and the only one that can leave a repository unchanged with **zero**
API calls beyond the diff itself.

| | |
|---|---|
| **Reads** | The target's default branch (`repos/{repo}` → `.default_branch`) and its live `.github/workflows` listing (name + sha per file) |
| **Diffs** | `planFor(stubs, remote)`: `remoteStubs()` lists every file under the target's `.github/workflows`, but `planFor` narrows that to `owned` — only names ending `-caller.yml` — before comparing. A shipped stub whose sha already matches → `unchanged`; anything else shipped → `writes`; an `owned` name this pass no longer ships → `deletes`. **A file outside the glob (`their-own-ci.yml`) is never even a candidate for `deletes`**, however stale |
| **Empty plan** | `writes.length === 0 && deletes.length === 0` → `code: "current"`, no commit, no `git/ref` read even attempted |
| **No commit to build on** | `git/ref/heads/{branch}` 404s (a brand-new, empty repository) → `code: "skipped"`, `why: "{branch} carries no commit to build on"` — the very next push fixes this on its own |
| **Otherwise** | One commit, built from the plain Git Data API: one blob call per write, a tombstone (`sha: null`, no blob call) per delete, then one call each to read the base tree, create the new tree, create the commit, and move the branch ref |

### edge — the tree · worked example, kestrel's first pass

```json
[
  {"path": ".github/workflows/acceptance-caller.yml", "mode": "100644", "type": "blob", "sha": "b1a2…"},
  {"path": ".github/workflows/audit-caller.yml",       "mode": "100644", "type": "blob", "sha": "c3d4…"},
  … 20 more writes …
]
```

No deletes on a first pass — kestrel carries nothing under the glob yet, so `deletes` is empty and
`unchanged` is empty too.

### edge — the commit message · fixed shape, nothing reads it back

```
ci: carry 22 caller stub change(s) from collod873/claude-workflow

Written by the enrol lane, not by hand: this repository carries the enrolment topic, so the
stubs under .github/workflows/*-caller.yml are the machine's and are overwritten from it
(ADR-0133). Edit them there, never here.

Machine-Sha: f2c9a1e8b7d4c3f2a1e0d9c8b7a6f5e4d3c2b1a0
```

`Machine-Sha:` is not a load-bearing trailer the way spec's `spec-source:v1` is — no code in the
tree parses it back off a commit; it is `enrol.test.ts`'s own assertion and, otherwise, a human's
audit trail on `git log`. No pull request, no review either way — a stub is six lines with nothing
in them ([`CONTEXT.md`](../../CONTEXT.md), **Stub**), and a diff that cannot drift is exactly the
boilerplate nobody needs to look at turn by turn.

---

## Node 05 — the label sync · [wire] [stop]

`enrol.ts:224` (`syncLabels`) → `labels.ts:12` (`labelPlan`)

This repository's own label set, read live (node 01) and diffed against the target's, also read
live, name by name.

| | |
|---|---|
| **Proposes a create** | A name this repository carries that the target does not have at all |
| **Proposes a correction** | A name both carry, whose color or description differs |
| **Leaves alone** | `labelPlan(own, target)` only ever walks `own` — a name the target carries that this repository's own set does not (GitHub's stock `bug`, `enhancement`, and so on) is structurally invisible to it, never read, never compared, never a candidate for anything |
| **`own` comes from live state, not a list** | `readLabels()` at node 01 hits `repos/{machine}/labels` directly; nothing in `enrol.ts`, `labels.ts`, or a config file names a single label string. `docs/agents/pipeline-labels.md` and `docs/agents/issue-tracker.md` document the vocabulary in prose, for humans, but this sync never reads either file ([ADR-0057](../adr/0057-the-installer-derives-every-list-it-acts-on-and-overwrites-o.md)) |
| **Isolated failure** | Wrapped in its own `attempt()`; a labels-down repository still gets the ADR-0093 setting and its secrets |

### edge — `LabelChange[]` · worked example

```json
[
  {"exists": false, "label": {"name": "needs-human", "color": "d93f0b",
    "description": "Ticket stalled; a human decision or action is required"}}
]
```

That exact name, color and description come straight out of
[`shared/needs-human.ts`](../../.Workflow/agent-workflows/shared/needs-human.ts) — the one label in
this worked example whose fields are not invented for it. `createLabel` fires once for it;
`updateLabel` fires for any name kestrel already carries under a different color or description.

---

## Node 06 — the ADR-0093 setting · [wire] [stop]

`enrol.ts:233` (`setPullRequestApproval`)

One `PUT`, read back rather than trusted, because the whole reason this ADR exists is that this
setting is recorded in no file and is off on every new repository
([ADR-0093](../adr/0093-a-lane-that-opens-a-pull-request-depends-on-a-repository-set.md)).

| | |
|---|---|
| **Sets** | `PUT repos/{repo}/actions/permissions/workflow` with `can_approve_pull_request_reviews=true` |
| **Reads back** | The same endpoint, `.can_approve_pull_request_reviews` |
| **Refuses when** | The read-back is not the literal string `"true"` — the error names what it read |
| **Why it matters** | Without it, any lane here that opens a pull request on the target fails with *"GitHub Actions is not permitted to create or approve pull requests"*, on a repository whose every `permissions:` block is otherwise correct |
| **Unconditional** | Runs every pass, on every repository, whether or not the stub commit or the label sync did anything |

### edge — the read-back failure · `settingFailure`, per repository

```
Error: can_approve_pull_request_reviews read back as "false", not "true" (ADR-0093)
```

Reported as `settingFailure` against that one repository; the stub commit and the label sync for it
already happened, or already didn't need to.

---

## Node 07 — secret propagation · [wire] [stop]

`enrol.ts:255` (`propagateSecrets`)

The one write this job cannot verify landed correctly: a secret's value cannot be read back once
set, so there is no way to compare it against what is already there. Every pass writes it again,
unconditionally, and `RepositoryOutcome` has no field that could ever distinguish a fresh value from
one identical to what was already on the target.

| | |
|---|---|
| **Names come from** | `derivedSecretNames()` at node 01 — today, `CLAUDE_CODE_OAUTH_TOKEN` and `KNOWLEDGE_BASE_DEPLOY_KEY` |
| **Values come from** | This job's own `process.env`, populated straight from `enrol.yml`'s `env:` block (node 00) |
| **Refuses when** | A derived name has no value in `process.env` at all — *"this job's own environment carries no value for it; see enrol.yml's env"*. Because the missing value is the same on every repository, this failure repeats identically down the whole run rather than stopping it once |
| **Writes with** | `gh secret set {name} -R {repo} --body {value}`, once per name |

### edge — `gh secret set` · argv, worked example (values redacted)

```
gh secret set CLAUDE_CODE_OAUTH_TOKEN -R collod873/kestrel --body ***
gh secret set KNOWLEDGE_BASE_DEPLOY_KEY -R collod873/kestrel --body ***
```

`ENROL_PAT` itself is never among these argv lines, on any repository, by construction — it is
excluded before `derivedSecretNames()` ever returns, not filtered afterward.

---

## Node 08 — the report · [wire]

`enrol.ts:368` (`describeOutcome`), `enrol.ts:393` (`exitCodeFor`), `enrol.ts:428`

One line per repository, folded into the job summary, plus the run's own exit code — the only
signal a run that touched nothing wrong and a run that silently missed a repository would otherwise
share.

| | |
|---|---|
| **`exitCodeFor`** | Non-zero if **any** repository shows `code === "failed"`, or a `labelsFailure`, `settingFailure`, or `secretsFailure` on any of them — one bad axis on one repository is enough to redden the whole run |
| **Why it still visits every repository** | Failure isolation is per-write, not per-run: a run that stops at the first failing repository would leave every later one stale for a whole extra push cycle |

### edge — the step summary · worked example, one line among several

```markdown
### Enrolment: topic `claude-workflow-enrolled`

- collod873/kestrel: newcommit123, wrote acceptance-caller.yml, audit-caller.yml, … (22 in all); 0 unchanged; labels: needs-human; secrets written: CLAUDE_CODE_OAUTH_TOKEN, KNOWLEDGE_BASE_DEPLOY_KEY
```

(`outcome.wrote.join(", ")` lists every one of the 22 names in the real run; abbreviated here for
space.)

`ADR-0093 setting FAILED` or `labels FAILED` would append onto this same line, per repository, were
either write to fail — the report is one line per repository regardless of how many of the four
writes on it went red.

---

## Node 09 — the walk-home sweep · [wire] [stop]

`.github/workflows/walk-home.yml` → `.Workflow/agent-workflows/watchdog/walk-home.ts`

Not part of the same job graph, not fired by the same trigger, and not writing *into* an enrolled
repository at all — the opposite direction. It belongs in this doc because it is the second of the
two workflows with **no caller stub**, it reaches enrolled repositories through the same
`search/repositories?q=topic:…` enumeration node 02 uses, and it writes under the same `ENROL_PAT`
([ADR-0136](../adr/0136-a-caller-s-red-run-is-swept-from-here-under-enrol-pat-never.md)). Enrolment
is what gives the sweep its list; the sweep is what makes enrolment observable once a caller goes
red.

Its nodes are documented with the other two failure sweeps, in
[`recovery-lane-edges.md`](recovery-lane-edges.md#part-three--walk-home) — the door, the
enumeration, the failing step's own log, the `routeFor()` decision and the filing, with a worked
example of each route.

---

## What each stage may touch

| Stage | Reads | Writes | Under |
|---|---|---|---|
| stub commit (04) | this repo's `*-caller.yml` files; the target's workflow listing | one commit, target's default branch | `ENROL_PAT` |
| label sync (05) | this repo's own labels; the target's own labels | creates/updates labels, never deletes one | `ENROL_PAT` |
| ADR-0093 setting (06) | the target's own workflow-permissions setting | `PUT`s `can_approve_pull_request_reviews: true` | `ENROL_PAT` |
| secret propagation (07) | this job's own `process.env` | `gh secret set`, per derived name | `ENROL_PAT` |
| walk-home (09) | every enrolled repository's Actions runs and logs; `git ls-files` here | one issue, here or on the caller | `ENROL_PAT` |

Every write in this machinery, in both directions, rides the same one credential.

---

## Where it stops

Ordered by how much has run when it fires.

| Cost | Where | Fires when |
|---|---|---|
| free | `enrol.yml` `on:` | Not a push touching `.github/workflows/*-caller.yml`, and not a manual dispatch — no runner is ever allocated |
| one job, before any repository | `readStubSet` | This repository ships zero `*-caller.yml` files — refuses the whole pass rather than deleting every stub everywhere |
| one search call | node 03 | The topic search names this repository itself |
| per repository, no commit made | `syncStubs` | The target's default branch carries no commit yet to build on — `skipped`, fixed by the target's own first push |
| per repository, independent | labels / setting / secrets | Each of the three attempts its own write regardless of whether the other three, or the stub commit, succeeded |
| whole run | `exitCodeFor` | Any repository shows a failure on any of the four axes — the run still visits every repository first |
| 20 min | `enrol.yml` job timeout | The job itself is cancelled |
| 15 min | `walk-home.yml` job timeout | Its own, separate budget |

Unlike `spec.yml` or `verify.yml`, nothing here posts a comment onto a tracked issue when it
refuses — there is no issue to comment on. The report is the job summary and the exit code alone.

---

## Two things worth knowing

**Nothing here is a pull request.** Every one of the four writes is a direct commit or a direct API
call, never a branch, never a review. A stub, a label, a repository setting and a secret are exactly
the things nobody needs to look at turn by turn — the entire design this ADR chain replaces is a
human running `bin/install` by hand and reviewing nothing either.

**What enrolment buys is spent somewhere else entirely.** This machinery never reads
`.claude/contract.json` and never runs `bin/gauntlet`. What a target repository actually owes at
Verify time — the contract it carries, and the one asymmetry in it (a slot may be set to `null` to
shrink the gate; `bin/gauntlet`'s own fixed slot list means nothing in the contract can ever *add*
one) — is [ADR-0139](../adr/0139-an-enrolled-repository-is-checked-by-the-machine-s-gauntlet.md)'s
territory and [`docs/agents/venues.md`](venues.md)'s, days or months after this pass, off whatever
is already sitting on the target's own tree.

---

## Loose ends in the tree

- `ENROLMENT_TOPIC` (`"claude-workflow-enrolled"`) is defined twice: exported from `enrol.ts`, and
  again as its own private constant of the identical string in
  `.Workflow/agent-workflows/watchdog/walk-home.ts`. Neither file imports the other's copy.
- `postJson()` (`enrol.ts`) writes every git blob/tree/commit request body to a file under
  `mkdtempSync(join(tmpdir(), "enrol-"))` and never removes it — unlike `bin/gauntlet`'s own
  `trap 'rm -rf "$tmp"' EXIT`, these accumulate for the life of the runner.
- `docs/agents/enrolment.md` states plainly that `enrol.yml` "is the only place the fine-grained
  `ENROL_PAT` is referenced." `.github/workflows/ratify.yml` also names it, as a checkout-token
  fallback (`token: ${{ secrets.ENROL_PAT || github.token }}`) — non-empty only when ratify runs
  against this repository's own tree, since `propagateSecrets()` never ships `ENROL_PAT` outward to
  any enrolled repository. The claim in `enrolment.md` is contradicted by the code as it stands.
