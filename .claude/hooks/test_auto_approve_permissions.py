#!/usr/bin/env python3
import json
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("auto-approve-permissions.py")
ROWLOG = _harness.RowLog("auto-approve-log-")

INTERACTIVE = [
    "AskUserQuestion",
    "ExitPlanMode",
    "mcp__claude_ai_Gmail__complete_authentication",
    "mcp__claude_ai_Google_Calendar__complete_authentication",
    "mcp__plugin_figma_figma__complete_authentication",
]

APPROVED = ["Bash", "Read", "Edit", "WebFetch", "mcp__claude_ai_Gmail__search_threads", ""]


def payload(tool_name, **extra):
    return json.dumps({
        "hook_event_name": "PermissionRequest",
        "session_id": "sess-approve",
        "cwd": "/home/collin/Projects/Demo",
        "tool_name": tool_name,
        **extra,
    }).encode()


def drive(stdin_bytes):
    run = _harness.run_hook(HOOK, stdin_bytes, env=ROWLOG.env())
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    assert run.proc.stderr == b"", run.proc.stderr
    decision = run.hook_specific_output.get("decision") or {}
    allowed = decision.get("behavior") == "allow"
    return allowed, ROWLOG.last("auto-approve-permissions")


def grade(label, tool_name, want_allowed, want_verdict, stdin_bytes=None):
    allowed, rows = drive(payload(tool_name) if stdin_bytes is None else stdin_bytes)
    check(f"{label}: {'approved' if want_allowed else 'passed through'}",
          allowed == want_allowed, f"allowed={allowed}")
    check(f"{label}: one row, verdict={want_verdict}",
          len(rows) == 1 and rows[0].get("verdict") == want_verdict, str(rows))
    return rows


def main():
    print("\n## Interactive tools reach the human")
    for tool in INTERACTIVE:
        grade(tool, tool, False, "passthrough")

    print("\n## Everything else is approved")
    for tool in APPROVED:
        rows = grade(tool or "<no tool_name>", tool, True, "allow")
        check(f"{tool or '<no tool_name>'}: row names the tool",
              rows and rows[0].get("tool") == tool, str(rows))

    print("\n## The row carries the common fields")
    rows = grade("common fields", "Bash", True, "allow")
    row = rows[0] if rows else {}
    check("row: event is PermissionRequest", row.get("event") == "PermissionRequest", row)
    check("row: session_id off the payload", row.get("session_id") == "sess-approve", row)
    check("row: project is the cwd basename", row.get("project") == "Demo", row)
    check("row: seconds is measured", isinstance(row.get("seconds"), float), row)

    print("\n## Malformed stdin fails open, and is still a fire")
    for label, raw in _harness.MALFORMED_STDIN:
        allowed, rows = drive(raw)
        parses = raw.strip() == b"{}"
        check(f"malformed({label}): decision is {'allow' if parses else 'passthrough'}",
              allowed == parses, f"allowed={allowed}")
        check(f"malformed({label}): still exactly one row",
              len(rows) == 1 and rows[0].get("verdict") == ("allow" if parses else "bad-stdin"),
              str(rows))

    print("\n## An unwritable log dir never changes the decision")
    run = _harness.run_hook(HOOK, payload("Bash"),
                            env=dict(ROWLOG.env(), STOP_GATE_LOG_DIR="/dev/null/nope"))
    hso = run.hook_specific_output.get("decision") or {}
    check("unwritable log: still approves, still exit 0",
          run.proc.returncode == 0 and hso.get("behavior") == "allow",
          f"rc={run.proc.returncode} out={run.proc.stdout!r}")

    ROWLOG.cleanup()
    finish("All auto-approve-permissions checks passed.")


if __name__ == "__main__":
    main()
