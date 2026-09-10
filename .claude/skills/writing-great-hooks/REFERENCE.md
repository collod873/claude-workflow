# Hooks reference

Event catalog, matcher rules, and I/O schema for the events this machine registers or `SKILL.md` names. Source: `code.claude.com/docs/en/hooks.md` and `/hooks-guide.md` (verified 2026-07-07; the `Stop` rows re-read against the live doc 2026-09-04). The event list churns: an event absent below, or a row older than 60 days that a design leans on, is fetched from the docs before it is trusted.

## Event catalog

**Ceiling** = the highest rung of `SKILL.md`'s power ladder the event's exit can change: react < inject < steer < halt < gate. `halt` (`continue: false`) is available on every event and omitted from the column.

| Event | Fires | Ceiling | Matcher filters on |
|---|---|---|---|
| `PreToolUse` | Before a tool runs | gate | tool name |
| `PostToolUse` | After a tool succeeds | steer (`decision: block`; the tool already ran, ADR-0016) | tool name |
| `PostToolUseFailure` | After a tool fails | inject (`additionalContext` lands beside the error; `is_interrupt` marks an abort, not a tool error) | tool name |
| `PermissionRequest` | When a permission dialog would appear | gate (`decision.behavior: deny`) | tool name |
| `UserPromptSubmit` | User submits a prompt, before Claude sees it | gate (`exit 2` erases the prompt) | (none) |
| `Stop` | Main agent finishes responding, every turn | steer (forces continue; `additionalContext` continues too, see Output) | (none) |
| `SubagentStop` | A subagent finishes | steer | agent type |
| `StopFailure` | Turn ended on an API error | react | error type |
| `SessionStart` | Session begins or resumes | inject (stdout is context) | `startup`, `resume`, `clear`, `compact` |
| `SessionEnd` | Session ends | react | end reason |
| `Notification` | Claude Code emits a notification | react | notification type |
| `PreCompact` | Before context compaction | gate | `manual`, `auto` |

The remaining events (`PostToolBatch`, `PermissionDenied`, `UserPromptExpansion`, `SubagentStart`, `Setup`, `MessageDisplay`, `FileChanged`, `CwdChanged`, `ConfigChange`, `InstructionsLoaded`, `PostCompact`, `TaskCreated`/`TaskCompleted`, `TeammateIdle`, `WorktreeCreate`/`WorktreeRemove`, `Elicitation`/`ElicitationResult`) are in the docs.

**Matcher evaluation:** empty/omitted = match all; plain `A-Za-z0-9_- ,|` = exact string or pipe/comma OR-list (`Edit|Write`); anything else = **unanchored** JavaScript regex (`^Foo$` for exact). Case-sensitive: tool names are capitalized (`Bash`, not `bash`). MCP tools are named `mcp__<server>__<tool>`; a whole server is `mcp__github__.*`.

**`if` field** (tool events only, narrowing by tool + argument): `"if": "Bash(git *)"` runs the hook only for matching commands. Best-effort and **fails open** on unparseable Bash (heredocs, deep nesting).

## Input (stdin JSON)

Common to all events: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `agent_type` (`""` for the main agent, the subagent's type inside one), `effort.level`. A test fixture carries these plus the event's own fields, not a bare `tool_input`.

Event-specific additions:
- Tool events: `tool_name`, `tool_input` (e.g. `.command`, `.file_path`), plus `tool_output` (`.stdout`, `.exit_code`) on Post.
- `UserPromptSubmit`: `prompt_text`.
- `SessionStart`: `source`, `model`.
- `Stop`/`SubagentStop`: `last_assistant_message`, `stop_reason`, `stop_hook_active` (true once this hook already blocked; check it to avoid loops). `Stop` also carries `background_tasks` (in-flight tasks: `id`, `type` of `subagent`/`shell`/`monitor`/`workflow`/`teammate`/`cloud session`/`MCP task`, `status`, `description`, and `agent_type` on a subagent) and `session_crons` (scheduled wakeups), both present when the task registry is reachable and empty when nothing is in flight. They are how a hook tells "the session is done" from "the session is paused for background work"; a `Stop` gate that reads neither refuses a session that cannot act.
- `Notification`: `notification_type`, `message`. `PreCompact`: `compaction_trigger`.

## Output

### Exit codes (command hooks)
- **0**: success. stdout is parsed for JSON (below). For most events plain stdout only hits the debug log; **`UserPromptSubmit` and `SessionStart` inject stdout as context to Claude**.
- **2**: blocking error. **Any JSON/stdout is ignored**; stderr becomes the message. Where it lands (Claude vs user) and whether it blocks depends on the event's Ceiling.
- **any other**: non-blocking error. First stderr line shown in transcript; execution continues. A **timeout** is this case, with nothing on either channel (`hook_response`: `outcome: "cancelled"`, `exit_code: 1`).

### JSON stdout (exit 0 only)
Universal fields: `continue` (false = halt Claude entirely), `stopReason`, `suppressOutput`, `systemMessage` (per-hook, reaches the human, ADR-0012).

`hookSpecificOutput` requires `hookEventName` to match the event, or the whole block is ignored:

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask|defer",
    "permissionDecisionReason": "...",
    "updatedInput": { "command": "npm run lint" },
    "additionalContext": "injected for Claude" } }
```

- **`permissionDecision`** (PreToolUse only): `allow` skips the prompt (deny rules still apply), `deny` cancels + tells Claude, `ask` normal prompt, `defer` preserves the call (`-p` mode). `permissionDecisionReason` is a single raced slot under contention (ADR-0012).
- **`additionalContext`** (most events): text fed to Claude next to the result. The non-blocking way to inject guidance, **except on `Stop`/`SubagentStop`**, where it continues the turn under the same `stop_hook_active` and 8-strike protections as `decision: "block"`, labelled `Stop hook feedback` instead of a hook error (docs § Stop decision control; measured in the field 2026-09-04, 24 forced continuations from a hand-back that carried it). A `Stop` fire that wants the turn to end puts nothing on Claude's channel: `systemMessage` alone reaches the human and lets the turn end.
- **`updatedInput`** (PreToolUse/PermissionRequest): rewrite the tool call. Last writer wins if multiple hooks set it.
- **`updatedToolOutput`** (PostToolUse): replace stdout/exit_code.
- **`decision: "block"` + `reason`** (top-level; PostToolUse, Stop, UserPromptSubmit, PreCompact): block with a reason. PreToolUse uses `permissionDecision` instead. On Post events `reason` is per-hook, not raced (ADR-0016). On `Stop` it forces the continue exactly as `exit 2` does and is the only refusal shape with a human channel: `systemMessage` lands as a `system/informational` notice, stderr under `exit 2` reaches the model alone, prefixed with the hook's whole command line (`docs/research/stop-refusal-channels-2026-08-29.md`).
- `SessionStart` extras: `sessionTitle`, `watchPaths`, `reloadSkills`, `initialUserMessage` (`-p` only).
- `PermissionRequest`: `decision: {behavior: "allow|deny", updatedInput}`.

Hard rule: **JSON needs exit 0.** Emitting JSON *and* `exit 2` throws the JSON away.

## Env vars, timeouts, limits
- `$CLAUDE_PROJECT_DIR` (project root, quote it), `$CLAUDE_PLUGIN_ROOT`, `$CLAUDE_ENV_FILE` (SessionStart/CwdChanged: append `export FOO=bar` to persist env into Bash).
- Default timeout: `command`/`http`/`mcp_tool` 600s (UserPromptSubmit 30s), `prompt` 30s, `agent` 60s. Override with `"timeout"` (seconds).
- `"async": true`: the hook runs in the background; the turn doesn't wait. It cannot block or rewrite; its `additionalContext`/`systemMessage` land on a later turn.
- Output cap 10,000 chars (overflow spills to a file). Matching hooks run **in parallel**, with no ordering (ADR-0012). Stop hooks are force-released after 8 consecutive blocks.
- **Runtime env**: command hooks run in a **non-interactive** shell and do **not** reliably inherit your login-shell PATH/aliases/direnv. Use absolute paths or `${CLAUDE_PROJECT_DIR}`; the working directory is the `cwd` field. Interactive-only-guard any profile `echo` (`[[ $- == *i* ]]`) so it can't corrupt stdout JSON.

## Hook types (the `type` field)

Every hook picks one. `command` is the default reflex; the others exist for specific jobs.

- **`command`**: runs a shell command / script. The workhorse. Contract = the exit-code + stdout JSON above.
- **`prompt`**: sends your prompt **+ the same stdin JSON** to a Claude model (Haiku by default; override with `model`) for a single-turn yes/no. The model returns **`{"ok": true}`** or **`{"ok": false, "reason": "…"}`**, *not* the `permissionDecision`/`decision` fields; the harness maps `ok` to the event's decision (deny on PreToolUse, keep-working on Stop, warning line on Post/UserPrompt). Use when the input data alone is enough to judge. Default timeout 30s.
- **`agent`**: spawns a subagent that can read files, search, run tools, then returns the **same `{"ok", "reason"}`** shape. Use when the decision needs to check actual codebase/repo state (e.g. "do the tests really pass?"). Default 60s, up to 50 tool turns. Experimental.
- **`http`**: POSTs the payload to a URL; return 2xx + decision JSON to block (non-2xx and connection failures are non-blocking). Restrict header interpolation with `allowedEnvVars`.
- **`mcp_tool`**: calls a tool on a connected MCP server with a templated `input`.

## Debugging

- **`/hooks`** menu: confirms a hook is registered and shows its config. First check when a hook "isn't firing."
- **Transcript view (`Ctrl+O`)**: one line per fired hook: success is silent, blocking errors show stderr, non-blocking errors show `<hook name> hook error` + first stderr line.
- **Debug log**: full detail: which hooks matched, exit codes, stdout, stderr. Start with `claude --debug-file /tmp/claude.log` and `tail -f /tmp/claude.log`, or run **`/debug`** mid-session to enable it and get the path.
- **Run rows**: every hook's fires are in `~/.claude/logs/<hook>-YYYY-MM-DD.jsonl`; `~/.agents/skills/bin/hook-report` reads across them. One row, three writers, one per language a hook is written in: `_hook.run_row()` + `_hook.append_log()` in Python, `runRow()` + `appendLog()` from `_hook.mjs` in JavaScript, `hook_run_row <verdict> [key=value ...]` from `_hook.sh` in bash (a shim that hands the payload to `_hook.mjs`, so JSON is parsed in one place). All three sit in `~/.claude/hooks/`; a consuming repo carries the JS and bash pair byte-identical under `.claude/hooks/lib/` and `~/.agents/skills/bin/re-seed` reports when a copy drifts. A hook in another language uses its language's writer, never a private append: a private copy is where `tool_use_id` went missing from two repos' rows, and `bin/hook-report` reads only the shared shape.

### The three records of a hook's behaviour

In ascending order of what each can prove, because a claim is only as good as the record it rests on:

1. **The test** says what the hook *should* do. It is intent, written by the author, and it is the only one of the three that exists before the hook runs.
2. **The run row** says the hook ran and what it decided. It is a self-report, written by the hook about itself, and it stops at the process's exit: a row reading `deny` is a hook that *believes* it denied.
3. **The session transcript** says what the harness did with that decision: which channel the text went out on, which audience saw it, how long the harness waited, and whether the tool then ran or the turn then ended. It is written by Claude Code, about the hook, after the hook is gone.

`~/.agents/skills/bin/hook-trace` joins 2 and 3, one line per fire, and `--check` exits nonzero where they disagree. Its `--help` is the **only** place the transcript's record shape is written down (it is undocumented upstream and version-dependent); its own harness fails, naming the field, when a Claude Code release renames one. Read the schema there rather than copying it here, so a version bump breaks a test instead of quietly aging a document.

## Config shape
```json
{ "hooks": { "PreToolUse": [
  { "matcher": "Edit|Write", "if": "Edit(.env)",
    "hooks": [ { "type": "command", "command": "…", "timeout": 10, "async": false } ] } ] } }
```
`type`: `command` (shell form, or exec form when `args` present), `http`, `mcp_tool`, `prompt`, `agent`. Homes, all of which apply at once: `~/.claude/settings.json` (global), `.claude/settings.json` (project, committed), `.claude/settings.local.json` (untracked), a skill's frontmatter `hooks:` (active only while the skill is loaded), a plugin's `hooks.json`.

## Testing: command guard hooks

For a hook that decides BLOCK vs ALLOW on `tool_input.command` (protects a path, refuses a dangerous command), the harness shape is `test_credential_scan.py` beside `_harness.py`: `_harness.run_hook()` drives, `_harness.MALFORMED_STDIN` is iterated as-is with the hook's own field-specific malformed shapes appended, and `_harness.diff_baseline()` keeps the regression snapshot. This grades block-vs-allow only; a formatter, context-injector, or `type: agent` hook uses the general "assert exit code + both channels" method in `SKILL.md` § Testing.

### Coverage catalog

A rubric that hits every intended BLOCK/ALLOW branch can still miss whole classes where the regex can't tell intent from a keyword collision. For each relevant class add at least one ALLOW case *and* one BLOCK case in the same shape (so you test the boundary, not just assert permission). With a guard on keyword `K` / dir `K/`:

- **Word-boundary collisions**: common English colliding with `K` (`grep build file.txt` when guarding `build/`).
- **Compound commands**: `&&`, `||`, `|` where one segment is safe and another trips.
- **Git subcommands on guarded paths**: `git diff/log/show/add/blame/commit … K/file`. Object-DB access, not a raw read, so it should ALLOW; `cat K/file` in the same shape must still BLOCK.
- **Output-bounding pipes**: `<cmd> | head/tail/wc`. A bounded read differs from an unbounded dump.
- **Directory navigation**: `cd K`, `pushd K`, `pwd`. Not a read of contents.
- **Package-manager scripts reusing the keyword**: `npm run build`, `cargo build`, `make build`. Script name, not a path.
- **Keyword as substring / anchoring leaks**: `cat src/build.sh`, `pre-build`, `rebuild`, `.env.example`, `.env.backup`, `environment.txt`. If the guard is `\bK\b` or bare `.env`, these are where anchoring leaks.
- **Find/ls on a parent**: `find . -name X` where `.` transitively contains `K/`. Pruning an excluded dir isn't reading it.
- **Redirect-write not read**: `echo x > K/out.log`, `cp file K/`, `tar -xf f -C K/`. Writing to a guarded dir isn't reading from one.
- **Keyword as data**: the guarded word inside a `--comment` body, heredoc, grep pattern, or string literal (`_hook.unquoted_matches()` is the shared filter; ADR-0012 § The collision is live).

Then brainstorm *this* hook's own quirks: shell syntax the regex doesn't tokenize (`$(...)`, backticks), aliases/functions wrapping the command, path expansions (`~`, `$HOME`, `..` resolving into `K/`). 40+ cases is normal; coverage is cheap because the harness runs in seconds.

Some hooks read external state (a plan file, session state, env) rather than stdin `command`. There, cases describe the state and the harness builds it in an isolated temp dir (`_harness.RowLog` for the log side) before each run; the malformed-stdin quartet still runs verbatim.
