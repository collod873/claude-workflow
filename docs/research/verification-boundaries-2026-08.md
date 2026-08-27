# Nothing in the pipeline gates code on tests

**Measured:** 2026-08-22 · **Unprompted:** no issue preceded this note — written from the question below, and the four decisions it sets up were still open (ADR-0072) · **Status:** measured except where marked · **Scope:** Lumaria + `mattpocock/course-video-manager` as the external reference

The question that started this: *why does Matt Pocock not regularly run CI when we run it on every
push — is ours useless overhead?* The premise turned out to be false in both directions, and the
real finding is underneath it.

**The answer: CI is not overhead. It is the only mechanism in the estate that executes the test
suite anywhere a non-agent can observe the result.** Every other test-running step in the pipeline
is prose addressed to an agent. Every mechanical step runs no tests. And CI runs after the code is
already on `main`, so it reports rather than refuses.

---

## 1. The premise was wrong: Pocock runs CI on every push

Seven of his repos have push or PR CI; four run the full test suite. `ts-reset` is the broadest
trigger in either estate:

```yaml
on:
  push:
    branches:
      - "**"
  pull_request:
    branches:
      - "**"
```

`evalite` and `total-typescript-monorepo` are bare `on: push`. `chat` runs three parallel jobs with
`cancel-in-progress`. `agent-browser` runs a Node 20/22 × 4-OS matrix. He also recommends `tsc` in
CI in writing, in *How to test your types*.

The split is by **repo type**, not philosophy:

| Bucket | Repos | CI |
|---|---|---|
| Published libraries | ts-reset, evalite, chat, agent-browser, ai-hero-cli, tt-monorepo | Full CI on push/PR, tests included |
| Content / course material | ai-hero, skills, dictionary-of-ai-coding | None. `ai-hero`'s pre-commit runs `shortlinks:update` — not lint, not tests |
| His own agent-driven app | course-video-manager | **No CI at all.** Only agent workflows on issue/PR labels |

Only the third bucket is comparable to Lumaria. Anyone reading "Pocock doesn't believe in CI" has
the wrong lesson.

## 2. What he does instead, in the one comparable repo

CVM's `.github/workflows/` has **no `ci.yml`** — only agent workflows on `issues: labeled`,
`pull_request_target: labeled`, and one cron. There is **no build, no test, no typecheck step in any
workflow YAML.**

The entire gate is `.husky/pre-commit`:

```
pnpm exec lint-staged      # prettier
pnpm run typecheck         # tsgo
pnpm run lint:boundaries   # dependency-cruiser, severity: error
pnpm run check:file-tokens
pnpm run check:no-dirname
```

**The mechanism worth stealing:** `package.json` has `"prepare": "husky"`, and every workflow runs
`pnpm install --frozen-lockfile`. So the hook **installs itself on the runner** — the agent's commits
inside CI pass the same gate as his commits on his laptop. That is how he gets fail-closed
enforcement with zero CI jobs.

Count the firings per issue: implement commits (1+), review commits (1). **Typecheck and boundaries
run mechanically 2–4× per issue. `pnpm run test` appears nowhere in the hook** — the suite and
vitest 3 both exist.

### Where his stages touch the code

| Stage | Workflow / trigger | Tests? | Commit | Push |
|---|---|---|---|---|
| Orchestrate | `agent-to-issues-prd.yml` — label | no | no | no |
| Promote | `agent-promote-queued.yml` — issue closed | no | no | no (pure bash, 3s) |
| Implement | `agent-implement.yml` — label | **prompt-only**: *"Before committing, run `pnpm run typecheck` and `pnpm run test`"* | yes, per ticket | `git push --force` |
| Write PR | `write-pr.ts` | prompt says explicitly **"NOT running tests"** | no | `gh pr create --draft` |
| Review | `agent-review.yml` — label | **prompt-only** | yes, squashed `RALPH: Review — …` | `--force-with-lease` |
| Ready | same workflow | — | — | **`gh pr ready` fires unconditionally** |
| Merge | Matt clicks it, 275/276 | **no CI on the PR** | — | — |
| Post-merge | nothing in CVM | — | — | — |

### What it costs him

- Test suite red **Jul 6 → Aug 9** — a rename left a test calling a retired noun; 41 PR comments
  said "pre-existing, fails identically on main."
- Reviews repeatedly catch **vacuous tests** (#1504: *"both tie-break tests had gone vacuous… passed
  with the hint disabled entirely"*).
- #1542 merged clean-looking, then needed **5 fix PRs the same day**, committed with `--no-verify`
  around 18 pre-existing typecheck errors on `main`.
- `fix:` is **28% of all Jul–Aug PRs.**

The prior audit's own recommendation #2, written before this question was asked: *"Put a PR-time CI
test job and branch protection in. His biggest costs trace to their absence."*

**Per-issue cost:** 4 Opus sessions, ~45 min runner wall-clock, of which the agent step is **91–98%**.
Setup is ~30s. His conclusion, and it transfers: *"Caching/build optimisation has no upside; the
lever is prompt scope, model choice, turn caps."*

---

## 3. Lumaria measured

### Test inventory — 282 files, 3,367 cases, vitest only

Playwright was deleted 2026-08-16 (`b04071f`); policy commit `2200f3f`: *"tests law goes vitest-only
— owner rejected E2E/visual twice as overhead."*

| Type | Files | Cases | Suite |
|---|---|---|---|
| Component (happy-dom + RTL) | 123 | 843 | fast |
| Unit — src | 88 | 999 | fast |
| — of which `src/**/server/**` (fake-DB) | 43 | 371 | fast |
| — pure logic / hooks / lib | 45 | 628 | fast |
| Repo-tooling (`.mjs`) | 37 | **1,172** | fast |
| — `scripts/` | 19 | 949 | fast |
| — `.claude/hooks/` | 14 | 193 | fast |
| — `bin/` | 4 | 30 | fast |
| **Fast subtotal** | **248** | **3,014** | `pnpm test` |
| Live-Postgres integration | 34 | 353 | `pnpm test:integration` |

**Zero** type-level tests, **zero** snapshots, **zero** e2e. Zero `.skip`/`.only`/`.todo`.

**35% of the suite tests our own tooling, not the product.**

### Runtimes — the number that decides everything

| Check | Local (32 cores) | In CI |
|---|---|---|
| **Full vitest** (248 files, 3,014 tests) | **72s** (56s at `--maxWorkers=6`) | `unit` job ~415s mean |
| `tsc --noEmit` (TS 6.0.3 native, 4,173 files) | **2.8s** | 58s |
| biome | 0.45s | — |
| eslint | 14.2s | — |
| `design:check` / clone-gate / scaffold-gate | 0.09s / 0.16s / 1.2s | — |
| integration (live Postgres) | 13.2s | 54s |
| **`pnpm check` — the whole gate** | **72s** | 5.8 min wall / 10.4 machine-min |

Vitest is **97% of the gate's wall clock**. Everything else together is ~19s; the fast core
(tsc + biome + design:check) is **3.4s**.

CI is 4–6× slower on identical work because GitHub's runner has ~4 cores against the workstation's
32. `--maxWorkers=6` beats the uncapped 32-worker run locally — the default is oversubscribed.

### CI configuration

`ci.yml` — 6 jobs, no matrix, all `ubuntu-latest`, `concurrency: ci-${{ github.ref }}` with
`cancel-in-progress`.

```yaml
on:
  workflow_dispatch:
  pull_request:
  push:
    branches: [main]
    paths-ignore:
      - '**/*.md'
```

Per-job medians, 10 recent runs: `unit` 415s · `build` 116s · `lint` 84s · `typecheck` 58s ·
`integration` 54s (skipped 5/10 by path gating) · `changes` 6s. **`unit` is 57% of runner-seconds
and the critical path on every run.**

Two other workflows: `license-gate.yml` (path-gated to dependency manifests, 16 runs/30d) and
`triage.yml` (`issues: opened`).

### Run counts, 30 days

| Workflow | push | PR | dispatch | issues | dynamic | total |
|---|---|---|---|---|---|---|
| CI | 72 | 12 | 1 | — | — | **85** |
| Triage | — | — | — | 141 | — | **141** |
| License Gate | 7 | 9 | — | — | — | 16 |
| Dependabot | — | — | — | — | 17 | 17 |

**`triage.yml` is the highest-frequency workflow in the repo** — 141 runs, more than CI's 85 — and
it burns subscription tokens on every opened issue. Not examined further here; flagged.

Conclusions: 191 success / 26 failure / 37 skipped / 5 cancelled. Failure rate excluding skipped:
**11.7%**.

### Cadence

**354 commits / 30 days across 11 active days** — 100 on 08-21 alone, 19 of 30 days at zero. ~4.9
commits per push, ~2.4 pushes per active day. Authors over 90d: `claude-code[bot]` 901,
`collod873` 107, `dependabot` 7 — **89% agent-authored**.

**Zero human or agent PRs since 2026-07-02.** All 9 PRs in the last 30 days are Dependabot, and 12
of the last 16 were closed unmerged. Work lands via `chore: merge drain-worker-NNN` straight to
`main`. **The `pull_request` trigger on `ci.yml` is vestigial.**

### Local hooks — there is no local gate

Husky 9.1.7 is installed. What it actually does:

| Hook | Fires when | Runs |
|---|---|---|
| `commit-msg` | always | commitlint (~200ms) |
| `pre-commit` | **only if `src/app/globals.css` is staged** | regenerates design tokens |
| `pre-push` | **only if `package.json`/`pnpm-lock.yaml` changed** | `bin/check-licenses` |
| `post-checkout` / `post-merge` | only on `src/components/ui/` changes | `bin/ui-lock lock` |

**For a normal code commit, nothing runs but commitlint.** Every real check — biome, eslint, tsc,
vitest, boundaries — is CI-only.

---

## 4. Our pipeline, stage by stage

| Stage | What runs | Mechanical? | Commit | Push |
|---|---|---|---|---|
| Worker (`/drain`) | *"the full gate runs exactly once, before your final commit"* | prose | yes, worker branch | **forbidden** |
| Foreman: merge | worker branch → drain branch | — | — | — |
| Foreman: gate §3.4 | `pnpm check` bare | prose, unobserved | — | — |
| Checker | **forbidden from re-running the suite** | — | — | — |
| `close-gate.py` | regex + arithmetic on comment text | mechanical — **runs zero commands** | — | — |
| Land §4 | merge drain → `main --no-ff`, push | nothing | — | **direct to main** |
| `ci.yml` | `pnpm test` + integration | runs — after code is on `main` | — | — |

### The chain of custody for "tests passed"

1. The worker is correctly distrusted — `WORKER-PROMPT.md`: *"a claim from you is never read as
   evidence."* Its whole output is `DONE` / `BLOCKED`.
2. So the foreman re-gates. Its gate is a shell command it runs on its own honour, with **no
   artifact anywhere** — no log, no commit trailer, no comment.
3. The checker, which exists to catch a lying worker, is told: *"**Never re-run the gate, the full
   test/check suite**, or any other whole-suite command yourself."* Its checkout has no
   `node_modules` by design. It **transcribes `{{GATE_RESULT}}` forward** as its own evidence.
4. Per #135, if the checker contradicts the foreman, **the checker is presumed wrong**.
5. `close-gate.py` accepts the record. Its own docstring: *"**A well-shaped lie passes.**"* The
   evidence regex is satisfied by the literal string `exit 0` appearing in a bullet.

Three further holes:

- The merge into the drain branch happens **before** the gate, not after.
- The final merge into `main` is **never gated** — the last `pnpm check` ran per-ticket on the drain
  branch inside the loop.
- `Closes #N` in a commit message — which Lumaria's `CLAUDE.md` instructs — closes the ticket through
  GitHub and never reaches `close-gate.py`.

The turn-end gate is silent: Lumaria's `stop` slot is `null`, so `stop-gate.py` returns immediately.
Its local replacement `stop-gate.sh` runs eslint + biome on session-edited files and carries the
comment `# Types + tests intentionally NOT run here — CI owns them`. That is ADR-0022 working as
designed, not a defect.

`ci.yml`'s header states *"Every gate is BLOCKING — a failure fails its job and must block the
merge."* There is no PR, and branch protection returns `403 Upgrade to GitHub Pro` on this private
repo. **There is no merge for it to block.**

### The enumeration

| Mechanism | Runs tests? | Can it stop code reaching `main`? |
|---|---|---|
| `stop-gate.py` (global) | No — `stop` slot is `null` in Lumaria | No |
| `stop-gate.sh` (Lumaria) | No — eslint + biome, session-scoped | No (blocks once, then hands back) |
| `post-edit-validate.py`, `ui-guard.sh`, `eslint-mirrors.mjs`, `jscpd-guard.mjs`, `validate-bash.py` | No | No |
| `close-gate.py` | No — regex on comment text | No (gates *ticket closure*, not code) |
| husky `pre-commit` / `pre-push` / `commit-msg` | No | No |
| `ci.yml` unit job | **Yes** | **No** — no PR, no protection, runs after the push |
| `/drain` §3.4, `/implement` §4, worker prompt | **Yes** | **No** — advisory prose, unobserved |

**Every row that runs tests is advisory or after the fact. Every mechanical row runs no tests.**

---

## 5. Corrections to the existing record

**`lumaria-ci-performance-2026-08-21.md` §4 — "zero flake" is wrong.** That doc examined 08-16 →
08-21 and concluded today's red is *"genuine breakage… zero flake component at all."* A
failure-by-failure pass over the full 30-day window says otherwise: **~14 of 26 failures are one
file**, `.claude/hooks/stop-gate.test.mjs`, always the same two cases
(`expected null to be 2`), failing on whether `jq` is on the runner's PATH. It passes locally. Most
of the remainder are Dependabot PRs.

Half the red is environment flake in the meta-layer — and it is the part teaching us to ignore red.
crewops ADR-0003 already named the consequence: *"a flaky gate trains `--no-verify` and is worse
than a slow one."*

**The `unit` job's ~6 minutes is a runner-speed artifact, not a suite-size problem.** The same suite
is 72 seconds locally. Sharding vitest in CI (proposed in the prior doc) buys wall clock in the one
place that is not on the critical path of anything a human or agent waits for.

---

## 6. Vocabulary

`CONTEXT.md` already defines the term precisely:

> **Gate**: Something that refuses an action at the moment it is attempted. Distinct from anything
> that reports afterward, because a gate needs no reader — only a trigger.

Applied as a test, most things called "gate" in the estate are not gates:

| Called a gate | Refuses at the moment attempted? | Verdict |
|---|---|---|
| `close-gate.py` | Yes — denies `gh issue close` | **Gate.** Of ticket closure, not of code |
| `stop-gate.sh` | Once per streak, then hands back | Partial — a nudge with a documented give-up |
| `/drain` §3.4 "Gate" | No — refuses nothing | **Not a gate.** An instruction |
| `ci.yml` ("Every gate is BLOCKING") | No — reports after the push | **Not a gate.** Telemetry |

The glossary is right and the usage drifted. This is the same finding the Pocock audit made about
his repo — *"vocabulary drift between docs and identifiers"* — pointed at ours.

**Open:** whether to add a term for the advisory kind, so the two stop sharing a word. Not decided.

---

## 7. What is not settled

Four decisions, none taken:

1. **Mechanical gate, or keep the honour system?** Candidate shapes, priced at measured runtimes:
   fast checks at commit (tsc + biome + design:check = 3.4s × 354 commits ≈ **20 min/month**) and
   the full gate at push (`pnpm check` = 72s × 72 pushes ≈ **86 min/month**). Both local, both zero
   Actions minutes. Alternatives: full gate at push only; restore PRs + branch protection (needs
   GitHub Pro, $4/mo); or accept the honour system.
2. **What breaks when `main` is red?** Whether Lumaria is deployed with real users or pre-release
   with one consumer. Unanswered, and it sizes everything above.
3. **The tooling tests.** Fix the `jq` dependency, split the 1,172 `.mjs` tooling tests onto their
   own trigger, or both.
4. **Scope.** Prove it in Lumaria first, or write the ruling for the estate now.

## 8. Unverified

- **Do implementers run the full suite repeatedly during `/drain` and `/implement`?** The prose says
  once (`WORKER-PROMPT.md`: *"the full gate runs exactly once, before your final commit"*;
  `/implement` §4: *"Gate once"*), and drain workers are told never to `pnpm install` in their
  worktree — which means they arguably **cannot** run the full gate there at all. The owner's
  observation is that long test runs happen constantly anyway. **Not measured.** Verifiable from
  session transcripts (`~/.claude/projects/*/`, subject to the 30-day prune) by counting bare
  `vitest run` / `pnpm check` invocations per worker session against per-ticket commit counts. This
  matters: if agents are re-running a 72s suite many times per ticket, the inner-loop cost dwarfs
  anything CI does.
- **Whether `/drain` foremen actually run step 4 in practice.** No log, no trailer, no comment — the
  closing record's `— MET: pnpm check exit 0` bullet is the only trace, and it is text the checker
  was handed rather than text produced by observing a run. Not auditable retrospectively.
- **Whether `concurrently -g` propagates a `vitest` failure to a non-zero exit** from `pnpm check`.
  Default `--success=all` implies yes; not empirically confirmed.
- **Branch protection configuration.** The API 403s on this plan, so "unavailable" is established
  but "none is set" could not be read directly.

## Method

Lumaria test counts from the runner, not grep (3,367 vs a naive 2,649 — 31 `it.each` blocks).
Runtimes are `time` on a warm tree, 32-core WSL2. CI figures from
`gh api --paginate repos/collod873/Lumaria/actions/runs` over 2026-07-23 → 08-22 (259 runs, inside
the 1,000-result cap, so exact); per-job durations sampled across 10 recent runs. Pocock figures
from raw workflow YAML and `package.json` on `main` for each repo, plus
`mattpocock-agent-pipeline-audit-2026-08-21.md`. Pipeline tracing from `~/.agents/skills/` SKILL.md
files, `hooks/*.py`, `CHECKER-PROMPT.md`, and Lumaria's `.claude/contract.json` and `.husky/`.
Actions billing was deliberately not pursued: `/users/{u}/settings/billing/actions` returns HTTP 410
(endpoint removed) and `/actions/runs/{id}/timing` returned `total_ms: 0` on all 40 sampled runs.
