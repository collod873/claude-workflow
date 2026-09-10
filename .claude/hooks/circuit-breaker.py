#!/usr/bin/env python3
import json
import os
import tempfile
import time
from pathlib import Path

import _hook

STATE_DIR = Path(os.environ.get("CIRCUIT_BREAKER_STATE")
                 or Path(tempfile.gettempdir()) / "circuit-breaker")
STALE_HOURS = 4
WARN_THRESHOLD = 3
STOP_THRESHOLD = 5

_FRESH = {"consecutive_failures": 0, "updated": 0}


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name) or "main"


def state_path(session_id: str, agent_type: str) -> Path:
    return STATE_DIR / f"{_safe(session_id or 'nosession')}--{_safe(agent_type or 'main')}.json"


def load_state(path: Path) -> dict:
    if not path.exists():
        return dict(_FRESH)
    try:
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            return dict(_FRESH)
        if time.time() - data.get("updated", 0) > STALE_HOURS * 3600:
            return dict(_FRESH)
        if not isinstance(data.get("consecutive_failures"), int):
            data["consecutive_failures"] = 0
        return data
    except (json.JSONDecodeError, OSError, ValueError, TypeError):
        return dict(_FRESH)


def save_state(path: Path, state: dict) -> None:
    state["updated"] = time.time()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state))
    except OSError:
        pass


def prune_stale() -> None:
    cutoff = time.time() - STALE_HOURS * 3600
    try:
        for f in STATE_DIR.glob("*.json"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                continue
    except OSError:
        pass


def message(count: int, tool_name: str) -> str:
    fact = f"[{_hook.HOOK_NAME}] {count} tool calls in a row failed (last: {tool_name})."
    if count >= STOP_THRESHOLD:
        return (f"{fact} If the last {count} share a cause, the next call changes the "
                f"approach, not the arguments; name that cause in one line first.")
    return (f"{fact} Before the next call, name the cause of the last error in one line, "
            f"and make that call test it.")


def _row(data, verdict, failures, **extra):
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(data, verdict, failures=failures, **extra))


def main():
    data, ok = _hook.read_payload()

    event = data.get("hook_event_name", "")
    session_id = data.get("session_id") or ""
    agent_type = data.get("agent_type") or ""
    path = state_path(str(session_id), str(agent_type))

    if event == "SessionStart":
        save_state(path, dict(_FRESH))
        prune_stale()
        _row(data, "reset", 0)
        return

    tool_name = data.get("tool_name", "unknown")
    state = load_state(path)

    if event == "PostToolUseFailure":
        if data.get("is_interrupt"):
            _row(data, "nothing", state["consecutive_failures"], tool=tool_name)
            return

        state["consecutive_failures"] += 1
        save_state(path, state)

        count = state["consecutive_failures"]
        if count < WARN_THRESHOLD:
            _row(data, "count", count, tool=tool_name)
            return

        verdict = "stop" if count >= STOP_THRESHOLD else "warn"
        msg = message(count, tool_name)
        _row(data, verdict, count, tool=tool_name, chars=len(msg))
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUseFailure",
                "additionalContext": msg,
            }
        }))

    elif event == "PostToolUse":
        if state["consecutive_failures"] > 0:
            state["consecutive_failures"] = 0
            save_state(path, state)
        _row(data, "reset", 0)

    elif not ok:
        _row(data, "bad-stdin", state["consecutive_failures"])

    else:
        _row(data, "nothing", state["consecutive_failures"])


if __name__ == "__main__":
    main()
