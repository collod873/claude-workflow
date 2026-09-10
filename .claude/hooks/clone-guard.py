#!/usr/bin/env python3
import sys
from pathlib import Path

import _hook

CLONE_ROOT = Path(__file__).resolve().parents[2]
TARGET_ROOT = Path.home() / ".agents" / "workflow"
WORKING_CHECKOUT = "/home/collin/Claude Projects/Workflow"


def guarded_path(tool_name: str, tool_input: dict) -> Path | None:
    if tool_name not in _hook.EDIT_TOOLS:
        return None
    file_path = _hook.edited_path(tool_input)
    if not file_path:
        return None
    try:
        target = Path(file_path).resolve()
    except OSError:
        return None
    try:
        target.relative_to(CLONE_ROOT.resolve())
    except ValueError:
        return None
    return target


def main() -> None:
    data, ok = _hook.read_payload()
    if CLONE_ROOT.resolve() != TARGET_ROOT.resolve():
        return
    if not ok:
        return

    target = guarded_path(data.get("tool_name"), data["tool_input"])
    if target is None:
        return

    message = (
        f"[{_hook.HOOK_NAME}] {target} is inside the dedicated clone at {CLONE_ROOT}, "
        f"which is never edited in place. Make this change in the working checkout at "
        f"{WORKING_CHECKOUT} instead."
    )
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(data, "deny", path=str(target)))
    print(message, file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
