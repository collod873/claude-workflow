#!/usr/bin/env python3
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

_STARTED = time.monotonic()

_HOOKS_DIR = Path(__file__).resolve().parent
_BIN_CANDIDATES = (_HOOKS_DIR.parent / "bin", _HOOKS_DIR.parent.parent / "bin")
BIN = next((c for c in _BIN_CANDIDATES if c.is_dir()), _BIN_CANDIDATES[0])
if str(BIN) not in sys.path:
    sys.path.insert(0, str(BIN))

def _caller_stem() -> str:
    main = sys.modules.get("__main__")
    path = getattr(main, "__file__", None) or (sys.argv[0] if sys.argv else "")
    if not path:
        return "_hook"
    return Path(path).resolve().stem

HOOK_NAME = _caller_stem()

def deny(msg: str) -> None:
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

def read_payload() -> tuple[dict, bool]:
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

LOG_DIR = Path(os.environ.get("STOP_GATE_LOG_DIR") or (Path.home() / ".claude" / "logs"))

LOG_RETENTION_DAYS = 30

def append_log(hook: str, row: dict, *, path: Path | str | None = None) -> None:
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

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
EDIT_TOOL_RE = re.compile(rb'"name"\s*:\s*"(?:Edit|Write|MultiEdit|NotebookEdit)"')

EDIT_TOOL_MATCHER = "|".join(EDIT_TOOLS)

def edited_path(tool_input: dict) -> str:
    if not isinstance(tool_input, dict):
        return ""
    for key in ("file_path", "notebook_path"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            return value
    return ""

def new_content(tool_input: dict) -> str:
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

LIVENESS_SECONDS = 300
_LIVENESS_TAIL_BYTES = 256 * 1024

def active_sessions(project: str, exclude_session_id: str | None = None,
                    within_seconds: int = LIVENESS_SECONDS,
                    log_dir: Path | str | None = None,
                    now: datetime | None = None) -> dict[str, str]:
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

def quoted_spans(command: str) -> list[tuple[int, int]]:
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
    if spans is None:
        spans = quoted_spans(command)
    return [m for m in pattern.finditer(command)
            if not any(a <= m.start() < b for a, b in spans)]
