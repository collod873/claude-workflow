#!/usr/bin/env python3
import json
import shutil
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("log-stop-failure.py")
ROWLOG = _harness.RowLog("log-stop-failure-log-")
HOMES = []

LIVE_PAYLOAD = {
    "hook_event_name": "StopFailure",
    "session_id": "sess-failure",
    "cwd": "/home/collin/Projects/Demo",
    "error": "server_error",
    "last_assistant_message": "API Error: The response stopped arriving.",
}


def fresh_home():
    home = Path(tempfile.mkdtemp(prefix="log-stop-failure-home-"))
    HOMES.append(home)
    return home


def drive(stdin_bytes, notify=None):
    home = fresh_home()
    if notify is not None:
        (home / "bin").mkdir()
        script = home / "bin" / "notify"
        script.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$0.argv"\n')
        script.chmod(0o755)
    run = _harness.run_hook(HOOK, stdin_bytes, env=ROWLOG.env(HOME=str(home)))
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    return ROWLOG.last("log-stop-failure"), run.proc, home


def main():
    print("\n## The live payload shape, proven rather than waited for")
    rows, proc, _ = drive(json.dumps(LIVE_PAYLOAD).encode())
    check("silent on both channels; this hook only records",
          proc.stdout == b"" and proc.stderr == b"", f"out={proc.stdout!r} err={proc.stderr!r}")
    check("exactly one row per failure", len(rows) == 1, str(rows))
    row = rows[0] if rows else {}
    check("verdict is logged", row.get("verdict") == "logged", row)
    check("error is the payload's, not the 'unknown' every row on disk carries",
          row.get("error") == "server_error", row)
    check("the last assistant message survives verbatim",
          row.get("last_assistant_message") == LIVE_PAYLOAD["last_assistant_message"], row)
    check("no raw dump when the error field was present", "raw" not in row, row)

    print("\n## The common fields ride along")
    check("hook names itself", row.get("hook") == "log-stop-failure", row)
    check("event is StopFailure", row.get("event") == "StopFailure", row)
    check("session_id off the payload", row.get("session_id") == "sess-failure", row)
    check("project is the cwd basename", row.get("project") == "Demo", row)
    check("seconds is measured", isinstance(row.get("seconds"), float), row)

    print("\n## A payload whose field names moved dumps itself for debugging")
    moved = {"hook_event_name": "StopFailure", "session_id": "sess-moved",
             "errorKind": "server_error", "detail": "renamed upstream"}
    rows, _, _ = drive(json.dumps(moved).encode())
    check("unrecognised shape: one row, error falls back to unknown",
          len(rows) == 1 and rows[0].get("error") == "unknown", str(rows))
    check("unrecognised shape: the raw payload is kept so the fields can be read off it",
          rows and rows[0].get("raw", {}).get("errorKind") == "server_error", str(rows))

    print("\n## An explicit null error is not a crash")
    rows, _, _ = drive(json.dumps(dict(LIVE_PAYLOAD, error=None)).encode())
    check("null error -> unknown, row still written, raw kept",
          len(rows) == 1 and rows[0].get("error") == "unknown"
          and "raw" in rows[0], str(rows))

    print("\n## Malformed stdin is still a failure worth a row")
    for label, raw in _harness.MALFORMED_STDIN:
        rows, proc, _ = drive(raw)
        check(f"malformed({label}): one row, verdict=logged, exit 0",
              len(rows) == 1 and rows[0].get("verdict") == "logged"
              and proc.returncode == 0, str(rows))

    print("\n## The desktop notification carries the error type")
    _, _, home = drive(json.dumps(LIVE_PAYLOAD).encode(), notify=True)
    argv = (home / "bin" / "notify.argv")
    check("notify was called with the error",
          argv.exists() and "API error: server_error" in argv.read_text(),
          argv.read_text() if argv.exists() else "notify never ran")

    print("\n## A missing notify binary never costs the row")
    rows, proc, _ = drive(json.dumps(LIVE_PAYLOAD).encode())
    check("no ~/bin/notify: row still written, exit 0, no traceback",
          len(rows) == 1 and proc.returncode == 0 and b"Traceback" not in proc.stderr,
          f"rc={proc.returncode} err={proc.stderr!r}")

    print("\n## An unwritable log dir is swallowed")
    home = fresh_home()
    run = _harness.run_hook(HOOK, json.dumps(LIVE_PAYLOAD).encode(),
                            env=dict(ROWLOG.env(HOME=str(home)),
                                     STOP_GATE_LOG_DIR="/dev/null/nope"))
    check("unwritable log: exit 0, silent, no traceback",
          run.proc.returncode == 0 and run.proc.stdout == b""
          and b"Traceback" not in run.proc.stderr, f"rc={run.proc.returncode}")

    for h in HOMES:
        shutil.rmtree(h, ignore_errors=True)
    ROWLOG.cleanup()
    finish("All log-stop-failure checks passed.")


if __name__ == "__main__":
    main()
