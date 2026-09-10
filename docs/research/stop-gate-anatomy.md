# Anatomy of Lumaria's `stop-gate.sh` and its PostToolUse guards

Research for [#5](https://github.com/collod873/agent-skills/issues/5) (map [#1](https://github.com/collod873/agent-skills/issues/1)). Captured 2026-07-28.

**Question.** How does Lumaria's `stop-gate.sh` actually work, and which parts of it generalise
into a portable template that `agent-skills` can ship into PWPP?

**Primary sources.** The real files, read (not inferred) from the working clones:

- `/home/collin/Claude Projects/Lumaria/.claude/settings.json`
- `/home/collin/Claude Projects/Lumaria/.claude/hooks/stop-gate.sh` (200 lines) and `stop-gate.test.mjs` (241 lines)
- `/home/collin/Claude Projects/Lumaria/.claude/hooks/lib/session-scope.mjs` (+ `session-scope.test.mjs`)
- `/home/collin/Claude Projects/Lumaria/.claude/hooks/{decoration-rail,jscpd-guard,status-badge-guard}.sh`
- `/home/collin/Claude Projects/Lumaria/.claude/hooks/lib/{mirror.mjs,mirror.test.mjs,hook-paths.mjs,hook-log.sh}`
- `/home/collin/Claude Projects/PWPP-Projects/.claude/settings.json`, `/home/collin/Claude Projects/PWPP-Projects/pytest.ini`
- `/home/collin/.agents/skills/writing-great-hooks/SKILL.md` and `REFERENCE.md`: the rubric this is graded against

Behavioural claims marked **[probe]** were verified by executing the real hook against a throwaway
git sandbox with controlled stdin and PATH. The driver lived outside both repos; **nothing in Lumaria
or PWPP was modified**.

> ⚠ **The subject moved during this research.** `stop-gate.sh` was rewritten by a concurrent Lumaria
> session (hooks audit #556) at 20:29 on 2026-07-28, mid-investigation, from 147 lines to 200. That
> rewrite landed **three of the seven fixes this research had independently derived** against the
> earlier version: the hand-back channel, `stop_hook_active`, and a run-log. Both versions are
> discussed where the difference is instructive, because *how* the old version was wrong is the
> clearest argument for what the template must get right. All line citations are against the **current
> (post-#556)** files unless marked *pre-#556*.

---

## 1. The four hooks: event, matcher, contract, failure mode

### 1.1 `stop-gate.sh`: the blocking gate

| Axis | Value | Source |
|---|---|---|
| Event | `Stop` | `settings.json:29-35` |
| Matcher | **none**: fires on every turn end | `settings.json:30-31` (the `Stop` entry has `hooks` but no `matcher`; `Stop` takes no matcher, `REFERENCE.md:19`) |
| Timeout | **not set** → harness default 600 s | `settings.json:32-35`; `REFERENCE.md:86` |
| Contract, block path | exit `2`, message on **stderr** (the channel the harness reads at exit 2), stdout unused | `stop-gate.sh:188-193`; `REFERENCE.md:57` |
| Contract, hand-back path | exit `0` + **stdout JSON**: top-level `systemMessage` (human) and `hookSpecificOutput.additionalContext` with `hookEventName: "Stop"` (agent) | `stop-gate.sh:160-168`, `:181-185` |
| Contract, clean path | exit `0`, no output, run-log row | `stop-gate.sh:196-200` |
| Failure mode | **mixed per-dependency, and not declared**: see §1.5 | n/a |

Pipeline, in order:

1. Source the shared run-log helper, with a no-op fallback if it is missing:
   `stop-gate.sh:49-54`. `command -v hook_log >/dev/null 2>&1 || hook_log() { :; }` is the whole
   fallback, and it is the right shape: observability can never change an exit code.
2. `set -uo pipefail` (`:47`), slurp stdin defensively with `INPUT=$(cat 2>/dev/null || true)` (`:56`).
3. `cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0`: an unusable project dir is an **allow** (`:57`).
4. Session identity: `jq -r '.session_id // "nosession"'`, sanitised to `[A-Za-z0-9._-]`, keying
   `/tmp/lumaria-stopgate-<id>.count`: `:65-68`.
5. Re-entrancy: `STOP_ACTIVE=$(… jq -r '.stop_hook_active // false' …)`, `:81`, rationale at `:70-80`.
6. Linter resolution: `node_modules/.bin/<tool>` if executable, else `npx <tool>`, `:83-85`.
7. Scope: `dirty_files()` (`git diff --name-only HEAD --diff-filter=d` ∪ `git ls-files --others
   --exclude-standard`, `:96-99`) piped into `node lib/session-scope.mjs <transcript> <cwd>`
   (`:110-115`). Non-zero from that pipeline means "unknowable" → fall back to the repo-wide list
   (`:135`).
8. Lint: filter to `\.(ts|tsx|js|jsx|mjs)$`, run ESLint then Biome, appending each failure's combined
   output to `ERRORS`, `:136-142`. `tsc` and vitest were deliberately removed; CI owns them
   (`:7-10`, `:143`).
9. Circuit breaker on `ERRORS`, `:170-194`.
10. Clean stop resets the counter, logs, exits 0, `:196-200`.

### 1.2 The three PostToolUse guards

`decoration-rail.sh`, `jscpd-guard.sh` and `status-badge-guard.sh` are the *same* hook shape three
times over, 36-41 lines each, ~90% comment.

| Axis | Value | Source |
|---|---|---|
| Event | `PostToolUse` | `settings.json:19-27` |
| Matcher | `Edit\|Write\|MultiEdit` (no `Bash`, unlike the PreToolUse `ui-guard.sh` at `settings.json:10`) | `settings.json:21` |
| Timeout | not set → 600 s default | `settings.json:22-26` |
| Contract | **exit 0 always.** On a hit, stdout JSON carries `hookSpecificOutput.additionalContext` (reaches Claude) *and* a top-level `systemMessage` (reaches the human in the transcript). Silent when clean. | Declared: `decoration-rail.sh:19-21`, `jscpd-guard.sh:16-18`, `status-badge-guard.sh:15-17`. Implemented once: `lib/mirror.mjs:92-97` |
| Failure mode | **fail open, unconditionally** | `decoration-rail.sh:22-24` + bare `exit 0` at `:40`; `jscpd-guard.sh:20-21` + `:38`; `status-badge-guard.sh:19-20` + `:35`. Reinforced in node at `lib/mirror.mjs:65-69`, where `runMirror` `.catch()`es everything |

The bash file is a *wrapper only*. Its whole body is four lines (`decoration-rail.sh:32-38`,
byte-identical modulo names in the other two):

```bash
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
NODE_BIN="${DECORATION_RAIL_NODE_BIN:-node}"
if [ -n "$HOOK_DIR" ] && cd "$PROJECT_DIR" 2>/dev/null; then
  "$NODE_BIN" "$HOOK_DIR/decoration-rail.mjs" 2>/dev/null
fi
exit 0
```

Three structural ideas worth stealing verbatim:

- **Capture the script's own directory before `cd`ing** (`decoration-rail.sh:11-17` explains why):
  the *library* resolves against the hook's real location, the *scan* resolves against
  `$CLAUDE_PROJECT_DIR`. Without that split, tests pointing `CLAUDE_PROJECT_DIR` at a fixture dir make
  the hook load the fixture's (nonexistent) config. `stop-gate.sh:101-105` does the same for
  `SCOPE_LIB` and says so.
- **`2>/dev/null` on the node call plus an unconditional `exit 0`** is what makes "fail open"
  actually true rather than aspirational: a node stack trace with a non-zero exit would otherwise
  surface as a transcript error line on every edit.
- **The mirror invariant**: each guard is a *thin mirror* of a rule that already exists in
  `eslint.config.mjs` block 4c or `scripts/clone-gate.mjs`; it may never be the sole source of a rule
  (`decoration-rail.sh:5-11`, `jscpd-guard.sh:5-12`, `status-badge-guard.sh:5-11`,
  `lib/mirror.mjs:18-21`, `docs/adr/0050`). That is why the three collapsed to ~15 lines each: the
  envelope (read stdin, filter the tool, resolve the path, test scope, call a finder, bail on no
  hits, render, log, write JSON) lives once in `lib/mirror.mjs:71-98`, and a mirror declares only
  four values (finder, scope test, log filename, message) declared at `decoration-rail.mjs:33-44`).

### 1.3 Who reads which channel

Per `REFERENCE.md:19`, `:55-58`, `:62`, `:75`:

- `Stop` + exit 2 → **blocks (forces continue)**; stdout/JSON is discarded; **stderr becomes the
  message**. `stop-gate.sh:188-193` uses exactly this, and `:189` says why in one line: "exit 2 =>
  stderr IS the channel Claude reads, so this one stays on stderr."
- `Stop` + exit 0 → stderr is **dropped**. The human channel is stdout JSON's top-level
  `systemMessage` (`REFERENCE.md:62`); `additionalContext` carries the same text to the agent
  (`REFERENCE.md:75`). `stop-gate.sh:160-168` now emits both.
- `PostToolUse` + exit 0 + stdout JSON → same two audiences (`lib/mirror.mjs:92-97`).

**This is the single most valuable lesson in the whole codebase, and it was learned twice.**
`stop-gate.sh:32-37` records that an informational turn-end flagger was deleted on 2026-07-07 because
exit-0 stderr on `Stop` reaches nobody, and then, in the same paragraph, admits the `UNRESOLVED`
hand-back carried "the SAME defect until #556". A gate whose give-up message is invisible ends a red
session looking clean. Pre-#556 probe, against a hand-back:

```
exit=0  stdout=''  stderr='[stop-gate] UNRESOLVED: checks still failing after one retry; …'
```

Post-#556 probe, same input **[probe]**:

```
exit=0  stderr=''
stdout='{"systemMessage":"[stop-gate] UNRESOLVED: checks still failing after one retry; …",
         "hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"…"}}'
```

The old test asserted `stderr` contained `UNRESOLVED`, and it passed the whole time. The comment now in
`stop-gate.test.mjs:121-127` names the failure precisely: the assertion "described what the hook did
rather than what it needs to do". That is a **characterization test**, the exact trap
`writing-great-hooks/SKILL.md:54` warns against.

### 1.4 Contrast: PWPP's current PostToolUse hook

`/home/collin/Claude Projects/PWPP-Projects/.claude/settings.json:15-22` registers, on `PostToolUse`
matcher `Edit|Write`, the command:

```
echo 'Verify: use the relevant PWPP subproject workflow or check the changed docs directly. …'
```

This is the "lying echo" from `workflow-fixes.md` §1, and the reference explains why it is a no-op:
for `PostToolUse`, **plain stdout only hits the debug log**: only `UserPromptSubmit`,
`UserPromptExpansion` and `SessionStart` inject bare stdout as context (`REFERENCE.md:56`). The
message reaches neither Claude nor the human. To do what it intends it must emit
`{"systemMessage": …, "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": …}}`
That is exactly `lib/mirror.mjs:92-97`. PWPP has **no `Stop` hook at all**; its only real hook is a
`PreToolUse`/`Bash` notice with `timeout: 10` and an absolute interpreter path
(`PWPP settings.json:3-14`).

### 1.5 Failure mode, honestly stated

`stop-gate.sh` declares no overall failure mode, and it is in fact **both open and closed depending
on which dependency is missing**. All rows verified against the current version:

| Degraded dependency | Observed behaviour | Effective mode |
|---|---|---|
| `CLAUDE_PROJECT_DIR` unusable | `exit 0`, silent | fail **open** (`stop-gate.sh:57`) |
| `lib/hook-log.sh` absent | `hook_log` becomes `:` | fail **open**, correctly (`:49-54`) |
| `git` absent from PATH, broken file on disk | `exit 0`, **empty stderr, empty stdout** **[probe]** | fail **open, silently** |
| `node` or `lib/session-scope.mjs` absent | falls back to the repo-wide dirty scan (`:110-115`, `:135`) | fail **closed-ish**: strictly *more* files linted, so it can never turn a block into a pass (`:29-30`) |
| `eslint`/`biome`/`npx` absent | `xargs: npx: No such file or directory` → non-zero → counted as a violation → **blocks** **[probe]** | fail **closed** |
| `/tmp` unwritable | counter pinned at 0; pre-#556 that meant blocking **every** turn, "measured at 8/8 consecutive blocks" until the harness force-released (`:74-78`). Now `stop_hook_active` releases it | fixed by #556 |
| `jq` absent | session id collapses to the literal `nosession` (`:65-66`) **and** the hand-back falls back to the dead stderr channel (`:165-166`) | fail **open in a way that breaks the breaker**, see §3.3 |

Probe transcript for the two rows still open:

```
--- F degraded: PATH without node/npx/jq (real checks, dirty bad.ts)
exit=0
stderr='[stop-gate] UNRESOLVED: checks still failing after one retry; …
         ESLINT VIOLATIONS:\nxargs: npx: No such file or directory\n\n…'
   # note: UNRESOLVED on stderr, i.e. invisible, the jq-less fallback at :165-166
   # and this was the FIRST failure for this session id; see §3.3

--- G degraded: git absent from PATH (dirty bad.ts on disk)
exit=0  stdout=''  stderr=''
```

The `git`-absent row matters most for a portable template: `dirty_files()` swallows both git
invocations with `2>/dev/null` (`:97-98`), so "git is broken" and "nothing changed" are the same
observation, and the gate passes without a word. `writing-great-hooks/SKILL.md:44` demands the failure
mode be "a deliberate choice, not a default"; here it is a per-dependency accident.

---

## 2. Session scoping: the part carrying most of the design weight

`lib/session-scope.mjs` exists because the previous scope was a lie. `stop-gate.sh:14-18` and
`lib/session-scope.mjs:5-12` both record it plainly: the header used to claim changed-file scoping,
but `git diff HEAD` + `git ls-files --others` are *repo*-wide, so a **parallel session's in-flight
files blocked this session's turn-end, three times, in the session that filed #554**.

The replacement derives scope from the transcript, from two signals in one pass
(`lib/session-scope.mjs:52-92`):

1. `touched`: every `Edit`/`Write`/`MultiEdit` `file_path`, made repo-relative via `realRelative`,
   dropping anything outside cwd or under `node_modules/` (`:78-83`).
2. `commands`: every `Bash` `command` string (`:84-87`), used to recover the *Bash-redirect window*:
   `echo … > src/foo.ts` never produces a tool `file_path`, but the path appears literally in the
   command.

`scopeFiles` (`:105-115`) then takes `touched ∩ exists-on-disk`, plus any git-dirty file whose
relative or absolute path is a literal substring of a Bash command this session ran. Three properties
fall out, each deliberate and each documented:

- **`git commit --no-verify` is genuinely covered**: the `touched` term is *not* intersected with
  git's dirty set, so a file the session edited then committed away is still linted (`:100-104`).
- **The Bash recovery can only widen** the set back toward the old repo-wide behaviour, never silence
  a file (`:24-27`).
- **The known gap is stated, not papered over**: a Bash command that writes files it does not *name*
  (a generator like `bin/new-slice foo`) is unattributable and falls outside the scope
  (`stop-gate.sh:26-28`, `lib/session-scope.mjs:29-33`).

The exit-code contract is the subtle bit worth copying: **empty output with exit 0 is a real answer**
("this session changed nothing → lint nothing"); only a **non-zero exit** means "unknowable, fall
back" (`lib/session-scope.mjs:117-126`, consumed at `stop-gate.sh:108-115`). Keeping those two cases
in the exit code rather than in the output is what stops "no transcript" from silently reading as
"nothing to lint".

Two incidental portability lessons, both already paid for in Lumaria:

- `lib/session-scope.mjs:139-144` uses `pathToFileURL(process.argv[1]).href` rather than
  `` `file://${argv[1]}` `` for its direct-invocation guard, because **the repo path contains a
  space** (`/home/collin/Claude Projects/…`): the naive form leaves the space raw while
  `import.meta.url` percent-encodes it, so the comparison never matches and the CLI silently does
  nothing. Both consuming repos live under `Claude Projects/`.
- `hook-paths.mjs:6-17` `realpathSync`es both sides before `path.relative`, because the wrapper's
  `cd "$CLAUDE_PROJECT_DIR"` resolves symlinks while the `file_path` the harness hands the hook does
  not (on macOS `$TMPDIR` is itself a symlink, so every test sandbox hits this).

---

## 3. The circuit breaker

### 3.1 How it works

```
MAX_BLOCKS=1                                     # stop-gate.sh:61, hardcoded
COUNT_FILE=/tmp/lumaria-stopgate-<session>.count # stop-gate.sh:68, fixed /tmp, not $TMPDIR
```

On a failure (`stop-gate.sh:170-194`): read the counter (non-numeric contents coerced to 0 at `:173`),
increment, write back. If `COUNT > MAX_BLOCKS` **or** `stop_hook_active` is true (`:177`), delete the
counter and `exit 0` with the `UNRESOLVED` hand-back; otherwise `exit 2` with `BLOCKED`. A clean stop
deletes the counter (`:197`).

So the counter is a **consecutive-failure streak counter**, not a per-session budget. Probe:

```
I1 first forced fail   -> exit=2, 'BLOCKED …',              count file = "1"
I2 second forced fail  -> exit=0, stdout JSON 'UNRESOLVED', count file = ABSENT
I3 third forced fail   -> exit=2, 'BLOCKED …',              count file = "1"   # breaker re-arms
```

The breaker re-arms after every hand-back and every clean stop. That is a real design decision: the
agent gets one forced retry *per streak*, so a session that fixes one violation and later introduces
another is still gated, but a persistently-failing agent alternates block / hand-back / block /
hand-back indefinitely rather than ever being permanently released.

Two anti-tamper choices are explicit and worth keeping:

- `MAX_BLOCKS` is hardcoded, "no env knob the agent could flip under pressure to weaken its own gate"
  (`:59-60`).
- The count file is at a **fixed `/tmp` path, not `$TMPDIR`**, "so the agent can't redirect or reset
  it" (`:63-64`).

### 3.2 How it avoids the Stop-hook loop: belt *and* braces

The documented mechanism is `stop_hook_active` on stdin, "true once this hook already blocked:
check it to avoid loops" (`REFERENCE.md:49`), listed as an audit requirement at
`writing-great-hooks/SKILL.md:84`. The harness also force-releases a `Stop` hook after **8 consecutive
blocks** (`REFERENCE.md:87`), so no hook can hard-wedge a session forever.

**Pre-#556, Lumaria checked neither**: it used the persisted counter alone, on the argument that the
counter is strictly stronger. That argument is half right, and the current header states the whole of
it (`stop-gate.sh:70-80`):

- The counter is stronger **at the centre**: `stop_hook_active` answers "am I inside a
  block-triggered continuation right now?", which resets as soon as the agent produces a normal turn.
  A file counter survives across turns, so fail → retry → fail is recognised as *the same* unresolved
  failure, exactly what `MAX_BLOCKS=1` bounds. `stop_hook_active` alone permits block → talk → block
  → talk up to the harness's 8.
- The counter is weaker **at the edge**: it is a file, its write is `|| true` (`:175`), so anything
  making `/tmp` unwritable "silently pins COUNT at 0 and every stop blocks, measured at 8/8
  consecutive blocks, released only by the harness's own force-release" (`:74-78`).

The resolution, and the rule the template should carry, is at `:79-80`: "`stop_hook_active` arrives
on stdin and cannot fail that way, so the two together degrade where either alone traps." **Check
both.** The `||` at `:177` is the entire implementation.

### 3.3 A real hole, still open: `nosession` collapses every session onto one counter

`stop-gate.sh:65-66` falls back to the literal string `nosession` when `jq` fails or `session_id` is
absent, so the counter becomes `/tmp/lumaria-stopgate-nosession.count`, **shared by every session and
every repo on the machine that installs this hook**. Because the budget is one block, the *second*
session to fail is handed back without ever being blocked. Reproduced directly (jq lives in
`/home/collin/bin` here, so a hook under a minimal PATH genuinely loses it):

```
jq on the degraded PATH: ABSENT
session AAAA, 1st failure -> exit 2, '[stop-gate] BLOCKED …',    count = '1'
session BBBB, 1st failure -> exit 0, '[stop-gate] UNRESOLVED …', count = ABSENT
```

Session BBBB's *first* failure was silently released. Worse, in that same jq-less state
`handback_note` falls through to `printf … >&2` (`:165-166`), the channel #556 just established as
dead, so the release is also invisible. The comment calls that "no worse than the old behaviour",
which is true and still means: **when `jq` is missing, the gate loses both its identity and its
voice**. Severity: **FN** (a missed block) in the `writing-great-hooks/SKILL.md:66` taxonomy.

One smaller counter issue: **no garbage collection.** A session that blocks once and is then abandoned
leaves its counter at `1` in `/tmp` forever (22 stale `lumaria-stopgate-*.count` files were present on
this machine during probing). Harmless for unique ids, but `--resume` preserves the session id, so a
resumed session's stale `1` means the next failure hands back *without ever blocking*.

---

## 4. Lumaria-specific vs structural

### 4.1 Structural: survives the swap to `python3 -m pytest -q`

Everything below is domain-free and is what a portable template should ship:

1. **The event/contract skeleton.** `Stop`, no matcher, stdin slurped defensively, and a *three-path*
   contract with a distinct channel per path: block = exit 2 + stderr; hand-back = exit 0 + stdout
   JSON (`systemMessage` + `additionalContext`); clean = exit 0 + silence.
   `stop-gate.sh:56-57`, `:160-168`, `:188-200`.
2. **The block-once-then-hand-back breaker**, in full: hardcoded `MAX_BLOCKS`, session-keyed counter
   outside the agent's reach, non-numeric coercion, `stop_hook_active` as the second release
   condition, delete-on-handback, delete-on-clean-stop. `:59-68`, `:70-81`, `:170-197`. Nothing in it
   mentions a language.
3. **The two-message vocabulary**: `BLOCKED: fix the violation (never weaken a rail to get
   unblocked)` vs `UNRESOLVED: checks still failing after one retry; stopping clean for human review`
   (`:181`, `:190`). The anti-rail-weakening clause is a prompt-level rail worth porting verbatim.
4. **The scope/fallback contract**: a scoping step that may answer "empty (a real answer)" or
   "unknowable (fall back)", where the fallback is *stricter* so it can never convert a block into a
   pass. `:29-30`, `:108-115`, `lib/session-scope.mjs:117-126`.
5. **Session attribution from the transcript.** `lib/session-scope.mjs` is pure transcript + git
   parsing; the tool names it keys on (`Edit`/`Write`/`MultiEdit`/`Bash`) are harness-level, not
   project-level. It ports to PWPP unchanged apart from the extension filter.
6. **The wrapper pattern for guards**: resolve the library against the script's own directory, `cd`
   into `$CLAUDE_PROJECT_DIR` for the scan, unconditional `exit 0`, stderr swallowed.
   `decoration-rail.sh:32-40`.
7. **The mirror envelope + mirror invariant**: one shared envelope, four injected values, and "a
   mirror may only mirror a gate that already exists". `lib/mirror.mjs:1-30`, `:65-98`.
8. **A shared run-log helper with a no-op fallback.** `lib/hook-log.sh`: one `hook_log` function,
   tab-separated, UTC, `LUMARIA_HOOK_LOG_DIR` seam, every failure path swallowed. Its header states
   the reason the rubric gives (`writing-great-hooks/SKILL.md:85`): before it, five of eight
   registered hooks wrote nothing, so "the rail fired" and "the rail is silently broken" produced
   identical evidence, "which is precisely how a hook whose `node` isn't on the non-interactive PATH
   looks exactly like a clean repo, forever."
9. **Named test seams whose safety argument is written down and is *asymmetric***: a seam may only
   make the gate stricter. `stop-gate.sh:146-151` for `STOPGATE_FORCE_FAIL`; `decoration-rail.sh:26-29`
   for the node-binary override.
10. **Scope-declaration discipline in the header**: stating what the gate does *not* cover
    (`stop-gate.sh:26-28`) rather than claiming coverage it lacks. #554 exists because the header once
    lied; #556 exists because a message channel was documented as dead in one paragraph and used
    anyway in the next.

### 4.2 Lumaria-specific: must be swapped or dropped

| Thing | Where | PWPP equivalent |
|---|---|---|
| ESLint + Biome as the check pair | `stop-gate.sh:83-85`, `:138-141` | `python3 -m pytest -q` from the repo root (`pytest.ini:1`) |
| `node_modules/.bin/<tool>` → `npx <tool>` resolution | `stop-gate.sh:83` | Not applicable. Use `/usr/bin/python3`, the absolute form PWPP already uses (`PWPP settings.json:9`) |
| `--config ./eslint.config.mjs --no-config-lookup --no-warn-ignored --max-warnings 0` | `stop-gate.sh:138` | `pytest.ini`'s `testpaths` already pins scope repo-side; the hook needs no flags |
| `\.(ts\|tsx\|js\|jsx\|mjs)$` filter | `stop-gate.sh:136` | `\.py$`: but see §4.3; the filter's *role* changes |
| `/tmp/lumaria-stopgate-` prefix; `lumaria-stop-gate.log`; `LUMARIA_HOOK_LOG_DIR` | `:68`, `:183`/`:191`/`:198`, `lib/hook-log.sh` | Must be namespaced per repo, or two repos share a counter and a log |
| The three guards' *rules* (decorative Tailwind classes, heading-scale combos, raw status badges, jscpd clone attribution | `decoration-rail.mjs:33-44`, `status-badge-guard.sh:5-11`, `jscpd-guard.sh:5-12` | **Nothing.** Lumaria design-system rules with no PWPP analogue. Port the *envelope*, not the rules |
| `eslint.config.mjs` block 4c / `scripts/clone-gate.mjs` as the mirrored gate | `lib/mirror.mjs:104-111`, `jscpd-guard.sh:8-11` | PWPP has no lint gate; the mirror invariant says **do not add a guard until a gate exists to mirror** |
| `pnpm check` as the referenced whole-repo gate | `decoration-rail.mjs:41-43` | `python3 -m pytest -q` |
| `docs/adr/0050`, decisions 0021/0022/0042/0044, PRD/issue numbers throughout | headers of all four hooks | Strip. Every hook header is 60-80% Lumaria provenance |

### 4.3 The one place the swap is *not* mechanical

The whole scoping apparatus rests on an assumption that is true for linters and **false for pytest**:
that the check takes a **file list** and reports only on those files. `stop-gate.sh:138-141` pipes
`$FILES` into `xargs $ESLINT`. `python3 -m pytest -q` is the opposite shape: the natural unit is the
whole suite (`pytest.ini:20-24` pins `testpaths` deliberately, because the previous per-subtree command
let ~350 tests rot silently, per `pytest.ini:3-8`), and pointing pytest at the *changed source files*
runs nothing, since changed sources are usually not test modules.

Three options; the map should pick one:

- **(a) Run the whole suite.** Structurally simplest: the scope step degenerates to a boolean ("did
  this session change anything at all?"), and `session-scope.mjs` still earns its keep as that
  boolean. Cost: the runtime `stop-gate.sh:7-10` explicitly removed from Lumaria as "pure duplication"
  of CI at every turn-end. **PWPP has no CI, which removes that objection.**
- **(b) Map changed files → test files** (`foo.py` → `test_foo.py`, or `pytest --lf`). Keeps the
  fast-gate property; adds a mapping heuristic that silently checks *nothing* when it misses,
  same class of defect as #554.
- **(c) Whole suite, but only when the session touched `.py` under a `testpaths` root.**
  **Recommended.** Uses `session-scope.mjs` as written (the extension filter still applies), preserves
  the structural core with the smallest new invention, and gets "a docs-only turn ends instantly" for
  free, which matters, because PWPP's parent workspace is mostly docs.

Whichever is chosen, the **fallback must stay stricter**: unknowable scope → run the whole suite. And
because (a) and (c) can take minutes, the registration **must** set an explicit `timeout` (§6, #12).

---

## 5. Test coverage, graded against the four-case minimum

The minimum is `writing-great-hooks/SKILL.md:57-61`: happy path, the trigger, malformed input,
degraded environment, with the completion criterion at `:68`: "all four case types run and pass, and
the degraded-env case confirms fail-open vs fail-closed matches intent."

### 5.1 `stop-gate.test.mjs`: 9 tests (was 7 pre-#556)

| Case | Covered? | Evidence |
|---|---|---|
| **Happy path** | ✅ | `:94-98` clean stop → exit 0, empty stderr. Also `:191` (a parallel session's dirty file does not block) and `:169-173` (clean stop leaves a run-log row) |
| **The trigger** | ✅ strong | `:108-138` breaker first-block then hand-back, now asserting the *JSON* channel (`:131-135`); `:181` broken file this session edited; `:203` `--no-verify` coverage; `:216` Bash-redirect recovery |
| **Malformed input** | ❌ **still absent** | `:38-40` always builds a well-formed `{session_id: …}`. No test feeds non-JSON, empty stdin, or a wrong-typed `session_id` |
| **Degraded env** | ⚠️ partial, improved | `:233` no `transcript_path` → repo-wide fallback. `:140-167` unwritable `/tmp` (a directory placed at the counter path) + `stop_hook_active`. Still nothing for missing `jq`, `git`, `node`, or `eslint`/`biome` |

The fixture work is genuinely good and worth copying: a throwaway git repo per test (`:13-24`); **stub
linters written into `node_modules/.bin`** so the *real* blocking path runs with a failure the test
controls exactly (`:56-64`), deliberately *not* using the `STOPGATE_SKIP_CHECKS` seam, and
`stop-gate.sh:123-129` says so; a synthetic transcript builder (`:66-77`); and `LUMARIA_HOOK_LOG_DIR`
pointed at the sandbox (`:33`) so suites stop depositing fixture rows in the real `~/.claude` logs,
a problem `lib/hook-log.sh:17-23` records actually happening.

### 5.2 Named gaps

- **G1: hand-back reaches nobody. ✅ FIXED by #556**, concurrently with this research. Recorded
  because the *shape* of the bug is the template's most important lesson: the old test asserted
  `stderr` contained `UNRESOLVED` and passed for weeks while the message reached no one. See §1.3.
- **G2: no malformed-input case at all. OPEN.** Empirically the hook survives garbage and empty
  stdin (**[probe]** both → exit 0, silent), but it survives *by collapsing to `nosession`*, which is
  G3. A malformed-input test is what would have caught it.
- **G3: `nosession` collision, untested and unmitigated. OPEN.** §3.3. Template fix: when the session
  id is unresolvable, do **not** silently share a global bucket; treat the breaker as unavailable and
  block (fail closed on identity loss), or key on `$CLAUDE_PROJECT_DIR` + PPID.
- **G4: missing `git` is a silent pass, untested. OPEN.** §1.5. Template fix: distinguish "git
  failed" from "nothing changed": drop the blanket `2>/dev/null` at `stop-gate.sh:97-98` and treat a
  git failure as "unknowable → fall back", the same asymmetry the transcript path already uses.
- **G5: the `/tmp`-unwritable wedge. ✅ FIXED by #556** (`:70-80`, `:177`) and now tested
  (`stop-gate.test.mjs:140-167`). This is the strongest single argument for the belt-and-braces rule.
- **G6: no test asserts the linters blocking on *real* ESLint/Biome output.** The stubs exercise
  scoping, never the real toolchain's exit semantics. An acceptable trade (justified at
  `stop-gate.test.mjs:49-55`), but a flag change at `stop-gate.sh:138`, losing `--max-warnings 0`,
  say, would not be caught.
- **G7: no test of two hooks on the same event. OPEN.** `settings.json:29-41` registers
  `stop-gate.sh` *and* `design-override-flag.sh` on `Stop`, and matching hooks run **in parallel with
  no ordering** (`REFERENCE.md:87`). Both may now write stdout JSON at exit 0; nothing tests what the
  harness does with two `systemMessage`s.

**Grade: 3 of 4** (was 2.5 pre-#556). Happy path and trigger are excellent, better than the minimum,
since the trigger cases encode the actual #554 and #556 regressions. Degraded env now covers two of
roughly six dependencies, including the one that used to wedge. **Malformed input remains entirely
absent, and it is the case that would expose the one FN-severity hole still open (G3).**

### 5.3 The guards score better, and for an instructive reason

The three guard `.sh` files have one test each: `decoration-rail.test.mjs:32`,
`jscpd-guard.test.mjs:73`, `status-badge-guard.test.mjs:27`, all trigger-only. The four-case coverage
lives **once**, in the shared envelope's suite (`lib/mirror.test.mjs`): fires on a hit and addresses
both audiences `:62`; silent when clean `:77`; out-of-scope path `:88`; outside the project dir `:97`;
unrelated tool `:114`; nonexistent file fails open `:123`; **malformed stdin fails open** `:132`;
**empty stdin fails open** `:141`; **missing node binary fails open** `:150`.

That is the full four-case minimum plus a degraded-env case proving the *intended* fail-open, achieved
because the envelope was extracted. `lib/session-scope.test.mjs` shows the same discipline for the
scoping half: 13 tests including a malformed line (`:65`), a missing transcript (`:74`), and all three
CLI exit-code cases (`:131`, `:139`, `:146`).

**The lesson for the portable template is the envelope, not the script.** `stop-gate.sh` has no
envelope, which is precisely why its own suite is the one missing a case class. Ship
`hooks/lib/stop-gate-envelope.*` with the four-case suite written once, and let each repo declare only
the check command, the file filter, the counter namespace and the message text.

---

## 6. Absolute-path and PATH assumptions that break on install elsewhere

| # | Assumption | Site | Breaks how |
|---|---|---|---|
| 1 | `jq` on PATH | `stop-gate.sh:65`, `:81`, `:106`, `:161` | Hooks run in a **non-interactive shell that does not inherit login PATH** (`REFERENCE.md:88`; `writing-great-hooks/SKILL.md:45`). `jq` is at `/home/collin/bin/jq`, *not* a system path. Loss is silent and costs identity (G3), re-entrancy detection, transcript path, **and** the hand-back channel at once. **[probe]** |
| 2 | `git` on PATH | `stop-gate.sh:97-98` | Silent pass. **[probe]** |
| 3 | `node` on PATH | `stop-gate.sh:113-114`; guards' `NODE_BIN` default `node` (`decoration-rail.sh:34`) | `node` is at `/home/collin/bin/node`. Gate falls back (safe); guards go silent (intended, but see `lib/hook-log.sh:5-10`; this is exactly the case the run-log exists to make visible) |
| 4 | `npx` on PATH when `node_modules/.bin` is absent | `stop-gate.sh:83` | Turns into a **block on every turn**: the check "fails", the breaker fires. **[probe]** |
| 5 | Hardcoded `/tmp/lumaria-` prefix and `lumaria-stop-gate.log` | `:68`, `:183`, `:191`, `:198` | Two repos installing the template share one counter and one log. Must be namespaced |
| 6 | `/tmp` writable | `:172-175` | Pins the counter at 0. No longer a wedge (`stop_hook_active` releases it, `:177`), but the block-once budget is silently gone |
| 7 | `./eslint.config.mjs` relative to cwd | `:138` | Only correct because `:57` already `cd`'d to `$CLAUDE_PROJECT_DIR`; breaks if that `cd` silently fell through to `$(pwd)` |
| 8 | `$CLAUDE_PROJECT_DIR` is a git repo | `:96-99` | Not a repo → empty scope → silent pass (same as #2) |
| 9 | Repo path may contain a **space** | `lib/session-scope.mjs:139-144` | Already bitten once. Both consuming repos live under `Claude Projects/`. Every path comparison and unquoted expansion is a live hazard |
| 10 | `$FILES` interpolated unquoted into `xargs $ESLINT` | `:138-141` | `$ESLINT` is *deliberately* word-split (it may be `npx eslint`), but a **filename containing a space** splits too. `xargs` without `-d '\n'`/`-0` mangles such paths, and the repo root already contains a space |
| 11 | Hook registered as `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/…"` | `settings.json:14, 23-25, 34, 38, 48, 59` | Correct and portable. PWPP goes one better with an absolute interpreter, `/usr/bin/python3` (`PWPP settings.json:9`), the pattern the template should adopt |
| 12 | No `timeout` on the `Stop` hooks | `settings.json:29-41` | Defaults to **600 s** (`REFERENCE.md:86`). Harmless for a changed-file lint; for PWPP's `python3 -m pytest -q` over ~350 tests a hung suite freezes turn-end for ten minutes. **Set an explicit `timeout`** |
| 13 | `$HOME` writable for the run-log | `lib/hook-log.sh:31`, `:38-43` | Correctly swallowed (`|| true`), so this one is already safe |

---

## 7. What the portable template should be

A shape, not a build (this map produces decisions, not code):

```
agent-skills/hooks/
  stop-gate.sh              # the envelope: stdin, cd, session id, breaker, three channels, messages
  lib/session-scope.mjs     # unchanged from Lumaria; transcript attribution is harness-level
  lib/hook-log.sh           # unchanged apart from the namespace env var
  stop-gate.test.mjs        # the four-case suite, written ONCE against the envelope
  stop-gate.config.example  # what a consuming repo declares
```

The consuming repo declares only:

- `CHECK_CMD`: `python3 -m pytest -q` (PWPP) / the eslint+biome pair (Lumaria)
- `FILE_FILTER`: `\.py$` / `\.(ts|tsx|js|jsx|mjs)$`
- `SCOPE_MODE`: `file-list` (linters) vs `whole-suite-if-touched` (pytest, §4.3(c))
- `NAMESPACE`: replaces the hardcoded `lumaria-` in the counter and log names
- message text, if it should differ from the `BLOCKED` / `UNRESOLVED` pair

Fixes the template must carry beyond today's Lumaria:

1. Refuse the shared `nosession` counter bucket, failing **closed** on identity loss (G3).
2. Distinguish "git failed" from "nothing changed" (G4).
3. A malformed-input case in the suite (G2), the case that would have caught #1.
4. Explicit `timeout` in the registration (assumption #12).
5. `xargs -d '\n'` / null-delimited file lists (assumption #10).
6. Absolute interpreter path, PWPP-style (assumption #11).
7. Declare the overall failure mode in the header, per dependency, as a table, because today it is
   an accident and the audit had to reverse-engineer it (§1.5).

Already correct in Lumaria post-#556 and to be copied as-is: the three-channel contract, the
belt-and-braces breaker, the stricter-fallback scope contract, the run-log helper, and the asymmetric
test seams.

---

## 8. What this changes for #10 ("What enforces the close gate")

1. **A `Stop` hook can enforce, and Lumaria proves it in production.** `stop-gate.sh:170-194` is a
   working, tested, tamper-resistant enforcement mechanism, and the Stop-loop objection is answered
   better than the docs' own single-mechanism answer (§3.2).
2. **The enforcement is bounded to one forced retry, by design, and re-arms** (§3.1). #10 cannot
   assume "the gate blocks until fixed"; it blocks *once per failure streak*, then hands back. If the
   close gate must be unskippable, `Stop` is the wrong rung: this is a strong nudge with a documented
   give-up, not a lock. `writing-great-hooks/SKILL.md:44` agrees: "a hook alone is defense-in-depth,
   not a lock."
3. **The give-up path must be on stdout JSON, not stderr.** This was invisible in Lumaria for weeks
   and was fixed only on 2026-07-28 (#556). Any design that says "the human is told when the gate
   gives up" must specify the channel, or it is specifying nothing (§1.3).
4. **The check's shape determines the whole design** (§4.3). Lumaria's gate is fast because it lints a
   *file list*; `python3 -m pytest -q` does not take one. #10 cannot pick "the same gate as Lumaria"
   without also picking (a), (b) or (c), and must pair the choice with an explicit hook `timeout`.
   The runtime objection at `stop-gate.sh:7-10` is language-specific *and* weaker for PWPP, which has
   no CI to duplicate.
5. **Use `type: command`, not `type: agent`.** `writing-great-hooks/SKILL.md:26` and `:34` float an
   `agent`-type Stop hook judging "is the task truly done?". Lumaria deliberately does not: a
   deterministic `command` + exit code is what makes the gate testable as a pure function of stdin,
   which is the only reason #554 and #556 could be captured as regression tests at all. Determinism
   ladder: prefer `command`.
6. **Enforcement and advice are different rungs and must stay separate.** The guards fail open and
   never block (`decoration-rail.sh:22-24`); the gate blocks. #10 should not conflate "the close gate"
   with the advisory mirror layer: the mirror invariant (`lib/mirror.mjs:18-21`, `docs/adr/0050`) says
   a mirror may never be the sole source of a rule, so **the gate must exist first**. For PWPP that
   gate already exists: `pytest.ini`'s one true command (`pytest.ini:1`).
7. **Whatever #10 decides, the observability requirement rides along.** `lib/hook-log.sh:5-10` records
   the failure this prevents: before the run-log, "did the rail fire?" and "is the rail silently
   broken?" produced identical evidence. A close gate nobody can audit is indistinguishable from no
   close gate, and §1.5's git-absent row shows that state is one missing binary away.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
