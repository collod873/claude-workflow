#!/usr/bin/env python3
import sys
from pathlib import Path

_BIN_DIR = Path(__file__).resolve().parent
_HOOKS_CANDIDATES = (_BIN_DIR.parent / "hooks", _BIN_DIR.parent / ".claude" / "hooks")

_hook = None
for _candidate in _HOOKS_CANDIDATES:
    if not (_candidate / "_hook.py").is_file():
        continue
    if str(_candidate) not in sys.path:
        sys.path.insert(0, str(_candidate))
    try:
        import _hook
    except ImportError:
        _hook = None
    break


def append_log(verdict: str, *, tool: str | None = None, **extra) -> None:
    if _hook is None:
        return
    try:
        row = _hook.run_row({}, verdict, **extra)
        row["tool"] = tool or row.pop("hook")
        row.pop("hook", None)
        row["event"] = "bin"
        if not row.get("project"):
            row["project"] = Path.cwd().name
        _hook.append_log(row["tool"], row)
    except Exception:
        return
