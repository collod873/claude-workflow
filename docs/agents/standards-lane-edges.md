# The standards machinery, edge by edge

The audit and ratify workflows, followed end to end. Every **node** is something that executes;
every **edge** is the payload travelling between two nodes — what it is, and who is allowed to have
read it. This is **not** a numbered lane: it does not sit on any work item's path from idea to
merge, and no ticket waits on it. It runs alongside the pipeline, on its own triggers, and improves
the standards the pipeline is judged against.

The machines are [`.github/workflows/audit.yml`](../../.github/workflows/audit.yml) (caller
[`audit-caller.yml`](../../.github/workflows/audit-caller.yml)),
[`.github/workflows/ratify.yml`](../../.github/workflows/ratify.yml) (caller
[`ratify-caller.yml`](../../.github/workflows/ratify-caller.yml)),
[`.github/workflows/ratify-on-prd-close.yml`](../../.github/workflows/ratify-on-prd-close.yml)
(caller [`ratify-on-prd-close-caller.yml`](../../.github/workflows/ratify-on-prd-close-caller.yml)),
and [`.github/workflows/ratify-release.yml`](../../.github/workflows/ratify-release.yml) (caller
[`ratify-release-caller.yml`](../../.github/workflows/ratify-release-caller.yml)). The state
machines are
[`.Workflow/agent-workflows/observations/run-audit.ts`](../../.Workflow/agent-workflows/observations/run-audit.ts)
and [`observations/run-observations.ts`](../../.Workflow/agent-workflows/observations/run-observations.ts)
for the audit half, and
[`.Workflow/agent-workflows/ratify/run-ratify.ts`](../../.Workflow/agent-workflows/ratify/run-ratify.ts),
[`ratify/ratifier.ts`](../../.Workflow/agent-workflows/ratify/ratifier.ts),
[`ratify/land.ts`](../../.Workflow/agent-workflows/ratify/land.ts),
[`ratify/prd-close.ts`](../../.Workflow/agent-workflows/ratify/prd-close.ts) and
[`observations/run-ratification.ts`](../../.Workflow/agent-workflows/observations/run-ratification.ts)
for the ratify half. The one model call in the whole apparatus that goes through
[`shared/stage.ts`](../../.Workflow/agent-workflows/shared/stage.ts) is the ratifier's; the two audit
lenses call the same `StageExec` type but bypass `runStage` entirely — see Node 02.

Payload contents below are a worked example built to the real shapes and rules. A session ends
having touched two test files in different corners of `.Workflow/agent-workflows/watchdog/`, both
asserting against a captured `console.log` line instead of the function's own return value; the
second sighting clears the two-site gate, and — once the running total of released findings crosses
the threshold — the batch is ratified as **PR #530**. In parallel, a wholly separate PRD (**#508**)
closes as delivered and rings the same door by a shorter path. None of these numbers are the
worked-example numbers used elsewhere in `docs/agents/`.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript or
shell · **[stop]** can refuse and end the run.

---

## Part one — the audit (`audit.yml`)

## Node 00 — the session-captured door · [stop]

`audit-caller.yml` `on:` · `audit.yml` `jobs.audit.if`

The caller listens for exactly one `repository_dispatch` type, `session-captured`, sent by
`.claude/hooks/session-capture-hook.mjs` at the end of every local session in this repo
([ADR-0018](../adr/0018-capture-runs-globally-the-auditor-and-the-release-run-in-thi.md): capture is
estate-wide, the auditor is not). The same dispatch also wakes `dispatch-reconcile.yml`,
`run-watchdog.yml` and `walk-home.yml` — this workflow is one listener among several, exactly the
situation [`reconcile-lane-edges.md`](reconcile-lane-edges.md) documents for its own door 2.

| | |
|---|---|
| **Passes when** | `github.event.action == 'session-captured'` |
| **Concurrency** | `audit`, global, one at a time, `cancel-in-progress: false` — a repo-scoped lens, never sharded by commit |
| **Preflight** | Checks only that `KNOWLEDGE_BASE_DEPLOY_KEY` is set, **not** `CLAUDE_CODE_OAUTH_TOKEN` — unlike `spec.yml` and `ratify.yml`, which both refuse on an empty Claude token before installing Node. If the Claude token is empty here, the run proceeds through checkout and Node install and only fails once the `claude` CLI itself is spawned |

### edge — `client_payload` · what the hook sends

```json
{"event_type": "session-captured", "client_payload": {"head": "9f14e2b7a06c3d5810e4f6b2c8a91d7305eec412"}}
```

`dispatchAudit()` (`session-capture-hook.mjs`) sends only `head` — the session's own last commit.
Nothing about which files the session touched travels on the dispatch; that lives in the session
record, read separately at Node 01.

---

## Node 01 — read the session record · [wire] [stop]

`run-audit.ts` `runAudit()`

Two git-notes fetches, then a read of the `sessions` note the hook wrote for this exact commit.

| | |
|---|---|
| **Fetches** | `refs/notes/sessions` and `refs/notes/observations` from `origin`, best-effort (`fetchNotesRef` swallows an absent remote ref) |
| **Reads** | `readSessionRecord({ head })`, hydrated against a checked-out `collod873/Knowledge-Base` corpus at `target/knowledge-base` (a private repo, deploy-keyed in by `KNOWLEDGE_BASE_DEPLOY_KEY`) |
| **Refuses when** | No session note names this exact `head` (`no-session-record`); the record's `corpusPath` doesn't resolve inside the corpus checkout (`corpus-missing`); or `record.base === record.head` — an empty range (`empty-range`) |
| **Scopes paths** | `repoScoped(record.touchedPaths)` drops anything absolute or containing `..` — the session's own transcript could in principle name a path outside this checkout; the diff at Node 02 never sees one |

Every refusal here returns `{ action: "skipped", ... }` and logs a line; nothing is posted anywhere,
because there is no issue or pull request this run is about — the tracker never learns a session
went unaudited.

### edge — `HydratedSessionRecord` · in-process object

```ts
{
  sessionId: "a1c9…",
  base: "6d31f0a",
  head: "9f14e2b",
  touchedPaths: [
    ".Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts",
  ],
  corpusPath: "sessions/2026-09-05/a1c9....md",
  spine: "The owner asked to add a regression test for the lost-dispatch counter's ..."
}
```

`spine` is the session's own transcript prose, read live off the corpus checkout — the only place in
this machinery a human's session narrative, rather than a diff, reaches a model.

---

## Node 02 — the two lenses · [model, sonnet ×2]

`observations/auditor.ts` `runProposedAuditor()` / `runAuditor()`

Both lenses run over the identical diff — `git diff base head`, restricted to `touchedPaths` — and
both are spawned with `--tools ""`: **zero tools, not a restricted set.** Neither Read, Grep nor Glob
is available; each lens sees exactly what its prompt inlines and nothing else in the repository. That
is the opposite end of the spectrum from spec lane's sweep, which gets full `Read Grep Glob` over the
whole tree.

| | |
|---|---|
| **Model** | `sonnet` (bare alias, not a dated model id) |
| **Flags** | `--no-session-persistence --strict-mcp-config --disable-slash-commands --setting-sources ""`, output as plain text |
| **PROPOSED lens sees** | `spine`, `diff` — never `CODING_STANDARDS.md` |
| **VIOLATION lens sees** | `standards` (the whole of `CODING_STANDARDS.md`), `spine`, `diff` |
| **PROPOSED hunts** | A judgement call the diff makes that a linter can't express, phrased as a rule rather than a one-off — "the same bar `/standards-pass` uses" |
| **VIOLATION hunts** | A site in the diff that breaches an **already-ratified** entry's own red flag — never proposes a new one |
| **Output grammar** | Plain `Finding: …` / `Site: …` line pairs, parsed by `parseGrammarFindings()` — not JSON, not schema-validated, not run through `runStage`. A malformed or empty reply simply yields zero findings; there is no raw-response preservation path for either lens, unlike the ratifier at Node 11 |

### edge — the PROPOSED lens's raw reply · plain text

```
Finding: A test asserts against a captured `console.log` line instead of the function's own return value.
Site: .Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts:54
```

### edge — the VIOLATION lens's raw reply · plain text

```
Finding: "Zero-grandfather rails" is violated: a new eslint rule ships with an
  `// eslint-disable-next-line` grandfathering an existing site rather than fixing it.
Site: eslint.config.js:214
```

---

## Node 03 — the two-site gate · [wire]

`observations/lenses/proposed.ts` `applyTwoSiteGate()`

PROPOSED findings only. `runObservations()` hands this call every PROPOSED finding still carried by
the **nearest** prior observations note on `base` (`loadPriorFindings()`), plus whatever this run's
lens just returned. Findings are keyed on their `finding` text; sites are deduped after
`normalizeSite()` trims each one to its first whitespace-delimited token.

| | |
|---|---|
| **Released** | `sites.length >= 2` — recomputed every run, not a one-way latch |
| **First sighting** | A brand-new finding with one site: `released: false`. It survives in the note but changes nothing downstream |
| **Second sighting** | The same finding text, a new site: `released` flips to `true` — this run's own worked example |
| **VIOLATION findings** | Never gated. `run-observations.ts` marks every VIOLATION finding `released: true` unconditionally — a breach of an already-ratified standard needs no corroboration |

### edge — `GatedProposedFinding[]` · what survives the gate

```json
[{"finding": "A test asserts against a captured `console.log` line instead of the function's own return value.",
  "sites": [".Workflow/agent-workflows/watchdog/bypass-counter.test.ts:88",
            ".Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts:54"],
  "released": true}]
```

---

## Node 04 — write the observations note · [wire]

`shared/notes.ts` `writeObservationNote()`, called through `shared/notes-sync.ts` `syncNotesRef()`

`runObservations()` itself already calls `writeObservationNote()` once, unpushed, before returning —
`syncNotesRef()`'s own `apply()` callback then calls it a second time with identical arguments, this
time inside a fetch-then-push retry loop (two attempts, `git notes add -f` each time). The first call
does nothing that survives; see *Loose ends*.

| | |
|---|---|
| **Ref** | `refs/notes/observations`, one JSON array per commit, keyed on `record.head` |
| **Retry shape** | Fetch the remote ref, re-apply, push `--no-verify`; on a `[rejected]` push, loop once more; two failures in a row throws |
| **Read back by** | `readObservations()` — which also drops any finding whose every site has gone missing from the tree at the ref it's asked about (`hasLiveSite()`), so a stale finding silently stops counting rather than being edited out |

### edge — `refs/notes/observations` · the note body at `9f14e2b`

```json
[{"finding":"A test asserts against a captured `console.log` line instead of the function's own return value.","lens":"PROPOSED","sites":[".Workflow/agent-workflows/watchdog/bypass-counter.test.ts:88",".Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts:54"],"released":true},
 {"finding":"\"Zero-grandfather rails\" is violated: a new eslint rule ships with an `// eslint-disable-next-line` grandfathering an existing site.","lens":"VIOLATION","sites":["eslint.config.js:214"],"released":true}]
```

---

## Node 05 — recompute ratification scope · [wire] [stop-free]

`shared/ratification-scope.ts` `computeRatificationScope()`

Reads every observations note between `readRatifierBase()` (the last-processed bookmark) and this
run's own `head`, sums released findings across the whole range, and asks one question.

| | |
|---|---|
| **Base** | `refs/ratifier/last`, falling back to the legacy `refs/release/last` if the new ref has never been written |
| **Trigger** | `prdClosed \|\| releasedCount >= 20` (`DEFAULT_RATIFICATION_THRESHOLD`) — a PRD close always fires regardless of count; audit's own call always passes `prdClosed: false`, so only the count can trigger it here |
| **Not due** | Returns `{ shouldRatify: false, releasedCount }` and nothing else happens — free, no comment, no dispatch |

For the worked example, this run's own two findings are the ones that push the running total from 19
to 21, crossing the threshold.

---

## Node 06 — dispatch, or don't · [wire]

`run-audit.ts` `runAudit()`

| | |
|---|---|
| **Due** | `dispatchRatificationDue(gh, { head: record.head, prdClosed: false })` |
| **Not due** | Nothing is sent; the log line still reports the count, so a red or quiet Actions run is the only visible trace either way |

### edge — `repository_dispatch` · `ratification-due`

```json
{"event_type": "ratification-due",
 "client_payload": {"head": "9f14e2b7a06c3d5810e4f6b2c8a91d7305eec412", "prd_closed": "false"}}
```

Sent via `gh api ... -f client_payload[prd_closed]=false` — a literal string, not a JSON boolean;
`run-ratify.ts`'s `main()` compares it with `=== "true"` on the way back in.

---

## Part two — the ratifier

Three workflows, one shared destination. `ratify-on-prd-close.yml` and `audit.yml` (Part one) are two
independent doors that both end by sending the same `ratification-due` dispatch; `ratify.yml` is the
one workflow that ever reads it; `ratify-release.yml` runs afterward, once the ratifier's own pull
request has been judged and merged by the ordinary lane 06 / lane 08 machinery: lane 08 rings
`ratifier-merged` when the pull request it merged carries the ratifier's title, and that ring is
what wakes the recording of what survived.

## Node 07 — the two doors in · [stop]

`ratify.yml` `jobs.ratify.if` · `ratify-on-prd-close.yml` `jobs.ratify-on-prd-close.if`

| Door | Fires on | Gate | Sends |
|---|---|---|---|
| A — audit's own dispatch | `repository_dispatch: ratification-due` | `github.event.action == 'ratification-due'` | *(this is the door `ratify.yml` itself listens on — nothing further to send)* |
| B — a PRD closing | `issues: closed` | `state_reason == 'completed' && labels includes 'prd'` | `ratify/prd-close.ts` → `dispatchRatificationDue({ head: GITHUB_SHA, prdClosed: true })` |

For the worked example's second thread: **PRD #508** closes as delivered. `ratify-on-prd-close.yml`
does not check any threshold at all — `ratifyOnPrdClose()` (`prd-close.ts`) sends the same
`ratification-due` dispatch unconditionally once the state-reason and label check pass, letting
Node 08's own recompute decide whether anything is actually due.

| | |
|---|---|
| **Concurrency, door B** | `ratify-on-prd-close-${{ issue.number }}` — per issue, unlike `ratify`'s single global group |
| **Permissions, door B** | `contents: write, issues: read` — this job only sends a dispatch; it never touches an issue body |
| **Out of scope** | Any issue close that isn't `state_reason: completed`, or lacks the `prd` label — logged, nothing sent |

### edge — `repository_dispatch` · `ratification-due`, from the PRD-close door

```json
{"event_type": "ratification-due", "client_payload": {"head": "c2a8e410f5b6...", "prd_closed": "true"}}
```

---

## Node 08 — recompute scope again · [wire] [stop-if-not-due]

`run-ratify.ts` `runRatify()`

The dispatch that woke this run is not trusted at face value: `runRatify()` calls
`computeRatificationScope()` a second time, from scratch, with the payload's own `prdClosed` and the
current `readRatifierBase()`. On the audit door this should agree with what Node 05 just computed
(same range, same base); on the PRD-close door `prdClosed: true` makes the released count
irrelevant.

| | |
|---|---|
| **Preflight** | `CLAUDE_CODE_OAUTH_TOKEN` empty → refuses before Node is installed — unlike `audit.yml`, this workflow does check it |
| **Refuses when** | `eventAction !== 'ratification-due'` (wrong door entirely — `not-a-ratification-dispatch`) |
| **Not due** | `scope.shouldRatify` is false — logs `not due: N released finding(s) in scope, no PRD close.` and stops, free |
| **Timeout** | Job: 120 minutes; the "Ratify this batch" step itself: 110 |

---

## Node 09 — collect eligible findings and apply ratification memory · [wire]

`run-ratify.ts` `releasedObservations()` · `shared/ratification.ts` `filterByRatificationMemory()`

| | |
|---|---|
| **PROPOSED findings** | Only from the **nearest** observations note in range — a finding's current `released` state, not its history |
| **VIOLATION findings** | Unfolded across every note in the whole range, deduped on `[finding, sorted sites]` — the same finding named at the same sites across several sessions counts once |
| **Ratification memory** | `readRatificationRecords()` reads every prior `refs/notes/ratifications` record in range; a finding previously `declined` is dropped **unless** it now carries a site the decline's own `sites` list didn't cover — a finding that grows a new site escapes a stale decline |

### edge — the eligible batch for this run

```ts
[
  { finding: "A test asserts against a captured `console.log` line instead of the function's own return value.",
    lens: "PROPOSED", sites: [".Workflow/agent-workflows/watchdog/bypass-counter.test.ts:88", ".Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts:54"], released: true },
  { finding: "\"Zero-grandfather rails\" is violated: ...", lens: "VIOLATION", sites: ["eslint.config.js:214"], released: true },
]
```

---

## Node 10 — nothing survived · [wire] [stop-cheap]

`run-ratify.ts`

```ts
if (surviving.length === 0) {
  advanceRatifierRef(git, repoDir, head);
  return { action: "ran", code: "nothing-to-ratify", ... };
}
```

The bookmark still advances even when nothing is ratified — a batch entirely made of declined
findings is not re-offered next time just because it produced no pull request. No Opus call is spent
reaching this stop.

---

## Node 11 — the ratifier, one finding at a time · [model, opus] [stop-per-finding]

`ratify/ratifier.ts` `ratifyOne()` · [`ratify/prompt.md`](../../.Workflow/agent-workflows/ratify/prompt.md)

Every survivor gets its own `claude` process, its own prompt render, its own commit — never a single
call deciding the whole batch. `runRatifierStage()` calls `runStage()` (unlike the two lenses), so this
is the one call in the machinery with checkpointing and raw-response preservation.

| | |
|---|---|
| **Model** | `opus` (bare alias) |
| **Tools** | Unrestricted — no `allowedTools`, no `disallowedTools` passed at all. The prompt tells it to *edit the files in this checkout*; nothing stops it reaching further |
| **Sees** | `LENS`, `FINDING`, `SITES`, the rest of the batch's own findings (`BATCH`, "for context only — you are deciding the finding above and nothing else"), and the whole of `CODING_STANDARDS.md` |
| **VIOLATION lens branch** | No decision at all: fix every site, in this checkout, and answer `violation-fix` naming the standard that was violated as `landedAs` |
| **Everything else, in order** | 1. Mechanise — author an inline ESLint rule in `eslint.config.js`, fix every site the rule flags (not only the ones listed), leave `typecheck`/`eslint`/`vitest` green. 2. Prose — append a three-line entry to `CODING_STANDARDS.md`'s own `## Standards` list. 3. Reject — change nothing, say why |
| **Lens/verdict mismatch** | `ratifyOne()` checks `isViolation !== (verdict.verdict === "violation-fix")` — a PROPOSED finding answered `violation-fix`, or a VIOLATION finding answered anything else, is a contract breach. `restoreWorkingTree()` and skip, one Opus call spent for nothing |

### edge — the model's structured reply for our VIOLATION finding

```json
{"verdict": "violation-fix", "landedAs": "Zero-grandfather rails",
 "reason": "Removed the `// eslint-disable-next-line` at eslint.config.js:214 and fixed the underlying site instead of grandfathering it."}
```

### edge — the model's structured reply for our PROPOSED finding

```json
{"verdict": "mechanise", "landedAs": "test-hygiene/no-console-capture-assertion",
 "reason": "Both sites captured console.log output and asserted on the string instead of the function's own return value; the rule flags any test assertion whose subject is a captured console call.",
 "fallback": {"name": "Assert the return value, not the console",
   "entry": "- **Assert the return value, not the console**: a test checks the function's own return value, never a captured `console.log` line.\n  Why: the console line is an implementation detail of logging, not the contract under test; a refactor that changes wording breaks the test for no functional reason.\n  Red flag: `expect(consoleSpy).toHaveBeenCalledWith(...)` standing in for an assertion on a return value."}}
```

`RATIFIER_OUTPUT`'s schema (`ratify/verdict-schema.ts`) refuses a `reject` verdict carrying `landedAs`,
refuses any non-`reject` verdict missing it, and refuses a `mechanise` verdict with no `fallback` —
all before this stage returns.

---

## Node 12 — the rule trial · [wire] [`mechanise` verdicts only]

`ratify/rule-trial.ts` `runRuleTrial()`, per [ADR-0124](../adr/0124-a-lint-rule-is-ratified-only-by-reproducing-its-own-evidence.md)

A detached worktree, checked out at `parent` — the tree **before** this finding's own fixes — with
the just-authored `eslint.config.js` copied in. The rule the model just wrote is run against exactly
the site paths the observation named, nothing else.

| | |
|---|---|
| **Reproduced** | The new rule flags every site listed, on the pre-fix tree. The `mechanise` verdict stands |
| **Missed one or more** | `restoreWorkingTree()` discards the rule and its fixes; the `fallback` entry the verdict already supplied is appended to `CODING_STANDARDS.md` instead; `kind` becomes the literal string `"prose (demoted: the rule did not reproduce its own evidence)"` |
| **Site absent from the pre-fix tree at all** | Counted as missed, same outcome |

For the worked example, the two sites are shaped closely but not identically — one captures via
`vi.spyOn(console, "log")`, the other via a raw `console.log` mock — and the authored rule's selector
only matches the first. The trial misses the second site, so this finding **demotes**:

### edge — the log line and the landed shape

```
demoted "A test asserts against a captured `console.log` line instead of the function's own
return value.": rule test-hygiene/no-console-capture-assertion flagged none of
.Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts on the pre-fix tree
```

`trial.missed` names bare paths, not `path:line` — `sitePath()` strips the numeric suffix after the
last colon before the trial ever compares against ESLint's own file-path output.

`landedAs` becomes `"Assert the return value, not the console"` (the fallback's own `name`), `verdict`
becomes the demoted string above, and the eslint-rule edits made while pursuing `mechanise` are
reverted before the fallback prose is written.

---

## Node 13 — land the batch · [wire] [stop]

`ratify/ratifier.ts` `ratifyBatch()` / `ratify/land.ts`

Each outcome commits on top of the last, chaining `parent` forward one finding at a time via
`commit-tree` — never `git commit`, so nothing is ever checked out mid-batch. Order follows
`releasedObservations()`'s own return shape: PROPOSED findings first, then unfolded VIOLATION
findings — so in this run the demoted prose entry lands as the first commit, the violation fix as
the second.

| | |
|---|---|
| **No-op verdict** | `commitWorkingTree()` returns `null` when the tree is unchanged from `parent` (identical `write-tree` hash) — the finding is `skipped`, not landed, even though a model call answered it |
| **Commit trailer** | Every landed commit carries `Machinery-Commit: true` — the line the *next* audit's `isMachineryCommit()` filters out of its own commit range, so a ratifier landing never becomes evidence for the following audit |
| **Immutable-set refusal** | `refuseImmutableSetBatch(changedFiles)` — if *any* file across the whole batch touches `vitest.config.ts` or `.github/`, the **entire batch throws**, discarding every finding this run processed, however many Opus calls it cost. This is not caught anywhere in `runRatify`; it propagates to `main()`, sets `exitCode = 1`, and fires the "Escalate a ratifier that died" step in `ratify.yml` |
| **Trunk alignment** | `alignImmutableSetWithTrunk()` fetches trunk, force-checks-out its own copies of the immutable-set paths onto the batch tip, and commits that as one more `Machinery-Commit: true` commit (`"Carry trunk's immutable set, which this batch may not edit"`) — so the ratifier's branch can never diverge from trunk on the two files it is forbidden to author |
| **PR gate** | `openRatifierPr()` refuses (throws) if `landed` is empty, if `head === base`, or if `changedFiles` is empty — never opens a pull request with nothing in it |

### edge — `gh pr create` · argv

```
gh pr create \
  --title "Ratified: standards from this batch" \
  --base main --head ratify/9f14e2b7a06c \
  --body "The audit lane's two-site gate cleared these findings; the ratifier turned each one into
the standard below. **Ratified is merged**: lane 06 judges this pull request and lane 08 merges it
like any other. To decline a standard, revert it: the revert detector writes the declined memory,
and the finding stays suppressed until it grows a new site.

## Assert the return value, not the console

Both sites captured console.log output ...

Landed as a **prose (demoted: the rule did not reproduce its own evidence)** verdict against: A test
asserts against a captured `console.log` line ...

Sites: `.Workflow/agent-workflows/watchdog/bypass-counter.test.ts:88`, `.Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts:54`

<!-- release-finding:{\"finding\":\"A test asserts ...\",\"sites\":[...],\"landedAs\":\"Assert the
return value, not the console\"} -->

## Zero-grandfather rails

Removed the `// eslint-disable-next-line` ...

Landed as a **violation-fix** verdict against: \"Zero-grandfather rails\" is violated: ...

Sites: `eslint.config.js:214`

<!-- release-finding:{...,\"landedAs\":\"Zero-grandfather rails\"} -->"

→ https://github.com/collod873/claude-workflow/pull/530
```

### edge — `repository_dispatch` · `implementation-opened`, straight out of `openRatifierPr()`

```json
{"event_type": "implementation-opened",
 "client_payload": {"pr": "https://github.com/collod873/claude-workflow/pull/530",
   "changed_files": "CODING_STANDARDS.md,eslint.config.js",
   "criteria": ["Every enabled eslint rule resolves to a definition and every CODING_STANDARDS.md entry parses to the three-line shape"]}}
```

This is the same dispatch, the same event type, and the same door that every implementer's own PR
uses — [`verify-lane-edges.md`](verify-lane-edges.md) Node 00 documents what happens to it from here:
lane 06 judges the diff, lane 08 merges it once green, with no review step of its own. `criteria[]`
carries `RATIFIER_CRITERION` (`ratify/land.ts`), a fixed sentence about the repository's own standards
machinery rather than a real ticket's acceptance criterion — and per that doc's own loose end,
nothing downstream reads it.

---

## Node 14 — advance the bookmark, retire the legacy ref, escalate on death · [wire]

`ratify.yml`, steps after the ratify step; `land.ts` `advanceRatifierRef()`

| | |
|---|---|
| **Advance** | `advanceRatifierRef()` moves the local `refs/ratifier/last` to `head` — called whether or not anything landed |
| **Publish** | A dedicated step pushes `refs/ratifier/last` to `origin`, using `secrets.ENROL_PAT \|\| github.token` for the target checkout — the ambient Actions token cannot move a ref whose range includes a workflow-file change (see commit `c71f727`: a batch untouched by `.github/` still failed to push its bookmark because the *range since the bookmark last moved* crossed an owner's own workflow edit) |
| **Retire** | A second step deletes the legacy `refs/release/last` on `origin`, `\|\| true` (never fails the job) — migrating every future run off `readRatifierBase()`'s fallback path |
| **Escalate** | On `failure()`, files a `needs-human`-labelled issue naming the run, assigned to the repo owner: *"Its findings were not decided and re-batch at the next trigger."* `audit.yml` has no equivalent step at all — an audit failure is silent past the Actions tab; a ratifier failure is not |

---

## Node 15 — `ratify-release.yml`: recording what merged · [wire] [stop]

`ratify-release.yml` `jobs.ratify-release.if` · `observations/run-ratification.ts`

Wakes on the `ratifier-merged` dispatch lane 08 rings right after `gh pr merge`, and only when the
pull request it merged carries `RATIFIER_PR_TITLE` (`integrate/integrate.ts`). It cannot wake on
`pull_request: closed`: lane 08 merges with the Actions token, and GitHub starts no workflow for
an event that token caused, so a door on the close event never opened for the machine's own merge
(ADR-0164).

| | |
|---|---|
| **Gate** | `github.event.action == 'ratifier-merged'` — the ring is the whole gate; the title check already happened in lane 08 |
| **Payload** | `client_payload.pr`, the pull request URL lane 08 merged; the job reads `number`, `body`, `mergedAt` and `mergeCommit` back from GitHub rather than trusting the ring |
| **Closed unmerged** | `mergedAt` null → logs and stops; nothing recorded (unreachable from lane 08, which rings only after a merge, but the script keeps the check) |
| **Reads** | The merged PR's own body — the same body Node 13 wrote — for `<!-- release-finding:... -->` markers, via `parseFindingMarker()` |
| **No `landedAs` on a marker** | Skipped (a declined finding, from a batch this doc never sees land a PR for, carries no marker at all) |
| **Writes** | One `RatificationRecord` per marker, `decision: "ratified"`, `reason: 'landed as "<landedAs>" in ratifier PR #<n>'`, at `MERGE_COMMIT_SHA` — into `refs/notes/ratifications`, the same ref Node 09 reads and the same ref `decline-on-revert` (Node 16) both reads and writes |

### edge — the two records this merge writes

```json
[{"finding":"A test asserts against a captured `console.log` line ...","sites":[".Workflow/agent-workflows/watchdog/bypass-counter.test.ts:88",".Workflow/agent-workflows/watchdog/lost-dispatch-counter.test.ts:54"],"decision":"ratified","reason":"landed as \"Assert the return value, not the console\" in ratifier PR #530","landedAs":"Assert the return value, not the console"},
 {"finding":"\"Zero-grandfather rails\" is violated: ...","sites":["eslint.config.js:214"],"decision":"ratified","reason":"landed as \"Zero-grandfather rails\" in ratifier PR #530","landedAs":"Zero-grandfather rails"}]
```

---

## Node 16 — adjacent, not one of the four: `decline-on-revert.yml`

`.github/workflows/decline-on-revert.yml` (caller
[`decline-on-revert-caller.yml`](../../.github/workflows/decline-on-revert-caller.yml)) ·
`ratify/revert-detector.ts` / `ratify/run-revert-detector.ts`

This workflow is not one of the four this doc was asked to profile, but
[ADR-0123](../adr/0123-the-owner-signs-by-not-reverting-and-a-revert-writes-decline.md)'s whole claim
— *the owner signs by not reverting* — is a promise this fifth, push-triggered workflow keeps.
Without it, "ratified means merged" would have no way back.

Its nodes are documented with the other four push-triggered bookkeeping machines, in
[`bookkeeping-lane-edges.md`](bookkeeping-lane-edges.md); what matters *here* is the one edge that
closes back into this doc. A `declined` record it writes lands in `refs/notes/ratifications`, the
same ref Node 15 writes and the same ref Node 09's `filterByRatificationMemory()` reads on the next
batch — so a reverted standard stops being remembered as ratified, and the finding behind it
becomes eligible again.

If our worked example's owner later deletes the `"Assert the return value, not the console"` entry
from `CODING_STANDARDS.md`, this is the workflow that notices, on the very push that removed it.

---

## What each stage may touch

| Stage | Model | Reads | Writes | Can act on the tracker/PR |
|---|---|---|---|---|
| audit's two lenses (Node 02) | sonnet, **no tools at all** | The inlined diff + spine (+ standards, for VIOLATION) — nothing else in the repo | — | — |
| audit's own dispatch (Node 06) | — | Observation notes in range | `refs/notes/observations` | One `repository_dispatch` |
| ratifier (Node 11) | opus, **unrestricted tools** | `CODING_STANDARDS.md`, the checkout at large | The working tree (rule + fixes, or a `CODING_STANDARDS.md` entry) | — |
| land (Nodes 13–14) | — | The batch's own commits, trunk's immutable set | Pushes a branch, opens a PR | Opens a PR, dispatches `implementation-opened` |
| ratify-release (Node 15) | — | The merged PR's own body, read back by `gh pr view` | `refs/notes/ratifications` | — |
| decline-on-revert (Node 16) | — | `CODING_STANDARDS.md`, `eslint.config.js`, ratification notes | `refs/notes/ratifications` | — |

Two single-job workflows here — `ratify.yml` and `implement.yml` — hold full `contents: write,
pull-requests: write, issues: write` in the very job that spends a model with unrestricted tools, for
up to two hours. That is not the split-token pattern `spec.yml`, `verify.yml` and `acceptance.yml`
all use to keep a model-spending job at `contents: read`; it matches `implement.yml`'s own shape
instead — a stage trusted to open its own pull request directly, with no review step of its own,
because lane 06 and lane 08 judge and merge it exactly like any other pull request
([ADR-0122](../adr/0122-findings-land-through-the-implementation-door-the-release-pr.md)).

---

## Where it stops

Ordered by how much has been spent when it fires.

| Cost | Where | Fires when |
|---|---|---|
| free | `audit.yml` `if:` / `ratify.yml` `if:` / `ratify-on-prd-close.yml` `if:` | Wrong dispatch action, or a closed issue that isn't a completed `prd` |
| free, one runner | `audit.yml`'s `KNOWLEDGE_BASE_DEPLOY_KEY` preflight | The secret is empty |
| free, one runner | `ratify.yml`'s `CLAUDE_CODE_OAUTH_TOKEN` preflight | The secret is empty — checked before Node install, unlike `audit.yml` |
| free, no comment | `readSessionRecord()` | No session note at `head`; an empty base/head range; the corpus path doesn't resolve |
| free | `computeRatificationScope()` (both Node 05 and Node 08) | Released count under 20 and no PRD close |
| free | Node 10, nothing survived | Every eligible finding was already declined at every site it still carries |
| 0 model calls | The two lenses | A malformed or off-grammar reply is not a refusal — it just parses to zero findings |
| 1 opus call, wasted | Node 11's lens/verdict mismatch | A VIOLATION finding answers anything but `violation-fix`, or a PROPOSED finding answers `violation-fix` |
| 1 opus call | Node 11, `reject` | Declined memory is written; no commit |
| 1 opus call + a local eslint run | Node 12, demotion | The freshly authored rule doesn't flag every site on the pre-fix tree |
| after the model, before commit | `commitWorkingTree()` returns `null` | The verdict's own edits left the tree byte-identical to its parent |
| **the whole batch, after every model call already spent** | `refuseImmutableSetBatch()` | Any file across the batch touches `vitest.config.ts` or `.github/` — the run then fails outright and files a `needs-human` issue |
| free | `openRatifierPr()`'s own guards | Nothing landed, `head === base`, or no files actually changed |
| 20 min | `audit.yml` job timeout | — |
| 110 min / 120 min | `ratify.yml` step / job timeout | — |
| 10 min | `ratify-on-prd-close.yml` / `decline-on-revert.yml` job timeout | — |
| 15 min | `ratify-release.yml` job timeout | — |

---

## Two things worth knowing

**The audit lenses cannot fail the way a schema-validated stage can.** Every model call in
`spec.ts` and the ratifier here goes through `runStage()`/`structuredOutput()`, which preserves the
raw reply to `<handoff dir>/<stage>-raw-response.txt` on a parse failure. The two audit lenses call
`exec()` directly and parse a lenient `Finding:`/`Site:` line grammar that never throws — a lens that
answers nonsense, or nothing, just produces an empty finding list. `ratifier-raw-response.txt`
exists in the tree because the ratifier is schema-validated and can genuinely fail that way; the
similarly-named `audit-and-publish-raw-response.txt` at the top of `.Workflow/agent-workflows/` is
unrelated to this machinery — `audit-and-publish` is a stage name inside lane 03's `to-tickets.ts`,
not this audit. Both files hold one placeholder line each (`the model just talked, and never called
the tool`; `not structured output at all`) rather than a real captured payload, so neither actually
shows this machinery's real response shapes; the worked-example JSON above is built from the schema
and prompts instead.

**The observations note is written twice with identical content, and the ratifications note is
written from three different workflows.** `runObservations()` calls `writeObservationNote()` once,
locally, before `run-audit.ts` calls it again inside `syncNotesRef()`'s fetch-then-push loop — the
first call is overwritten by the second before anything is pushed, so it does nothing observable
(see *Loose ends*). `refs/notes/ratifications`, by contrast, gets real, distinct writers over time:
the ratifier itself writes `declined` records inline during a batch (Node 11), `ratify-release.yml`
writes `ratified` records after a merge (Node 15), and `decline-on-revert.yml` writes further
`declined` records after the owner reverts (Node 16) — all three going through the same
`syncNotesRef()` retry shape, so two of them racing on the same push is a handled case, not a bug.

---

## Loose ends in the tree

- `runObservations()`'s own call to `writeObservationNote()` (`observations/run-observations.ts`)
  writes a git note that is immediately overwritten, unpushed, by `run-audit.ts`'s own
  `syncNotesRef()`-wrapped call with the same `commit` and the same `observations` array. The first
  call appears to do nothing that the second doesn't already do.
- `RatificationDecision` (`shared/ratification-schema.ts`) is a four-value enum —
  `ratified | declined | superseded | deferred` — but nothing in `ratify/`, `observations/`, or their
  tests ever produces a `"superseded"` or `"deferred"` record. Only `ratified` and `declined` are
  live.
- `audit.yml` never checks `CLAUDE_CODE_OAUTH_TOKEN` before spending a checkout and a Node install,
  unlike `ratify.yml` and `spec.yml`, which both refuse on it before Node is installed at all.
- `audit.yml` has no equivalent of `ratify.yml`'s "Escalate a ratifier that died" step: a failed audit
  run is visible only in the Actions tab, with no issue filed and no `needs-human` label.
- ADR-0017, the release-PR channel ADR-0122 superseded, is marked `superseded` but its own reversal
  note says its PRD-close-or-N-observations *trigger* survives inside the very files this doc
  documents (`ratification-scope.ts`, `run-ratify.ts`, `land.ts`, `prd-close.ts`) — only the "released
  as one decision" release-PR mechanism it originally described is gone. Reading ADR-0017 alone,
  without ADR-0122's own text, would suggest the trigger itself was retired too.
