#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import _hook

PREVIEW_CHARS = 200


def _last_assistant_preview(transcript_path: str) -> tuple[str, str, bool]:
    preview = ""
    last_tool = ""
    last_tool_failed = False
    try:
        path = Path(transcript_path)
        if not path.exists():
            return preview, last_tool, last_tool_failed
        with path.open("rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 200_000))
            tail = f.read().decode("utf-8", errors="replace").splitlines()
        for line in reversed(tail):
            try:
                rec = json.loads(line)
            except Exception:
                continue
            msg = rec.get("message", {})
            role = msg.get("role")
            if role == "assistant" and not preview:
                content = msg.get("content", [])
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text = (block.get("text") or "").strip()
                        if text:
                            preview = text[:PREVIEW_CHARS]
                            break
                    if isinstance(block, dict) and block.get("type") == "tool_use" and not last_tool:
                        last_tool = block.get("name", "")
            if role == "user" and not last_tool_failed:
                content = msg.get("content", [])
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        if block.get("is_error"):
                            last_tool_failed = True
                            break
            if preview and last_tool:
                break
    except Exception:
        pass
    return preview, last_tool, last_tool_failed


def main() -> None:
    data, ok = _hook.read_payload()
    if not ok:
        _hook.append_log("stop-fires", _hook.run_row(data, "fire"))
        return

    transcript_path = data.get("transcript_path", "")
    cwd = data.get("cwd", "")

    transcript_bytes = 0
    try:
        if transcript_path:
            transcript_bytes = Path(transcript_path).stat().st_size
    except Exception:
        pass

    preview, last_tool, last_tool_failed = _last_assistant_preview(transcript_path)
    exposed, edited_files = _hook.exposure(data)

    _hook.append_log("stop-fires", _hook.run_row(
        data, "fire",
        cwd=cwd,
        transcript_bytes=transcript_bytes,
        exposed=exposed,
        edited_files=edited_files,
        last_tool=last_tool,
        last_tool_failed=last_tool_failed,
        preview=preview,
    ))


if __name__ == "__main__":
    main()
