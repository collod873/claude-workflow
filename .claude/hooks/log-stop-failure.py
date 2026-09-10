#!/usr/bin/env python3
import subprocess
from pathlib import Path

import _hook

NOTIFY_TIMEOUT_SECONDS = 5


def main():
    data, _ = _hook.read_payload()

    error = data.get("error", "") or "unknown"
    last_assistant_message = data.get("last_assistant_message", "")

    extra = {"error": error}
    if last_assistant_message:
        extra["last_assistant_message"] = last_assistant_message
    if error == "unknown":
        extra["raw"] = data

    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(data, "logged", **extra))

    notif = f"API error: {error}"
    try:
        subprocess.run(
            [str(Path.home() / "bin" / "notify"), "Claude Code", notif],
            timeout=NOTIFY_TIMEOUT_SECONDS,
        )
    except Exception:
        pass


if __name__ == "__main__":
    main()
