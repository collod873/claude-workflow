#!/usr/bin/env python3
"""Shared helpers every hook imports as a sibling module.

A sibling, never a package: a dash in a hook's own filename (`close-gate.py`)
already rules out `from hooks import _hook`. `import _hook` resolves the same
way every hook itself resolves (ADR-0019, `Path(__file__).resolve().parent`) —
when a hook runs through its `~/.claude/hooks/` symlink, Python's own import
search looks in that same symlink directory, which is why this file is
symlinked there too, right beside every hook that imports it.

`BIN` — the repo's `bin/`, put on `sys.path` here at import time so a hook
writes `import _hook` then `import ticket_shape` (#102's hooks<->bin import
decision, ratified on #109). `.resolve()` is load-bearing: this file may be
running through the `~/.claude/hooks/` symlink (ADR-0019), and only the
resolved path's ancestors are the repo root that has `bin/`. The direction is
one-way: hooks reach down into `bin/`; `bin/` never imports `hooks/`.

Two layouts, searched nearest-first, because the same file now lives at both.
Here the hooks sit one level under the repo root (`skills/hooks/`, `bin/`
beside them); in a consumer repo that checks this gate in they sit two
(`.claude/hooks/`, `bin/` at the root). Probing for the directory rather than
hardcoding a depth is what lets one file be copied between them unedited — a
delta on this line would be the first thing to drift, and the copy exists
precisely so a repo's gate and this machine's gate stay the same rule.

Three things duplicated across `hooks/*.py` before this file existed, one home
each now:

`deny(msg)` — ADR-0012's one deny envelope. Exit 0 (never `exit 2`, which
would throw the JSON away); `hookSpecificOutput.hookEventName` hardcoded to
`"PreToolUse"` per ADR-0005 (every gated event on this machine today); the
same message repeated verbatim on `permissionDecisionReason` (Claude's
channel, raced under contention) and top-level `systemMessage` (the human's
channel — the one N-hook contention on a shared event cannot destroy). The
pass path is never this module's problem: allow is silence, and silence is
simply not calling `deny`.

`HOOK_NAME` — the calling hook's own name, read from `sys.modules["__main__"]`
rather than restated per file as a literal. A renamed hook reports its new
name automatically; nothing here can drift out of sync with a `mv`.

`EDIT_TOOLS` / `EDIT_TOOL_RE` / `exposure(payload)` — the edit-tool roster both
Stop gates (`stop-gate.py`, `stop-fire-log.py`) read to decide whether a
session touched a file this run: which tool names count as an edit, and
whether a session's transcript shows one.

`read_payload()` — the one stdin reader (#108, closing #87's deferral): every
hook that reads a JSON payload off stdin now shares it, `tool_input` already
normalised to a dict, rather than hand-rolling `json.load(sys.stdin)` plus its
own `(data.get("tool_input") or {})` accessor. Parse failure is a distinct
second return value, never collapsed into an empty dict silently — close-gate
is the one caller that branches on it, to write its ADR-0005 log row before
staying silent; every other hook already fails open on bad stdin regardless.

`append_log()` / `run_row()` / `LOG_RETENTION_DAYS` — the one JSONL log writer
(#108, #182), the function CODING_STANDARDS.md's "One log shape" entry names:
one `ts` format, one retention constant, mkdir handled, write errors swallowed
so a verdict never depends on a writable log (ADR-0005's observability rule).
Nothing is exempt: close-gate's private seven-column TSV was the last holdout
and became rows here in #182, so `~/.claude/logs/` is now the whole estate's
run record and `bin/hook-report` can read it without knowing thirteen shapes.

`quoted_spans()` / `unquoted_matches()` — the one shell-quote span scanner
(#106): both PreToolUse/Bash gates (ADR-0012) need the same answer to "is
this byte inside quotes or a heredoc", and before this they didn't agree —
close-gate's own copy honoured a stray backslash outside any quote, excluded
the quote characters from the span, and never parsed a heredoc at all;
validate-bash's copy did none of that, per ADR-0012 and closed #31, which set
that reading deliberately. One command could be blocked by one gate and
waved through by the other on a quoting disagreement. This is
validate-bash's semantics, the named direction — close-gate's accidental
delta is the one that moved. The span table that grades it lives in
`hooks/test__hook.py`, the direct harness for this module (#110): a helper
here is tested once, there — never through the hooks that import it.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# Wall clock starts the moment a hook imports this module, which is the first
# statement of every hook on this machine and therefore the closest thing to
# "when the process began reading stdin" a pure-Python helper can observe.
# `run_row`'s `seconds` is measured from here, so a hook cannot forget to start
# a timer and report a fire as free.
_STARTED = time.monotonic()

_HOOKS_DIR = Path(__file__).resolve().parent
# Bounded to these two candidates on purpose. Walking `.parents` to the first hit would
# keep climbing past the repo root and find `~/bin` or `/usr/bin`, putting a stranger's
# modules on a hook's import path — a wrong answer that looks like a working one.
_BIN_CANDIDATES = (_HOOKS_DIR.parent / "bin", _HOOKS_DIR.parent.parent / "bin")
BIN = next((c for c in _BIN_CANDIDATES if c.is_dir()), _BIN_CANDIDATES[0])
if str(BIN) not in sys.path:
    sys.path.insert(0, str(BIN))


def _caller_stem() -> str:
    """The invoked hook's own filename stem — e.g. `close-gate`, never `_hook`.

    Reads `sys.modules["__main__"]`, the running hook script itself, rather
    than this module's own `__file__`: every hook is its own `python3 <file>`
    process, so by the time it does `import _hook`, `__main__` is already
    bound to *that* hook's module. `.resolve()` then follows the
    `~/.claude/hooks/` symlink back to the real file here, so the name
    survives the indirection ADR-0019 put in the way — a hook renamed by a
    plain `mv` (and its symlink re-pointed) reports the new name with no
    second edit required.
    """
    main = sys.modules.get("__main__")
    path = getattr(main, "__file__", None) or (sys.argv[0] if sys.argv else "")
    if not path:
        return "_hook"
    return Path(path).resolve().stem


HOOK_NAME = _caller_stem()


def deny(msg: str) -> None:
    """Print the one ADR-0012 deny envelope and return — never exits, never raises.

    Every hook's block rides this shape: exit 0, `permissionDecision: "deny"`
    inside `hookSpecificOutput` (Claude's channel), and the identical message
    repeated on top-level `systemMessage` (the human's channel — ADR-0012's
    rule for any hook sharing its event with another). `msg` is prefixed with
    `[HOOK_NAME]` so a raced or logged message still names its own hook.
    """
    message = f"[{HOOK_NAME}] {msg}"
    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": message,
        },
        "systemMessage": message,
    }
    print(json.dumps(output))


# --- stdin --------------------------------------------------------------------


def read_payload() -> tuple[dict, bool]:
    """(payload, ok) parsed from stdin JSON, `tool_input` normalised to a dict.

    The one stdin reader every hook shares: raw bytes off `sys.stdin.buffer`,
    decoded as UTF-8 and parsed as JSON — close-gate's own strictness (bad
    UTF-8 is as unparseable as bad JSON) generalised to every caller, so no
    hook hand-rolls `json.load(sys.stdin)` or `sys.stdin.read()` again.

    `ok` is `False` on any parse failure — no stdin, invalid UTF-8, malformed
    JSON, or a top-level value that isn't a JSON object — and `payload` is
    `{}` in that case, so a caller that ignores `ok` still gets a dict it can
    `.get()` off safely. Every PreToolUse guard on this machine already fails
    open on bad stdin regardless of which shape the failure took; only
    close-gate branches on `ok` itself, to write its own ADR-0005 log row
    before staying silent.

    On success, `payload["tool_input"]` is always a dict — present, absent,
    `null`, or holding some other JSON type all collapse to `{}` — so the
    `(data.get("tool_input") or {})` accessor never needs hand-writing again.
    """
    try:
        raw = sys.stdin.buffer.read().decode("utf-8")
        payload = json.loads(raw)
    except (OSError, ValueError):
        return {}, False
    if not isinstance(payload, dict):
        return {}, False
    tool_input = payload.get("tool_input")
    payload["tool_input"] = tool_input if isinstance(tool_input, dict) else {}
    return payload, True


# --- append-only JSONL logging -------------------------------------------------

# STOP_GATE_LOG_DIR predates this shared home (it was stop-gate.py's and
# stop-fire-log.py's own override, used identically by both) — kept as-is
# rather than renamed, so every existing test fixture that isolates its rows
# from the real `~/.claude/logs/` audit trail keeps working unchanged.
LOG_DIR = Path(os.environ.get("STOP_GATE_LOG_DIR") or (Path.home() / ".claude" / "logs"))

# Retention, stated where the rows are rather than in a doc nobody reads while
# deleting them (#182): every hook's and every tool's rows are pruned at 30
# days, and that stands — the window exists so `bin/hook-report --days 30`
# always answers from a bounded directory, and so a machine-global log cannot
# grow without an owner. The consequence is the rule: a *finding* meant to
# outlive the window — a guard's catch rate, a slug that never fired, a
# denominator an argument rests on — is copied into `docs/research/` with its
# date and its window, the way `docs/research/machinery-audit-2026-08-27.md`
# did by hand before these rows existed. Rows are evidence with an expiry;
# `docs/research/` is where evidence becomes a record.
LOG_RETENTION_DAYS = 30


def append_log(hook: str, row: dict, *, path: Path | str | None = None) -> None:
    """Append one JSON line — mkdir, one `ts` format, one retention constant,
    write errors swallowed so a verdict never depends on a writable log
    (ADR-0005's observability rule; CODING_STANDARDS.md's "One log shape").

    Default target is `LOG_DIR/<hook>-YYYY-MM-DD.jsonl`. `path`, when given,
    is written to verbatim instead, with no rotation — for a caller that owns
    its own file identity rather than a hook's own dated log, e.g. `stub_gh.py`
    recording argv into the exact file its harness reads back.

    `row["ts"]` is stamped (local time, seconds precision — the format
    `stop-gate.py` and `stop-fire-log.py` already agreed on) unless the
    caller already set one, so every row on this machine shares one
    timestamp format under one name.
    """
    row = dict(row)
    row.setdefault("ts", datetime.now().isoformat(timespec="seconds"))
    target = Path(path) if path is not None else LOG_DIR / f"{hook}-{datetime.now():%Y-%m-%d}.jsonl"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")
    except OSError:
        return
    if path is None:
        _prune_old_logs(hook)


def run_row(payload: dict, verdict: str, **extra) -> dict:
    """The one run row (#182): the six fields every mechanism owes an audit,
    stamped here so thirteen hooks cannot spell them thirteen ways and no
    caller can forget one.

    `hook` is `HOOK_NAME`; `event` is the payload's own `hook_event_name`,
    which is the only thing that tells `circuit-breaker`'s three wirings apart
    once the rows are in one directory; `session_id` and `project` (the
    basename of the payload's `cwd`) locate the fire; `verdict` is one word
    from the calling hook's own fixed vocabulary, so a report can count
    without parsing prose; `seconds` is wall time since the hook started
    (`_STARTED`, above). `ts` is left to `append_log`, the one place a
    timestamp format is chosen.

    `extra` is whatever that hook alone knows — a guard slug, a pattern name,
    an unchecked count — and overrides a stamped field only if a caller
    deliberately spells one (`stop-fire-log` predates this and keeps its own
    `project`/`session_id` reading). Pass `{}` for a payload that never
    parsed: every read is `.get()`-safe, so a bad-stdin path still gets a row
    rather than an exception on the way to one.

    A `bin/` tool has no stdin payload and no event; it passes `{}` and names
    itself with `tool=` through `bin/run_log.py`, which is why the reader in
    `_harness.rows()` keys on `hook` *or* `tool`.
    """
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    row = {
        "hook": HOOK_NAME,
        "event": (isinstance(payload, dict) and payload.get("hook_event_name")) or "",
        "session_id": (isinstance(payload, dict) and payload.get("session_id")) or "",
        "project": Path(cwd).name if isinstance(cwd, str) and cwd else "",
        "verdict": verdict,
        "seconds": round(time.monotonic() - _STARTED, 4),
    }
    row.update(extra)
    return row


def _prune_old_logs(hook: str) -> None:
    """Delete `LOG_DIR/<hook>-*.jsonl` files older than `LOG_RETENTION_DAYS`.
    Best-effort, swallowed — observability must never change a caller's
    outcome, the same rule `append_log`'s own write follows."""
    cutoff = datetime.now() - timedelta(days=LOG_RETENTION_DAYS)
    try:
        for f in LOG_DIR.glob(f"{hook}-*.jsonl"):
            try:
                date_str = f.stem[len(hook) + 1:]
                if datetime.strptime(date_str, "%Y-%m-%d") < cutoff:
                    f.unlink()
            except (OSError, ValueError):
                continue
    except OSError:
        pass


# --- the edit-tool roster, shared by both Stop gates ------------------------

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
EDIT_TOOL_RE = re.compile(rb'"name"\s*:\s*"(?:Edit|Write|MultiEdit|NotebookEdit)"')

# The matcher string every PreToolUse/PostToolUse hook that watches an edit is registered
# with, stated here beside the roster it must agree with. A settings matcher made only of
# `A-Za-z0-9_- ,|` is an *exact* pipe OR-list, not a regex — so `Edit|Write` matches those
# two tool names and nothing else, and every hook on it was blind to `NotebookEdit` while
# both Stop gates counted a NotebookEdit as an edit. A secret written into a `.ipynb` was
# never scanned. `hooks/test__hook.py` asserts this string against the live settings.json,
# so the roster and the registration cannot drift apart again in silence.
EDIT_TOOL_MATCHER = "|".join(EDIT_TOOLS)


def edited_path(tool_input: dict) -> str:
    """The file an edit tool is about to write, whatever that tool calls the field.

    `Edit`/`Write`/`MultiEdit` spell it `file_path`; `NotebookEdit` spells it
    `notebook_path`. Four hooks read this and all four read `file_path` only, so adding
    `NotebookEdit` to their matcher without this would have registered them for an event
    whose payload they cannot parse — a fix that looks applied and changes nothing.
    """
    if not isinstance(tool_input, dict):
        return ""
    for key in ("file_path", "notebook_path"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def new_content(tool_input: dict) -> str:
    """Every piece of text an edit tool is about to introduce, joined by newlines.

    `Write` carries `content`, `Edit` carries `new_string`, `NotebookEdit` carries
    `new_source`, and `MultiEdit` carries a list of `edits` each with its own
    `new_string`. `credential-scan` scans whatever this returns, so a field missing here
    is a channel a secret can be written through unscanned — which is what `new_source`
    was. Only the *new* text is collected: `old_string` is what is being removed, and
    scanning it would refuse an edit for deleting a secret.
    """
    if not isinstance(tool_input, dict):
        return ""
    parts = []
    for key in ("content", "new_string", "new_source"):
        value = tool_input.get(key)
        if isinstance(value, str):
            parts.append(value)
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        for edit in edits:
            if isinstance(edit, dict) and isinstance(edit.get("new_string"), str):
                parts.append(edit["new_string"])
    return "\n".join(parts)


def exposure(payload: dict) -> tuple[bool | None, int]:
    """(exposed, edit_count) from `payload["transcript_path"]`.

    `(None, 0)` when the transcript can't be read at all — unknowable, not
    "no". `exposed` is whether the session's transcript shows any
    Edit/Write/MultiEdit/NotebookEdit `tool_use` block *issued by the
    assistant*: only exposed stops count toward a gate's or flag's record,
    because a planning turn that changed nothing is a fire, not a trial.

    Structural, not textual (#196). This used to be one byte-regex over the
    whole file — fast, and wrong in the one direction that matters: a session
    that only *read* a hook, a settings file, or a transcript fixture has
    `"name": "Edit"` sitting in a tool result and was counted as having edited.
    All 27 stop-gate refusals in the 30 days before the fix read `exposed:
    true`, including the "just questions" sessions the liveness rule
    (ADR-0033) exists for, so the flag could not tell the two apart. The regex
    survives as a prefilter — only a line it matches is JSON-parsed — so a
    multi-MB transcript still costs milliseconds; the parse then keeps only an
    assistant-role message's own `tool_use` blocks, which is the one place an
    edit the session performed can appear. A line that matches the prefilter
    but won't parse is skipped, never counted.
    """
    transcript_path = payload.get("transcript_path") if isinstance(payload, dict) else None
    if not transcript_path:
        return None, 0
    try:
        data = Path(transcript_path).read_bytes()
    except Exception:
        return None, 0
    n = 0
    for line in data.splitlines():
        if not EDIT_TOOL_RE.search(line):
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        message = rec.get("message")
        if not isinstance(message, dict):
            continue
        if message.get("role") != "assistant" and rec.get("type") != "assistant":
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if (isinstance(block, dict) and block.get("type") == "tool_use"
                    and block.get("name") in EDIT_TOOLS):
                n += 1
    return n > 0, n


# --- liveness: who else is working in this project right now ------------------

# How recently another session must have written a run row to count as active in a
# project. Five minutes is one long tool call: a session mid-`bin/lint` or mid-edit
# writes a row per tool call (validate-bash alone is the machine's hottest hook), so a
# session that has gone quiet for longer than this is not mid-work — it is gone, or
# thinking, and either way the next red check in that checkout has no one else to belong
# to. Bounded above by how long a break may stay unforced once its author walks away.
LIVENESS_SECONDS = 300
_LIVENESS_TAIL_BYTES = 256 * 1024


def active_sessions(project: str, exclude_session_id: str | None = None,
                    within_seconds: int = LIVENESS_SECONDS,
                    log_dir: Path | str | None = None,
                    now: datetime | None = None) -> dict[str, str]:
    """`{session_id: latest_ts}` for every *other* session that wrote a run row for
    `project` within `within_seconds` — the Stop gate's liveness signal (ADR-0033).

    The one place a gate reads the run log back. `_harness.py` states the seam the other
    way round — reading is a grader's and a report's job — and this is the deliberate
    exception, kept narrow: today's and yesterday's files only (a window can straddle
    midnight), the last `_LIVENESS_TAIL_BYTES` of each, rows filtered on `project` and
    `ts`. It answers exactly one question — is a different session provably mid-work in
    this checkout *right now* — and the rows are the cheapest signal that already exists
    for it: every tool-level hook writes one per fire, so a working session leaves a
    heartbeat without any hook having to add one on the hot path.

    `project` is the basename of the payload's `cwd`, the same field `run_row` stamps,
    so a worktree (`wt-<tag>`) never collides with the checkout it was cut from. A file
    that can't be read, a line that won't parse, a `ts` in an unexpected shape: skipped.
    Unknowable liveness reads as "nobody", which on the Stop gate is the *blocking*
    direction — the safe one.
    """
    base = Path(log_dir) if log_dir is not None else LOG_DIR
    now = now or datetime.now()
    cutoff = now - timedelta(seconds=within_seconds)
    days = {now.date(), (now - timedelta(seconds=within_seconds)).date()}
    seen: dict[str, str] = {}
    for day in sorted(days):
        try:
            files = sorted(base.glob(f"*-{day:%Y-%m-%d}.jsonl"))
        except OSError:
            continue
        for f in files:
            try:
                with f.open("rb") as fh:
                    fh.seek(0, 2)
                    size = fh.tell()
                    fh.seek(max(0, size - _LIVENESS_TAIL_BYTES))
                    tail = fh.read().decode("utf-8", errors="replace")
            except OSError:
                continue
            for line in tail.splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(row, dict) or row.get("project") != project:
                    continue
                sid = row.get("session_id")
                if not isinstance(sid, str) or not sid or sid == exclude_session_id:
                    continue
                ts = row.get("ts")
                try:
                    when = datetime.fromisoformat(ts) if isinstance(ts, str) else None
                except ValueError:
                    when = None
                if when is None or when < cutoff or when > now + timedelta(seconds=60):
                    continue
                if sid not in seen or seen[sid] < ts:
                    seen[sid] = ts
    return dict(sorted(seen.items(), key=lambda kv: kv[1], reverse=True))


# --- shell-quote spans, shared by both Bash gates ----------------------------


def quoted_spans(command: str) -> list[tuple[int, int]]:
    """Byte ranges of `command` that are a payload a command carries rather
    than the command being run: single- and double-quoted strings (the quote
    characters themselves are part of the span), and heredoc bodies. A guard
    regex on either Bash gate may only fire on a match that starts outside
    every span — the boundary this draws is "does the match start on the
    command line itself", so `cat "secrets/.env"` (a real read, whose
    argument happens to be quoted) still counts, while a `--comment
    '...cat .env...'` argument or a `<<'EOF'` body (text the command carries
    as data) does not.

    Single quotes are always literal — nothing inside one, including a
    backslash, ends it early. Double quotes honour backslash escapes. A
    heredoc (`<<TAG`, `<<-TAG`, `<<'TAG'`, `<<"TAG"`) opens a span at the
    first byte after its introducing newline and closes at the first line
    matching `^\\s*TAG\\s*$`; `<<-` still keys off the same bare `TAG`, since
    the leading `-` only changes whether the *shell* strips indentation, not
    what marks the end. Deliberately narrow to what the two gates need: no
    `$(...)`/backtick command-substitution spans, no variable expansion. An
    unterminated quote or heredoc runs to the end of the string, the same
    reading the shell would give it.

    A stray backslash outside any quote is not special here — this is
    heredoc-aware validate-bash's semantics (ADR-0012, closed #31), which
    close-gate now shares rather than its own accidental reading, so a
    command is no longer read one way by one gate and another way by the
    other.
    """
    spans: list[tuple[int, int]] = []
    i, n = 0, len(command)
    while i < n:
        c = command[i]
        if c == "'":
            start = i
            i += 1
            while i < n and command[i] != "'":
                i += 1
            i = min(i + 1, n)
            spans.append((start, i))
        elif c == '"':
            start = i
            i += 1
            while i < n and command[i] != '"':
                i += 2 if command[i] == "\\" and i + 1 < n else 1
            i = min(i + 1, n)
            spans.append((start, i))
        elif command.startswith("<<", i):
            j = i + 2
            if j < n and command[j] == "-":
                j += 1
            while j < n and command[j] in " \t":
                j += 1
            m = re.match(r"['\"]?(\w+)['\"]?", command[j:])
            if m:
                marker = m.group(1)
                nl = command.find("\n", j)
                if nl != -1:
                    body_start = nl + 1
                    end_pat = re.compile(rf"(?m)^\s*{re.escape(marker)}\s*$")
                    em = end_pat.search(command, body_start)
                    body_end = em.start() if em else n
                    spans.append((body_start, body_end))
                    i = em.end() if em else n
                    continue
            i += 1
        else:
            i += 1
    return spans


def unquoted_matches(pattern: re.Pattern, command: str,
                      spans: list[tuple[int, int]] | None = None) -> list:
    """Matches of `pattern` in `command` whose own start sits outside every
    quoted/heredoc span. The subject is always the command being *run*; a
    flag, a subcommand, or a guarded keyword inside a `--comment` body, a
    heredoc, or a string literal is data the command carries, not an
    argument it passes.

    `spans`, when a caller already computed `quoted_spans(command)` (e.g. to
    check several patterns against the same command), is reused rather than
    recomputed; omit it to have this call `quoted_spans(command)` itself.
    """
    if spans is None:
        spans = quoted_spans(command)
    return [m for m in pattern.finditer(command)
            if not any(a <= m.start() < b for a, b in spans)]
