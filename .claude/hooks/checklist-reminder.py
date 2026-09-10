#!/usr/bin/env python3
import json
import re
from pathlib import Path

import _hook

MAX_UNCHECKED_FOR_TASK_LIST = 30


def strip_fenced_blocks(text):
    out, fence = [], None
    for line in text.splitlines():
        stripped = line.lstrip()
        if fence is None:
            if stripped.startswith("```") or stripped.startswith("~~~"):
                fence = stripped[:3]
                continue
            out.append(line)
        elif stripped.startswith(fence):
            fence = None
    return "\n".join(out)


def unchecked_count(data, ok):
    if not ok:
        return None, 0
    path = Path(data["tool_input"].get("file_path", ""))
    if not path.exists() or not path.is_file():
        return None, 0
    if path.suffix not in (".md", ".markdown", ".txt"):
        return None, 0
    try:
        content = strip_fenced_blocks(path.read_text())
    except Exception:
        return None, 0
    return (len(re.findall(r"^- \[ \]", content, re.MULTILINE)),
            len(re.findall(r"^- \[x\]", content, re.MULTILINE)))


def main():
    data, ok = _hook.read_payload()
    if not _hook.enrolled(data.get("cwd")):
        return
    unchecked, checked = unchecked_count(data, ok)

    inform = unchecked is not None and 0 < unchecked <= MAX_UNCHECKED_FOR_TASK_LIST

    extra = {} if unchecked is None else {"unchecked": unchecked}
    _hook.append_log(_hook.HOOK_NAME,
                     _hook.run_row(data, "inform" if inform else "silent", **extra))
    if not inform:
        return

    progress = f" ({checked} already done)" if checked > 0 else ""
    msg = (
        f"[{_hook.HOOK_NAME}] This file has {unchecked} unchecked items{progress}. "
        f"If you complete work from this list, check off the items before finishing your response."
    )

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": msg
        }
    }))


if __name__ == "__main__":
    main()
