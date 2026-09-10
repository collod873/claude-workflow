#!/usr/bin/env python3
import json
import shutil
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("stop-fire-log.py")
ROWLOG = _harness.RowLog("stop-fire-log-")
TMP = Path(tempfile.mkdtemp(prefix="stop-fire-log-fixture-"))


def transcript(name, tools=(), preview=None, tool_error=False):
    lines = []
    for tool in tools:
        lines.append(json.dumps({"message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": tool, "input": {}}]}}))
    if tool_error:
        lines.append(json.dumps({"message": {"role": "user", "content": [
            {"type": "tool_result", "is_error": True, "content": "boom"}]}}))
    if preview is not None:
        lines.append(json.dumps({"message": {"role": "assistant", "content": [
            {"type": "text", "text": preview}]}}))
    p = TMP / name
    p.write_text("\n".join(lines) + ("\n" if lines else ""))
    return p


def payload(transcript_path=None, cwd="/home/collin/Projects/Demo", session="sess-fire"):
    body = {"hook_event_name": "Stop", "session_id": session, "cwd": cwd}
    if transcript_path is not None:
        body["transcript_path"] = str(transcript_path)
    return json.dumps(body).encode()


def drive(stdin_bytes):
    run = _harness.run_hook(HOOK, stdin_bytes, env=ROWLOG.env())
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    check("silent on both channels", run.proc.stdout == b"" and run.proc.stderr == b"",
          f"out={run.proc.stdout!r} err={run.proc.stderr!r}")
    return ROWLOG.last("stop-fire-log")


def main():
    print("\n## An exposed stop: the session edited files")
    t = transcript("edited.jsonl", tools=["Read", "Edit", "Write"], preview="Done, three files.")
    rows = drive(payload(t))
    check("one row per fire", len(rows) == 1, str(rows))
    row = rows[0] if rows else {}
    check("verdict is fire; this hook decides nothing", row.get("verdict") == "fire", row)
    check("exposed is true, with the edit count", row.get("exposed") is True
          and row.get("edited_files") == 2, row)
    check("preview carries the closing message",
          row.get("preview") == "Done, three files.", row)

    rows_no_prose = drive(payload(transcript("tools-only.jsonl", tools=["Read", "Edit", "Write"])))
    check("last_tool is the newest tool_use when the turn ended on a tool",
          rows_no_prose and rows_no_prose[0].get("last_tool") == "Write", str(rows_no_prose))
    check("last_tool is empty when the turn ended on prose",
          row.get("last_tool") == "", row)
    check("transcript_bytes is the file's real size",
          row.get("transcript_bytes") == t.stat().st_size, row)

    print("\n## The common fields come from run_row, not from this hook")
    check("hook names itself", row.get("hook") == "stop-fire-log", row)
    check("event is Stop", row.get("event") == "Stop", row)
    check("session_id off the payload", row.get("session_id") == "sess-fire", row)
    check("project is the cwd basename", row.get("project") == "Demo", row)
    check("cwd survives in full for ~/bin/stop-stats",
          row.get("cwd") == "/home/collin/Projects/Demo", row)
    check("seconds is measured", isinstance(row.get("seconds"), float), row)

    print("\n## The filename is stop-fires, the mechanism is stop-fire-log")
    written = sorted(p.name for p in (ROWLOG.root / str(ROWLOG.n)).glob("*.jsonl"))
    check("the file ~/bin/stop-stats globs is the one written",
          len(written) == 1 and written[0].startswith("stop-fires-"), written)
    check("the row still names the hook, so hook-report can group on it",
          row.get("hook") == "stop-fire-log", row)

    print("\n## A planning turn is a fire, not a trial")
    rows = drive(payload(transcript("planning.jsonl", tools=["Read", "Grep"])))
    check("read-only transcript -> exposed false, zero edits",
          len(rows) == 1 and rows[0].get("exposed") is False
          and rows[0].get("edited_files") == 0, str(rows))

    print("\n## Unknowable is not 'no'")
    for label, p in [("no transcript_path", None), ("path does not exist", TMP / "gone.jsonl")]:
        rows = drive(payload(p))
        check(f"{label}: exposed is null, and the fire is still counted",
              len(rows) == 1 and rows[0].get("exposed") is None, str(rows))

    print("\n## A failed last tool is recorded")
    rows = drive(payload(transcript("failed.jsonl", tools=["Bash"], tool_error=True,
                                    preview="That did not work.")))
    check("last_tool_failed is true", len(rows) == 1
          and rows[0].get("last_tool_failed") is True, str(rows))

    print("\n## Malformed stdin is still a Stop")
    for label, raw in _harness.MALFORMED_STDIN:
        rows = drive(raw)
        check(f"malformed({label}): one row, verdict=fire",
              len(rows) == 1 and rows[0].get("verdict") == "fire", str(rows))

    print("\n## An unwritable log dir is silent, not fatal")
    run = _harness.run_hook(HOOK, payload(t),
                            env=dict(ROWLOG.env(), STOP_GATE_LOG_DIR="/dev/null/nope"))
    check("unwritable log: exit 0, no output, no traceback",
          run.proc.returncode == 0 and run.proc.stdout == b"" and run.proc.stderr == b"",
          f"rc={run.proc.returncode} err={run.proc.stderr!r}")

    shutil.rmtree(TMP, ignore_errors=True)
    ROWLOG.cleanup()
    finish("All stop-fire-log checks passed.")


if __name__ == "__main__":
    main()
