# Every assumption the reusable-workflow split broke, swept in one pass

**Surveyed:** 2026-09-02 · **Status:** read-only sweep, every BROKEN NOW item verified against
a real run or the live Lumaria tree where marked · **Researches:**
[#225](https://github.com/collod873/claude-workflow/issues/225) Part 1 ·
**Supersedes the scope of:** [#331](https://github.com/collod873/claude-workflow/issues/331)

**Facts only.** This note does not decide what to fix first. It exists because the ten commits
after #327 each fixed the instance the last red run pointed at, and three of them said in their own
message that the same shape had bitten before. This is the sweep those commits did not do.

## Why one split produced this many failures

#225 Part 1 did not add a feature. It changed three things every lane had baked in as true:

1. **Who am I.** A run reached through `uses:` is recorded against the *caller's* file and the
   caller's `name:`, and its jobs come back as `<caller job key> / <job name>`. Confirmed on run
   33649164483 here and on Lumaria's latest Verify: every job is `verify / Immutability`,
   `verify / verify`, and so on. Anything matching a workflow file name or a bare job name now
   matches nothing.
2. **Where am I.** cwd, `GITHUB_WORKSPACE` and `node_modules` are the machine's; the repository
   being acted on sits at `target/` and is named by `TARGET_WORKSPACE`. Anything that assumed the
   two were one tree, or that the target carries the machine's tooling, now reads the wrong tree or
   finds nothing.
3. **Trunk touches `.github/` a lot now.** GitHub refuses a push whose workflow files differ from
   trunk's, so any branch that lived across one of those pushes is refused for files it never
   touched (ADR-0138). Only ratify carries trunk's copy at push time.

None of the three exist on a workstation, so the gauntlet is green locally and red on runners.
`.github/` is immutable to pull requests (ADR-0053), so the whole batch had to land by hand and
skip Verify. Discovery has therefore been serial: each lane can only fail once the one before it
works.

**What Lumaria actually carries** (checked 2026-09-02 against the live tree):

| Path | Lumaria |
| --- | --- |
| `docs/adr/`, `CODING_STANDARDS.md`, `.claude/contract.json` | present |
| `clone:check` script | present |
| `bin/gauntlet`, `bin/new-adr`, `bin/close-ticket` | absent |
| `.Workflow/` | absent |
| `eslint.config.js` | absent (biome) |

## Class 1 — lane identity: file names and job names

### Broken now

| Where | What | Effect |
| --- | --- | --- |
| `integrate/integrate.ts:184` | `VERIFY_WORKFLOW_FILE = "verify.yml"` | known (#331). Empty candidate list, 10-minute poll, `unjudged`, nothing merges |
| `integrate/integrate.ts:192,195,323,330` | `IMMUTABILITY_JOB = "Immutability"`, `ACCEPTANCE_JOB = "Restore and run acceptance"` matched by `===` | **not in #331.** Jobs are now `verify / Immutability`. Fixing the file name alone still leaves lane 08 `unjudged` |
| `bin/close-ticket:272,298` | `VERIFY_WORKFLOW_FILE = "verify.yml"` | every closing record reads `Verify: unjudged`; 404 in an enrolled repo swallowed to the same |
| `bin/close-ticket:273-274,315,325` | bare job-name equality | same prefix problem as above |
| `.github/workflows/fixer.yml:194,195,202` | `jq select(.name == "Restore and run acceptance")` / `"Immutability"` over the caller run's jobs | both selects empty, step prints "nothing to fix" and exits 0. Lane 06.5 silently does nothing on every red Verify |
| `watchdog/lost-dispatch-counter.ts:41,81` | `SLICING_WORKFLOW_FILE = "to-tickets.yml"` | known (#331). Frozen page, reads the pre-split count forever |

### Latent

- `watchdog/dead-lanes.ts:124-132,189,196,217-227` groups on `run.path`, so every lane it can name is
  a `-caller.yml`, and its remediation tells the reader to actionlint the one file that is fine.
  The `newest.name === lane.path` branch can no longer fire for a broken reusable.
- `watchdog/run-watchdog.ts:132,299,304-317,334`: dead-lane signals opened before the split are keyed
  on `.github/workflows/<lane>.yml` and can never be retired, because no run will carry that path
  again.
- `watchdog/walk-home.ts:138,214,247`: tickets it files name a `-caller.yml` as the failing lane.
  Routing is by `failingPath(logTail)`, so cosmetic.
- `shared/close-ticket.test.ts:460,489,587` and `integrate/integrate.test.ts:192,524,537` fake the
  broken literals and unprefixed job names, so the suite is green while both readers are dead.
- `.claude/hooks/session-capture-hook.mjs:98` names `close-gate-reconcile.yml`, which does not
  exist. Comment only.

### The `name:` convention is split 6 / 16

Six pairs put the suffix on the reusable half (`Verify` / `Verify (reusable)`: verify, implement,
fixer, recover, review, bypass-counter). Sixteen put it on the caller (`Audit (caller)` / `Audit`,
and so on). No `workflow_run: workflows:` trigger names one of the sixteen today, so nothing is
broken, but the bare name a reader reaches for belongs to the file with no runs in every one of
those sixteen. The four live `workflow_run` triggers (`fixer-caller.yml:13`, `review-caller.yml:11`,
`bypass-counter-caller.yml:12`, `recover-caller.yml:12`) all name a caller correctly.

### Fine

No `gh workflow run` / `gh run list --workflow` anywhere; all lane-to-lane dispatch is
`repository_dispatch`, which is file-agnostic. Zero uses of `github.workflow`, `github.workflow_ref`,
`GITHUB_WORKFLOW`. All 22 `uses:` lines point at the matching reusable. `enrol/stub-set.ts:34`
globs `-caller.yml` and is correct. `recover.ts:68,89` is run-id addressed and correct.
`bypass-counter.ts:98,117` is the pattern to copy.

## Class 2 — location: machine vs target

### The rule, per ADR-0055/0132/0135 and `docs/agents/enrolment.md`

Machine at `${{ github.workspace }}` with no credential; target at `${{ github.workspace }}/target`;
`TARGET_WORKSPACE` names the target. cwd and `GITHUB_WORKSPACE` are the machine. Anything reading
or writing the repository being acted on roots at `TARGET_WORKSPACE`; lane code, prompts and
checkpoints stay at cwd. `gh` resolves `{owner}/{repo}` from `GH_REPO`, never from cwd.

### Broken now

**Invalid flag**

- `watchdog/walk-home.ts:132-139`: `gh api -R <repo> ...`. `gh api` has no `-R`. This is why the
  first real Walk home run (16:00Z today) failed. The path already expands from `GH_REPO`, and
  `walk-home.yml` sets none, so removing the flag alone would point it at the machine.

**Entrypoint honours `TARGET_WORKSPACE`; its workflow never exports it**

| Reusable file | Consequence |
| --- | --- |
| `spec.yml:172` | `spec.ts:501` falls back to cwd. Spec author and critic run in the machine checkout. Target checked out at `:139-141` and never used |
| `to-tickets.yml:217,225,236` | `to-tickets.ts:481` falls back to cwd. Seam sweep, slicer and auditor read the machine's codebase and slice tickets against it, for a spec in the caller's tracker |

Neither lane is covered by `expectMachineAndTargetCheckouts` (only fixer, recover, implement,
review call it). Of the 24 reusable files, ten export no `TARGET_WORKSPACE` at all; the other eight
of those ten work purely through `gh` under `GH_REPO` and are fine today.

**Machine tooling assumed present in the target**

| Where | What it needs | Lumaria |
| --- | --- | --- |
| `verify.yml:308` | `bin/gauntlet push` in the target root | absent. Verify cannot go green there |
| `verify.yml:327` | `npm run clone:check` | present in Lumaria, by luck of its own scripts |
| `verify.yml:294` (and `:209`) | `uses: ./.github/actions/node` with the target at root | resolves off the checked-out tree per ADR-0134's own model; no stub writes it |
| `verify.yml:231-241` | the target's own `.Workflow/.../affected-tests.ts` and `tsx` | absent |
| `shared/clone-gate.ts:588` | `<root>/node_modules/.bin/jscpd` | absent. The exact error on Lumaria's last two Verify runs |
| `integrate/integrate.ts:626`, `acceptance/land-gate.ts:133` | `<target>/bin/gauntlet` | absent |
| `shape/run-accept.ts:46,56,94` | `<target>/bin/new-adr`, writes `<target>/.Workflow/.../adr-corpus.evidence.json` | absent |
| `implement/regenerate-artifacts.ts:37-50`, `implement.ts:702`, `recover.ts:329` | regenerates `.claude/contract.json`, `adr-corpus.evidence.json`, `clone-gate.baseline.json` in the target then `git add`s them | two of three absent; `git add` fails on the pathspec and takes the implement run with it |

**Seams left at cwd inside an otherwise target-rooted entrypoint**

- `acceptance/land-gate.ts:190`: `git` passed without `-C` while `root` is the target. The baseline
  is written in the target and committed in the machine.
- `shape/run-accept.ts:91`: `git` without `-C`. `accept.ts:329-333` adds, commits, rebases and pushes
  `HEAD:main` in the machine checkout with the caller's token. The ADR it wrote sits in the target.
- `dispatch/reconcile.ts:1076`: `close-ticket ... "."` hands the machine root as the checkout every
  criterion's `check:` runs in. `dispatch-reconcile.yml` checks out the target and never exports it.
- `dispatch/reconcile.ts:761`: `spawnSync(command, { shell: true })` with no cwd, same spec check.
- `spec/collectors/map.ts:113` defaults `repoRoot` to cwd and `spec.ts:158` never passes one, so a
  map issue in the caller's tracker cites the machine's `docs/adr`.

**Target-rooted reads of files a caller may not have, unguarded**

- `observations/run-audit.ts:216`, `ratify/run-ratify.ts:120`, `ratify/run-revert-detector.ts:53`
  read `CODING_STANDARDS.md` (Lumaria has one; the next enrolled repo may not).
- `ratify/run-revert-detector.ts:50` reads `eslint.config.js` (Lumaria: biome, absent).
- `watchdog/missing-trailer-counter.ts:49` bare `readdirSync(docs/adr)`; `back-stamp-walk.ts:74-85`
  and `trailer-form.ts:93` guard the same read.

### Latent

- Precedence is not uniform: five entrypoints read `TARGET_WORKSPACE ?? GITHUB_WORKSPACE ?? cwd`
  (run-audit, run-ratify, run-revert-detector, missing-trailer-counter, back-stamp-walk); twelve read
  `TARGET_WORKSPACE || cwd`. Same on a runner, different in tests.
- `shared/stage.ts:265` keys checkpoints on the *machine's* `git rev-parse HEAD`. For shape, spec
  and to-tickets the commit that matters is the target's, so a retry at the same machine SHA against
  a moved target is an exact-match hit on a stale answer.
- `shared/stage.ts:497` and `to-tickets.ts:238,251` read prompts and `docs/agents/ticket-format.md`
  by bare relative path. Correct because cwd is the machine, unpinned by anything.
- `back-stamp.yml`, `ratify-release.yml`, `decline-on-revert.yml` set no `GH_REPO`. Fine only
  because their entrypoints make zero `gh` calls today.
- `audit.yml:123-128` hardcodes `collod873/Knowledge-Base` as the corpus every enrolled repo's audit
  hydrates from.
- Targets checked out and never used: `dispatch-reconcile.yml:109`, `run-watchdog.yml:82`,
  `lost-dispatch-counter.yml:69`, `ratify-on-prd-close.yml:74`.
- `shared/exec-seams.test.ts:101-119` covers `execFileSync` spawns that inherit env and mention
  `GITHUB_WORKSPACE`. It misses `spawnSync`/`spawn` (`capture/backfill.test.ts:62,228`,
  `shared/scrub-corpus-history.test.ts:90-112`), tests that root by argv instead of env
  (`generate-contract.test.ts:278`, `generate-corpus-fixture.test.ts:294`, `new-adr.test.ts:56,65,104`,
  `new-research.test.ts:30`, `close-ticket.test.ts:544`, `render-body.test.ts:113`), leakage of
  `GH_REPO`/`GITHUB_REPOSITORY`/`GH_TOKEN`, and is satisfied per file rather than per spawn, which is
  why `run-audit.test.ts:346-352` still passes `...process.env` through.

### Fine

integrate, implement, fixer, recover, review, acceptance, back-stamp-walk, run-ratification,
run-revert-detector, run-ratify read the root once and thread it into `git -C`, `execClaudeIn` and
every spawn. `bin/gauntlet` and `bin/clone-gate` derive their root from `BASH_SOURCE`. Every REST
path in `shared/gh-paths.ts` is `repos/{owner}/{repo}/...` and `GH_REPO` is set at job level in 18
of the reusable files. `verify.yml:381-389` (Signal the fixer) now carries `GH_REPO`.
`affected-tests.ts:20`, `ratifier.ts:26` and both hooks anchor on `import.meta.url`.

## Class 3 — trunk churn and the immutable set

### Push sites

The d4bc92e mechanism is `alignImmutableSetWithTrunk` at `ratify/land.ts:225`, with exactly one
caller, `run-ratify.ts:147`.

| Lane | Push site | Verdict |
| --- | --- | --- |
| ratify | `run-ratify.ts:145-148` | protected by the mechanism |
| implement | `implement.ts:397` | **exposed, worst case.** Plain checkout at job start, 45-minute model run, no fetch or rebase before the push |
| recover | `recover.ts:281` via `implement.ts:397` | exposed, short window |
| fixer | `fixer.ts:214` | exposed. `fixer.yml:385` rebases before the model, then the model runs |
| integrate | `integrate.ts:426-439` | exposed, seconds-wide window |
| shape/accept | `accept.ts:330-333` | protected only by an adjacent fetch-rebase-push nothing enforces |
| acceptance push-gate | `push-gate.ts:293-295` | same |
| back-stamp-walk | `back-stamp-walk.ts:123-126` | same |
| notes and bookmark refs, enrol | n/a | no tree; enrol writes under `ENROL_PAT` on purpose |

ADR-0138's own `reversal:` line already names this: "finding another answer for every lane that
later pushes a branch the same way."

### The claims gate exists at filing and is absent at dispatch

- `shared/render-body.ts:138` `validateClaimsAreMutable`, called from
  `to-tickets/slice-and-publish.ts:118`. Written for #272.
- `dispatch/reconcile.ts:439-447` delegates to `validateTicket` (`shared/ticket-shape.ts:420-453`),
  which never imports `touchesImmutableSet`. `bin/ticket_shape.py` has no such rule either.
- `watchdog/walk-home.ts:233-235` files tickets whose `Files claimed` is the failing path, with no
  check. A `.github/workflows/*.yml` failing path becomes a `to-build` ticket claiming an immutable
  file. That is how the ticket behind 7e64031 came to exist.
- So: anything filed outside slice-and-publish (the owner by hand, walk-home) reaches the
  implementer unchecked, and the refusal arrives at the push, after the run is spent.

**#331 as filed** claims `.github/workflows/integrate.yml`, `integrate-caller.yml`,
`lost-dispatch-counter.yml` and `lost-dispatch-counter-caller.yml`, and two criteria require those
edits. The implementer cannot build it. It is not dispatchable today (no `## Parent PRD`, no
`to-build`); the moment `to-build` is applied it passes `validateTicket` and the run is spent.

### Where the immutable set is spelled

Canonical: `shared/immutable-set.ts:17`. Derived correctly: `push-gate.ts:87`,
`render-body.ts:141,145`, `recover.ts:258`, `land.ts:235`. Restated by hand and pinned by a test:
`verify.yml:95`, `implement/implementer/prompt.md:50`. Restated by hand and unpinned: `land.ts:207`,
`integrate.ts:72`, `fixer/prompt.md:9`, `ratify/prompt.md:112`, `acceptance/author/prompt.md:84`
(subset only), plus ADR prose.
