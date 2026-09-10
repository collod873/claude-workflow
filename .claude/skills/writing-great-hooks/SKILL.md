---
name: writing-great-hooks
description: Author, test, or audit Claude Code hooks. Use when the user wants to write a hook, make one reliable, debug one that misbehaves, or audit hooks for safety and correctness. Also use when another skill needs the hook-quality vocabulary.
---

# Writing great hooks

A CLAUDE.md line is a request the model may ignore. A **hook** is code the harness *runs*: same **event**, same way, every session. That is the whole reason hooks exist: they convert prompt-and-hope into a **guarantee**. Every rule below protects that guarantee.

Three branches; route first:

- **Author** a new hook → *The hook model*, then *Authoring*.
- **Test / debug** a hook → *Testing*.
- **Audit** existing hooks → *Auditing*.

Hooks on this machine live in `~/.agents/skills/hooks/` and run through `~/.claude/hooks/` symlinks (ADR-0019). Every hook imports `_hook.py`; every harness imports `_harness.py`. Those two docstrings are the contract; read them before writing either. How the harness behaves under contention, on timeout, and inside subagents was measured, not assumed: ADR-0012 (Pre), ADR-0016 (Post), `docs/research/hook-timeout-and-subagent-scope-2026-08-29.md`. Event catalog and I/O schema: `REFERENCE.md`; an event missing there means fetch `code.claude.com/docs/en/hooks.md` before designing.

## The hook model

Five axes fix what a hook can do (ADR-0005 records them for the close gate). Pin all five before writing a line.

- **Event**: the lifecycle moment it binds to. This sets the hook's **power**, a ladder; each event tops out at a rung (`REFERENCE.md` § Event catalog):
  1. **React**: log, format, notify. Any event.
  2. **Inject**: `additionalContext` feeds Claude text. Most events.
  3. **Steer**: `decision: "block"` + `reason`, the action stands, Claude is told why and keeps working (`PostToolUse`, `Stop`). This is how `Stop` "refuses to stop". On `Stop`, `additionalContext` steers too: it continues the turn under the same cap, only labelled feedback. A `Stop` fire ends the turn only when it puts nothing on Claude's channel; `systemMessage` alone is the human-only shape.
  4. **Halt**: `continue: false` ends the turn. Any event.
  5. **Gate**: the action never happens, or is rewritten: `PreToolUse`, `PermissionRequest`, `UserPromptSubmit`, `PreCompact`.
  Choosing a rung above the event's ceiling is the #1 design error (ADR-0005 § Event).
- **Matcher**: which occurrences fire it, a tool name for tool events, a source for others. Narrowest match that does the job; an empty matcher runs on *everything*. Case-sensitive; non-plain patterns are unanchored regex; MCP tools are `mcp__<server>__<tool>`; the edit tools are `_hook.EDIT_TOOL_MATCHER`. The **`if`** field narrows by argument and fails open on shell it can't parse: scoping, never safety (ADR-0005 § Matcher).
- **Contract**: stdin JSON in (`_hook.read_payload()`), two channels out. A refusal is `_hook.deny()`: exit 0, `permissionDecision: deny`, the same text on `systemMessage`, because `permissionDecisionReason` is a raced single slot under contention and `systemMessage` is the one per-hook channel that reaches the human (ADR-0012). The docs' `exit 2` + stderr block is silent to the human (ADR-0016) and discards any JSON. `hookSpecificOutput` needs `hookEventName` or the block is dropped.
- **Failure mode**: what happens when the hook itself errors, missing tool, bad input, a bug, a timeout. **Fail open** or **fail closed**, a deliberate choice (*Authoring* step 3).
- **Type**: `command` (everything here assumes it), or `prompt` / `agent` when the decision needs judgment rather than a regex (`REFERENCE.md` § Hook types).

Three measured runtime facts shape designs. **Every matching hook runs in parallel, unordered, most-restrictive wins** (ADR-0012), so a second hook on an event self-identifies on `systemMessage`. **A timed-out hook fails open, silently**: the action proceeds and neither channel is delivered, whatever the script meant to say. **Tool events fire inside subagents** with `agent_type` naming whose call it is (`""` for the main agent); `Stop` fires for the main agent only, and can fire before a background subagent has finished, while a subagent ends at `SubagentStop`.

Common pattern → event:

| Want to… | Event | Caveat |
|---|---|---|
| Auto-format / lint after an edit | `PostToolUse` (`EDIT_TOOL_MATCHER`) | Changes a file Claude just read; the next Edit re-reads. Expected. |
| Block a dangerous command or protect a file | `PreToolUse` (Bash / edits) | Back with a permission `deny` rule. |
| Refuse to stop until a check passes | `Stop` | Fires every turn, Claude's questions to you included, and before delegated work is done (`background_tasks` on the payload says when); runs only the contract's `stop` slot (ADR-0022). |
| Inject context at session start | `SessionStart` | Match `startup\|resume`, or it fires on every compact. |
| Log / notify | any Post event | `"async": true`; rows via `_hook.run_row()`. |

## Authoring

1. **Pin the five**: event, matcher, contract, failure mode, type. Lowest rung that works; tightest matcher. Completion criterion: all five written down, and the rung is one the event offers.
2. **Honor the contract exactly**: `_hook.read_payload()` in; `_hook.deny()` or `additionalContext` out. The text on either channel is a document Claude reads (`writing-for-agents`): `[HOOK_NAME]` first, then the one fact the hook knows, then one checkable step, stated positively, so a refusal says what to run instead. Completion criterion: for every path the hook can take, the exit code *and* the channel carrying the message are named. No path left implicit.
3. **Choose the failure mode on purpose.** Convenience (formatter, logger, notifier) → fail open: `|| true`, guarded deps, so a broken hook never wedges the session. Safety (block a command, protect a file) → fail closed, knowing the ceiling: regex and `if` matching fail open on tricky shell, and past `timeout` every hook fails open. A permission `deny` rule is the lock; the hook is defense-in-depth.
4. **Keep it tight.** A synchronous hook blocks the turn, and `PreToolUse`, `SessionStart`, `Stop` fire constantly. React-only hooks are `"async": true` (background; can't block; output lands next turn). The shell is non-interactive (no login PATH, aliases, or direnv) so absolute paths or `${CLAUDE_PROJECT_DIR}`, and profile `echo` guarded to interactive shells or it corrupts stdout JSON.
5. **Make it observable**: every fire writes a `_hook.run_row()` (CODING_STANDARDS "One log shape"); `~/.agents/skills/bin/hook-report` reads them.
6. **Test before you trust it**, per *Testing*. A hook you have not driven is a guess.
7. **Register it** in `~/.claude/settings.json`, a project's `.claude/settings.json` (it ships to every clone), a skill's frontmatter `hooks:`, or a plugin's `hooks.json`. All that apply run. Shape: `REFERENCE.md` § Config shape.

## Testing

A `command` hook is a pure function of stdin → (exit code, stdout, stderr): feed it JSON, assert the output. `prompt`/`agent` hooks are not; drive those live with the debug log below. A `Stop` hook's channels are the other exception: whether a JSON shape ends the turn or continues it is the harness's call, invisible to a pure-function test (the stop gate's hand-back passed its shape tests for a month while continuing every turn), so a change to what a `Stop` path emits is driven live in `docs/research/harness/hooks-per-event/` before it ships, in the shape `docs/research/stop-refusal-channels-2026-08-29.md` records.

The rubric encodes **intent, not current behavior**: each case is what the hook *should* do, decided from its source before you run anything. A FAIL *is* the product: a bug captured as a test. Flipping an expected value to match the hook turns the rubric into a **characterization test** and erases the finding.

1. **Locate** the hook's command and event (grep settings, skill frontmatter, plugin `hooks.json` for `"hooks"`).
2. **Assemble representative stdin**: the full payload for that event (`REFERENCE.md` § Input); a hook branching on `tool_name`, `hook_event_name`, or `cwd` is untested on a bare `tool_input`. Minimum four cases: **happy path**, **the trigger**, **malformed** (`_harness.MALFORMED_STDIN`), **degraded env** (a dependency missing, which proves step 3's failure mode).
3. **Drive and assert** through `_harness.run_hook()`, never `echo '{…}' | hook`, since a hook that scans Bash commands scans its own test payload and self-triggers (ADR-0012 hit this live). Assert exit code *and* both channels per case. Tag divergences **FN** (missed block, a hole) or **FP** (over-block, friction).
4. **Save the harness** as `test_<basename>.py` beside the hook; `test_credential_scan.py` is the exemplar. Completion criterion: all four case types pass, and degraded-env confirms the intended failure mode.

A **command guard hook** needs the keyword-collision coverage in `REFERENCE.md` § Testing: four cases pass and it still over-fires on git subcommands, compound commands, and keyword-as-data.

A hook misbehaving **live**: `/hooks` confirms registration, `Ctrl+O` shows a per-hook line each turn, `claude --debug-file /tmp/claude.log` (or `/debug`) logs matches, exit codes, and both streams. For a fire that has already happened, `bin/hook-trace --last` (or `--session <id>`) reads it back: the row proves the hook ran and what it decided, the session transcript proves what the harness did with it, and the tool is the join, so "did it fire" and "did the refusal hold" stop being the same question.

## Auditing

Run each hook found in settings, skill frontmatter, and plugin `hooks.json` against this rubric; every item is a distinct failure, so check them all.

First, before the list, **walk the inputs**, because this one is a procedure and does not survive as a checkbox. Enumerate every way the hook's inputs can be *untrustworthy* rather than *wrong* (a config that parses but fails the schema its runner applies downstream, the check's own files dirty in the working tree, a runner half-rewritten or missing, a dependency absent) and for each, name the path it takes **today** and the verdict it produces. Every one that lands on the ordinary failure path is a finding: every session in a checkout shares its tooling, that tooling is an editable file, and a sibling mid-refactor of it then interrupts everyone over a break that is nobody's and gone in two minutes. Counting verdicts does not answer this and will fool you: a `bad-contract` path sitting beside a check-failure path proves nothing when the schema is validated downstream. Liveness may defer a block, never waive one: `_hook.active_sessions()` bounds how long a real break stays invisible (ADR-0033). The walk goes in the report as the inputs and the path each takes, **even when every answer is fine**, since a walk that speaks only on a finding cannot be told apart from one that never ran, which is the ambiguity the "already right" bar exists to close.

- **Earns its place**: guarantees something no permission rule or built-in check already does.
- **Power matches event**: the rung used is one the event offers, and the lowest that works.
- **Failure mode is deliberate**: convenience fails open; safety fails closed, exits well inside `timeout` on every path, and a permission rule backs it.
- **Contract is coherent**: JSON only on exit 0; `hookEventName` set; refusal via `_hook.deny()`; the message reaches the audience that needs it.
- **Matcher is scoped**: narrow, anchored where exactness matters, correct case, `if` where a tool name is too broad.
- **Self-identifies**: a hook sharing an event carries its name on `systemMessage` (ADR-0012).
- **Speaks well**: its injected text is a document Claude reads, and `/audit-doc <hook>` grades it (the `writing-for-agents` levers and this rubric in one report). The shape a test holds is `_harness.spoken()`; the load is `hook-report`'s `Injected` column.
- **Speaks briefly**: every fire pays its message twice, into Claude's context, and onto the human's screen, because the harness renders `reason` as the visible refusal. First prefer naming the failing check and its assertion over echoing captured output at all. What you must echo, bound in code: keep the **tail** and mark the cut, because a runner prints which check failed *last*, so head-first truncation drops the one line worth having. The number is the check's to justify (`post-edit-validate.py:124` holds one, a slower producer needs a larger one); what is fixed is tail-first, marked, and bounded somewhere an editor can see it. Every hook on an event holds a bound, whatever language it is written in, or brevity is per-author and the strict sibling proves nothing.
- **Speaks safely**: echoed text is data, never instruction. A test's assertion diff, a captured prompt, a file's contents: truncate it, and quote and label what survives. A `toContain` failure on a prompt template inlines the whole template, so an agent-facing document lands mid-turn as if addressed to this session.
- **Scope is intended**: subagent fires are meant, or filtered on `agent_type`; a `Stop` gate reads `background_tasks` and defers while it is non-empty, since a session whose subagents hold the red files cannot fix them and shares their session id, so liveness cannot defer for it.
- **Tight**: react-only is `async`; nothing slow sits synchronously on a hot event; a `Stop` gate runs only the `stop` slot (ADR-0022).
- **Clean stdout**: only JSON can reach it.
- **Environment-safe**: absolute or `${CLAUDE_PROJECT_DIR}` paths, quoted; secrets stay out of logs and headers; `Stop` reads `stop_hook_active` and, when it is set, puts nothing on Claude's channel, since `reason` and `additionalContext` both continue the turn and a hand-back that carries either is a block wearing a softer label. The tell in `bin/hook-report`: more `handback` than `block` rows, which a breaker that hands back once per streak can never produce.
- **Observable**: `run_row()` on every fire, stamping the payload's `tool_use_id` where the event carries one, since that is what joins the row to the harness's own record of the same fire in `bin/hook-trace`: the row is the hook's self-report and stops at its exit, the transcript is what actually happened next, and a hook is only observable once both can be read on one line.
- **Tested**: `test_<basename>.py` exists beside it and is green.

Report findings per hook, most severe first. Then the reverse pass: a hook that now guarantees a rule retires the `CLAUDE.md` line that asked for it.

## Failure modes

Diagnose by symptom:

- **Should block, doesn't**: exited `1` not `2`; or the event's ceiling is below gate (`PostToolUse` steers, `PreToolUse` gates); or it timed out.
- **Fires but nothing happens**: JSON with `exit 2`; `hookEventName` missing; message on stdout under `exit 2`; or it's `async`.
- **Blocks everything / wedges the session**: a convenience hook failing closed, a missing dep or bug returns nonzero. On `Stop`: it's blocking questions, not just completions.
- **Never fires**: `/hooks` first. Then matcher: case, unanchored regex, MCP name, an event that ignores matchers, wrong settings file.
- **Fires when it shouldn't**: a subagent's call (`agent_type`), or a sibling hook's `deny` on the shared event.
- **"command not found" though it works in your terminal**: non-interactive shell; absolute path.
- **"JSON validation failed"**: shell profile echoing into stdout.
- **Slows every turn**: synchronous work on a hot event; `async` or trim.
- **Stop hook loops**: `stop_hook_active` unchecked, or checked and answered with `additionalContext`, which continues like a block; the harness force-releases after 8. `bin/hook-report` prints a `tripwire:` line when a mechanism's hand-backs outnumber its blocks.
