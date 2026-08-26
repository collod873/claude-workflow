# The gauntlet's three hardcoded tools exist in one of nine repos

**Surveyed:** 2026-08-25 · **Status:** measured except where marked *reasoned* ·
**Researches:** [claude-workflow#80](https://github.com/collod873/claude-workflow/issues/80) ·
**Blocks:** [#82](https://github.com/collod873/claude-workflow/issues/82)

**Facts only.** This note does not decide whether `contract.json` returns or what an installer
copies. That is #82.

`bin/gauntlet` resolves `tsc`, `eslint`, and `vitest` from `node_modules/.bin` and exits 2 if any of
the three is missing. I checked that precondition against all nine target repos, then read every
repo for what it actually runs and where that command is written down. Where a suite was already
installed and cheap, I ran it and timed it.

**The three findings that move the portability decision:**

1. **Exactly one of nine repos satisfies the gauntlet's precondition today** (Lumaria), and only one
   more could ever satisfy it (crewops, after `pnpm install`). `claude-ds` is TypeScript with `tsc`
   and `vitest` and would *still* exit 2 forever: it has no `eslint` dependency, no eslint config,
   and lints with biome. The blocker is not "these repos aren't JavaScript" — it is that the third
   hardcoded tool is a vendor choice, not a check category.
2. **Only two of the six measurable suites fit the <10s turn-end budget, and both of those are the
   0.3s ones.** The three real suites are 21s, 39s, and 58s — all push-venue. Lumaria's clears the
   60s push budget with 1.85s of margin.
3. **Four repos have a `contract.json` and two of the four are already wrong about their own repo.**
   3D-Printing declares `test: null` / *"No repo-level test suite"* while `tests/test_model_search.py`
   sits in the repo and goes green in 0.30s. PWPP's declares *"~23s, verified 2026-07-31"*; it is
   39.49s today, +72% in under four weeks. A hand-written contract drifts the same way a comment does.

---

## 1. The table

| Repo | Language | Pkg mgr | Typecheck | Lint | Test | Where declared | `contract.json` | Suite wall-clock | Gauntlet-checkable |
|---|---|---|---|---|---|---|---|---|---|
| **Lumaria** | TypeScript (Next.js) | pnpm 11.7.0 | `pnpm typecheck` | `pnpm lint` | `pnpm test` | package.json scripts · `.claude/contract.json` · `.github/workflows/ci.yml` · `.claude/hooks/stop-gate.sh` | **yes** | **58.15s** (biome 0.50s, tsc 2.40s) | **yes** |
| **PWPP-Projects** | Python 3.14 | pip (`requirements.txt`, subproject only) | **none** | **none** (lint rules are pytest tests) | `python3 -m pytest -q` | root `pytest.ini` · `.github/workflows/test.yml` · `.claude/contract.json` | **yes** | **39.49s** | yes (test only) |
| **3D-Printing** | Python | **none** | **none** | **none** | `python3 -m pytest tests` — *undeclared* | nowhere; `.claude/contract.json` declares every slot `null` | **yes** (all-null) | **0.30s** (9 tests) | partial — see §3 |
| **crewops** | TypeScript (Next.js) | pnpm (lockfile; no `packageManager` field) | `pnpm typecheck` | `pnpm lint` (biome) + eslint in hooks | `pnpm test` | package.json scripts · `.husky/pre-commit` · `.lintstagedrc.json` · `.claude/hooks/stop-gate.sh` · **no CI** | no | not measured (no `node_modules`) | yes |
| **claude-ds** | TypeScript | npm (`package-lock.json`) | `npm run typecheck` | `npm run lint` (biome) | `npm test` | package.json scripts · `.github/workflows/ci.yml` | no (**no `.claude/` at all**) | not measured (no `node_modules`) | yes — but never via `eslint` |
| **Knowledge-Base** | Python 3.12 | pip (`requirements.txt`) | **none** | `scripts/lint/` — no standalone command | `python3 -m pytest scripts/tests` — **declared nowhere** | **nowhere.** No pytest.ini, no pyproject, no CI, no contract, no mention in CLAUDE.md | no | **not measured — hangs**, see §4 | **no, not as it stands** |
| **General-Repo** | none (Markdown) | npm (one devDep) | **none** | **none** | **none** | n/a — its own hook says so in prose | no | n/a | **no** |
| **Planning-System** | Python | **none** | **none** | **none** | `python3 -m pytest` | `pyproject.toml` `[tool.pytest.ini_options]` only — no CI, no CLAUDE.md mention | no | **0.30s** (57 tests, 1 red) | yes |
| **.agents/skills** | Python (stdlib) + bash + md | **none** | **none** | `bin/lint` | `for f in hooks/test_*.py; do python3 "$f" \|\| exit 1; done; bin/clone-check` | `.claude/contract.json` — the source of the convention | **yes** | lint **0.20s**, test **21.12s** | yes |

Every wall-clock in that column was measured on this machine on 2026-08-25 with `/usr/bin/time`.
"Not measured" means the toolchain was not installed and the ticket forbade installing it.

---

## 2. The precondition, repo by repo

`bin/gauntlet` lines 60–66:

```bash
bin_dir="$repo_root/node_modules/.bin"
for tool in tsc eslint vitest; do
  if [ ! -x "$bin_dir/$tool" ]; then
    echo "gauntlet: $bin_dir/$tool missing — run npm ci" >&2
    exit 2
  fi
done
```

| Repo | `node_modules` | tsc | eslint | vitest | Verdict |
|---|---|---|---|---|---|
| Lumaria | present | ✅ | ✅ | ✅ | **runs** |
| crewops | absent | dep | dep | dep | exit 2 now; would run after `pnpm install` |
| claude-ds | absent | dep | **not a dependency, no config file** | dep | **exit 2 permanently** |
| General-Repo | absent | — | — | — | exit 2 permanently |
| PWPP, 3D-Printing, Knowledge-Base, Planning-System, .agents/skills | n/a — not Node repos | — | — | — | exit 2 permanently |

`claude-ds` is the interesting row. It is a TypeScript repo with `tsc -p tsconfig.tests.json`,
`vitest run`, an `npm run verify` aggregate, and a CI job that runs typecheck → lint → test → build.
It has a linter. It is just biome, and `@biomejs/biome 2.4.8` is its only linting dependency —
there is no `eslint*` config file in the repo. The gauntlet would refuse to run in a repo that
has every check the gauntlet wants.

**Both biome-lint repos are also *dual*-linter repos in practice, in different directions:** Lumaria
runs `biome check . && eslint . --cache --max-warnings 0` as one `lint` script and CI runs them as
two separate blocking steps; crewops' `lint` script is biome-only, but the enforced surface at the
edit boundary is eslint (`.lintstagedrc.json` and `.claude/hooks/stop-gate.sh` both shell out to
`eslint --config ./eslint.config.mjs --no-config-lookup --max-warnings 0`), plus stylelint on CSS.
"Lint" is not one command in either repo.

---

## 3. Repos with nothing, or nearly nothing, to check

Three repos are the honest answer to `DESIGN.md` §11 Q4.

**General-Repo has nothing.** No test files anywhere. `package.json` is two lines of content:

```json
{
  "devDependencies": { "@ai-hero/sandcastle": "^0.5.11" },
  "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }
}
```

The repo already knows this and says so mechanically — its entire `.claude/settings.json` hook
payload is a `PostToolUse` `echo`:

> `Verify: review changed config/docs outputs directly. General is a broad workspace and does not have one shared automated verification command.`

**3D-Printing's contract says it has nothing; the repo disagrees.** Verbatim, all six slots:

```json
{
  "stop": {
    "cmd": null,
    "why": "the turn-end gate's slot (agent-skills ADR-0022). Null — no checks of any kind in this repo; see `test`."
  },
  "test": {
    "cmd": null,
    "why": "No repo-level test suite — repo is CadQuery part scripts + equipment docs. .mcp-cadquery's pytest suite tests the vendored MCP server, not this repo's work (confirmed by Collin)."
  },
  "test_one": {
    "cmd": null,
    "why": "No test suite — see `test`."
  },
  "typecheck": {
    "cmd": null,
    "why": "No typechecker — Python part scripts run ad hoc in the .mcp-cadquery venv; validity is checked geometrically, not by types."
  },
  "lint": {
    "cmd": null,
    "why": "No lint config in this repo."
  },
  "all": {
    "cmd": null,
    "why": "No full-suite green gate — part validity is checked per-part by the /build-part pipeline (geometry-validator agent), not a repo-wide command."
  }
}
```

The `why` on `test` is precise about `.mcp-cadquery` (vendored, its own `pytest.ini`, correctly
excluded). It is silent about `tests/test_model_search.py`, which tests this repo's own
`bin/model-search`, mocks all HTTP at a single transport seam, and passes:

```
9 passed in 0.05s        wall 0.30s
```

That suite fits the **in-turn** <1s budget. It is in no command, no CI, and no contract. The only
mechanical check the repo does declare is a `PostToolUse` `python3 -m py_compile` on edited `.py`
files — the same hook Planning-System has, byte-for-byte modulo one word of the error string.

**Knowledge-Base has 229 tests and no command.** See §4 — its problem is not absence.

---

## 4. Knowledge-Base: a suite that exists, is undeclared, and hangs

40 test files under `scripts/tests/`, **229 tests collected**, and the command to run them is
written down in exactly zero places: no `pytest.ini`, no `pyproject.toml`, no `.github/` directory
at all, no `.claude/contract.json`, and `grep -nEi "pytest|lint|test" CLAUDE.md` returns nothing.
The repo's only `.claude` hook is a `PostToolUse` reminder to consider `/wiki-lint` after editing
`wiki/`.

Collection is not clean either — 4 of the 40 files error out on import:

```
E   ModuleNotFoundError: No module named 'pytest_asyncio'        (test_compile_v2.py, test_routing_merger.py)
E   ModuleNotFoundError: No module named 'sentence_transformers' (test_intake_ab_parity.py)
    FileNotFoundError                                            (test_session_inject.py)
```

`sentence-transformers==2.7.0` is pinned in `requirements.txt`; `pytest_asyncio` is in no manifest
in the repo.

Ignoring those four, the remaining suite **does not terminate.** It ran past a 300s `timeout` and
did not die on SIGTERM; a second run under `timeout -s KILL 75` got 58 tests green (27% of the run)
and then blocked here:

```
scripts/tests/test_fact_level_pipeline_integration.py::test_ny_jail_fragmentation_gate
```

Wall-clock is therefore **unmeasurable, not merely unmeasured**. There is no venue in `DESIGN.md`
§06 for a check with no upper bound. *(Reasoned, not measured: I did not diagnose why that test
blocks — a live LLM or embedding call is the obvious suspect given the repo's `llm_call.py` and the
pinned `sentence-transformers`, but I did not confirm it.)*

---

## 5. Venue assignment against the §06 budgets

§06 assigns <1s in-turn, <10s turn-end, <60s on push. Sorting the six repos I could time:

| Suite | Measured | §06 venue it fits |
|---|---|---|
| `.agents/skills` — `bin/lint` | 0.20s | **in-turn** |
| Lumaria — `biome check .` | 0.50s | **in-turn** |
| 3D-Printing — `pytest tests` (9 tests) | 0.30s | **in-turn** |
| Planning-System — `pytest` (57 tests) | 0.30s | **in-turn** |
| Lumaria — `tsc --noEmit` | 2.40s | turn-end |
| `.agents/skills` — full `test` slot | 21.12s | **push** |
| PWPP-Projects — `pytest -q` (2,256 tests) | 39.49s | **push** |
| Lumaria — `vitest run` (3,360 tests) | 58.15s | **push**, 1.85s of margin |
| Knowledge-Base | **unbounded** | **none** |

**Not one full test suite in the estate fits the <10s turn-end budget except the two that are
effectively trivial** (3D-Printing's 9 tests, Planning-System's 57). Every suite that represents
real work is a push-venue check. The gauntlet's own header comment records why this was invisible
from inside the Workflow repo:

> Today every check fits every venue here — the suite is ~1.7s and typecheck ~0.7s — so `stop` and
> `push` run the same set.

That is true of this repo and of no other repo surveyed.

Two of those numbers are also non-green, which matters for anyone treating "the suite" as a
freezable baseline:

- **Lumaria:** 11 failed / 3,349 passed across 276 files. *(Reasoned: I ran `vitest run` directly
  rather than `pnpm test`, so the `pretest` codegen step did not re-run; some or all of the 11 may
  be codegen-staleness or missing-DB artifacts rather than real regressions. Not investigated.)*
- **PWPP-Projects:** 3 failed / 2,256 passed / 1 skipped / 1,868 subtests, all three failures in
  roster-pull row-shape tests (`test_centralsquare_roster_pull.py`, `test_cscloud_roster_pull.py`,
  `test_tyler_roster_pull.py`).
- **Planning-System:** 1 failed / 56 passed — `build/adapters/_signals_test.py::test_event_complexity`,
  `FileNotFoundError`.

---

## 6. The four existing contracts, verbatim

Four of the nine repos carry `.claude/contract.json`: Lumaria, PWPP-Projects, 3D-Printing, and
`.agents/skills`. 3D-Printing's is quoted in §3. The other three follow. Five repos carry none —
crewops, Knowledge-Base, General-Repo, and Planning-System each have a `.claude/` directory without
one; **claude-ds has no `.claude/` directory at all** (only an `Archived.claude/`).

### `.agents/skills` — the source of the convention

```json
{
  "stop": {
    "cmd": "bin/lint",
    "why": "the turn-end gate's check (ADR-0022): bin/lint is a handful of greps and stays sub-second. The hook harnesses take ~15s and are the `test` slot's job, run by /implement and CI, not at every Stop"
  },
  "test": {
    "cmd": "for f in hooks/test_*.py; do python3 \"$f\" || exit 1; done; bin/clone-check",
    "why": "runs every hook regression harness in hooks/, then the clone detector — too slow for `stop` (ADR-0022), so it rides `test`/`all` instead"
  },
  "test_one": {
    "cmd": null,
    "why": "no per-file runner; each hooks/test_*.py is a self-contained suite, run the whole 'test' slot"
  },
  "typecheck": {
    "cmd": null,
    "why": "no type checker configured — skills are markdown, hooks are stdlib-only python"
  },
  "lint": {
    "cmd": "bin/lint",
    "why": "every grep rule this repo has ratified, one per standards-pass slug, each commented in bin/lint with its why; the oldest forbids a bare `hooks/` reference in skill markdown (the class of bug fixed in 02a695a)"
  },
  "all": {
    "cmd": "for f in hooks/test_*.py; do python3 \"$f\" || exit 1; done; bin/clone-check || exit 1; bin/lint",
    "why": "runs 'test' (hook harnesses + clone detector) then 'lint' — the checks this repo has"
  }
}
```

Its `stop` slot is the only non-null `stop` in the estate, and its `why` names the exact tradeoff
§06 is about. Measured today: `bin/lint` **0.20s**, the `test` slot **21.12s** — the contract's own
"~15s" estimate for the harnesses is the same species of drift as PWPP's "~23s", just smaller.

### Lumaria

```json
{
  "stop": {
    "cmd": null,
    "why": "the turn-end gate's slot (agent-skills ADR-0022). Null here because Lumaria's fast check is session-scoped lint in .claude/hooks/stop-gate.sh, which the contract can't express; the global gate stays silent and the in-repo gate owns turn-end. `test` is CI's (ci.yml) and /implement's — removed from turn-end 2026-06-26 (88b03d1), and this slot is what keeps it removed"
  },
  "test": {
    "cmd": "pnpm test",
    "why": "package.json#scripts.test — vitest unit suite (pretest runs codegen)"
  },
  "test_one": {
    "cmd": "pnpm vitest run <file>",
    "why": "single-file variant of the vitest suite; bypasses the pretest codegen hook"
  },
  "typecheck": {
    "cmd": "pnpm typecheck",
    "why": "package.json#scripts.typecheck — tsc --noEmit (pretypecheck runs codegen)"
  },
  "lint": {
    "cmd": "pnpm lint",
    "why": "package.json#scripts.lint — biome check + eslint, the two-linter split per CLAUDE.md"
  },
  "all": {
    "cmd": "pnpm check",
    "why": "package.json#scripts.check — the one gate: biome + eslint + tsc + vitest + design/clone/scaffold gates"
  }
}
```

Note what the `stop` slot's `why` concedes: *"Lumaria's fast check is session-scoped lint in
`.claude/hooks/stop-gate.sh`, **which the contract can't express**."* The richest repo in the estate
has a turn-end check the five-slot schema cannot hold. Lumaria's `check` script is also not a
sequence of the other four slots — it is `concurrently` over eight commands including
`design:check`, `clone:check`, `scaffold:check`, and `design-override:tally`, four checks that have
no slot at all.

### PWPP-Projects

```json
{
  "stop": {
    "cmd": null,
    "why": "the turn-end gate's slot (agent-skills ADR-0022). Null: there is no sub-5s check — lint rules live inside the pytest suite, and the ~23s suite is CI's (test.yml) and /implement's, not every turn-end's"
  },
  "test": {
    "cmd": "python3 -m pytest -q -x",
    "why": "pytest.ini#testpaths — full suite ~23s; -x for fail-fast at the Stop gate"
  },
  "test_one": {
    "cmd": "python3 -m pytest -q <path-or-node-id>",
    "why": "pytest.ini — single file/test variant"
  },
  "typecheck": {
    "cmd": null,
    "why": "no typechecker configured — no mypy/pyright/pyproject anywhere in repo"
  },
  "lint": {
    "cmd": null,
    "why": "no standalone lint config; engine lint rules run as pytest tests (lint_engines) inside the suite"
  },
  "all": {
    "cmd": "python3 -m pytest -q",
    "why": "pytest.ini — the one true full-suite command (issue #254); verified green 2026-07-31, 23s"
  }
}
```

Measured 2026-08-25: **39.49s, and not green** (3 failures). Both halves of `"verified green
2026-07-31, 23s"` are now false.

---

## 7. Where commands are declared, counted

| Declaration site | Repos using it |
|---|---|
| `package.json` scripts | Lumaria, crewops, claude-ds (General-Repo has one unrelated script) |
| `pytest.ini` / `pyproject.toml` | PWPP-Projects, Planning-System (+ 3D-Printing's *vendored* `.mcp-cadquery`) |
| `.github/workflows/*.yml` | Lumaria, PWPP-Projects, claude-ds |
| **No CI at all** | **crewops, Knowledge-Base, General-Repo, Planning-System, 3D-Printing** (3D has only `triage.yml`) |
| `.husky/*` git hooks | Lumaria, crewops |
| `.claude/hooks/*.sh` | Lumaria, crewops |
| `.claude/settings.json` inline hook | Knowledge-Base, Planning-System, 3D-Printing, General-Repo |
| `.claude/contract.json` | Lumaria, PWPP-Projects, 3D-Printing, `.agents/skills` |
| **Nowhere** | **Knowledge-Base's 229-test suite** |

Five of nine repos have no CI. Two repos (crewops, claude-ds) declare a `verify` aggregate in
`package.json` that is a plain `&&` chain of the four slots — `pnpm typecheck && pnpm check:where &&
pnpm lint && pnpm test` and `npm run typecheck && npm run lint && npm test && npm run build`
respectively — which is the same shape as the contract's `all`, expressed in the package manager
instead. crewops' chain contains a fifth entry, `check:where` (`bash scripts/check-where-chain.sh`),
that maps to no slot.

---

## Appendix: how each number was produced

All on this machine, 2026-08-25, `pytest 9.1.1` / `python3` at `/usr/bin/python3`, timings via
`/usr/bin/time -f "%es"`.

| Number | Command |
|---|---|
| Lumaria 0.50s | `pnpm exec biome check .` — 762 files in 87ms self-reported |
| Lumaria 2.40s | `pnpm exec tsc --noEmit` (codegen not re-run) |
| Lumaria 58.15s | `pnpm exec vitest run` (codegen not re-run) |
| PWPP 39.49s | `python3 -m pytest -q -p no:cacheprovider` from repo root |
| 3D-Printing 0.30s | `python3 -m pytest tests -q` |
| Planning-System 0.30s | `python3 -m pytest -q` from repo root |
| skills 0.20s / 21.12s | `bin/lint`; then the `test` slot verbatim from its contract |
| Knowledge-Base | `python3 -m pytest scripts/tests -q` with the 4 import-error files `--ignore`d — killed at 300s (SIGTERM ignored) and again at 75s (SIGKILL) |
| crewops, claude-ds | not run — no `node_modules`, and installing was out of scope for this ticket |
