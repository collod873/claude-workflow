#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

import _hook

VALIDATORS = {
    ".py": ["python3", "-m", "py_compile"],
    ".js": ["node", "--check"],
}

SYNTAX_CHECK_TIMEOUT_SECONDS = 8


def _validate_json(path):
    try:
        json.loads(path.read_text())
        return None
    except json.JSONDecodeError as e:
        return f"JSON parse error: {e}"
    except Exception:
        return None


def _validate_html(path):
    try:
        content = path.read_text()
    except Exception:
        return None

    import re
    for tag in ("script", "style"):
        opens = len(re.findall(rf"<{tag}[\s>]", content, re.IGNORECASE))
        closes = len(re.findall(rf"</{tag}>", content, re.IGNORECASE))
        if opens > closes:
            return f"Unclosed <{tag}> tag: {opens} opened, {closes} closed"
    return None


def validate(path):
    cmd_prefix = VALIDATORS.get(path.suffix)
    if cmd_prefix:
        try:
            result = subprocess.run(
                cmd_prefix + [str(path)],
                capture_output=True,
                text=True,
                timeout=SYNTAX_CHECK_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return "ok", f"{cmd_prefix[0]} timed out after {SYNTAX_CHECK_TIMEOUT_SECONDS}s"
        except OSError:
            return "no-runner", None
        if result.returncode != 0:
            return "ok", (result.stderr or result.stdout).strip()
        return "ok", None
    if path.suffix == ".json":
        return "ok", _validate_json(path)
    if path.suffix == ".html":
        return "ok", _validate_html(path)
    return "no-validator", None


def main():
    data, ok = _hook.read_payload()
    file_path = _hook.edited_path(data["tool_input"]) if ok else ""
    path = Path(file_path) if file_path else None

    state, error = ("no-validator", None)
    if path is not None and path.exists():
        state, error = validate(path)

    verdict = "error" if error else state
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(
        data, verdict, suffix=path.suffix if path is not None else ""))

    if not error:
        return

    if len(error) > 500:
        error = error[:500] + "\n... (truncated)"

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": (
                f"[Syntax Error] {path.name} failed validation:\n{error}\n"
                f"Fix this before continuing."
            ),
        }
    }))


if __name__ == "__main__":
    main()
