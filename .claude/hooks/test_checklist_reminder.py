#!/usr/bin/env python3
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("checklist-reminder.py")
ROWLOG = _harness.RowLog("checklist-reminder-log-")
TMP = Path(tempfile.mkdtemp(prefix="checklist-reminder-fixture-"))
subprocess.run(["git", "init", "-q", str(TMP)], capture_output=True)
_harness.enroll(TMP)

MAX_UNCHECKED = 30


def write(name, text):
    p = TMP / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    return p


def items(unchecked, checked=0):
    return "\n".join(["- [ ] todo"] * unchecked + ["- [x] done"] * checked) + "\n"


def payload(file_path, cwd=None):
    return json.dumps({
        "hook_event_name": "PostToolUse",
        "session_id": "sess-checklist",
        "cwd": cwd or str(TMP),
        "tool_name": "Read",
        "tool_input": {"file_path": str(file_path)},
    }).encode()


def drive(stdin_bytes):
    run = _harness.run_hook(HOOK, stdin_bytes, env=ROWLOG.env())
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    assert run.proc.stderr == b"", run.proc.stderr
    text = _harness.spoken(run, "checklist-reminder")
    return bool(text), text, ROWLOG.last("checklist-reminder")


def grade(label, stdin_bytes, want_inform, want_unchecked):
    informed, text, rows = drive(stdin_bytes)
    check(f"{label}: {'informs' if want_inform else 'silent'}",
          informed == want_inform, f"informed={informed} text={text[:80]!r}")
    verdict = "inform" if want_inform else "silent"
    ok = len(rows) == 1 and rows[0].get("verdict") == verdict
    if ok:
        ok = rows[0].get("unchecked") == want_unchecked
    check(f"{label}: one row, verdict={verdict}, unchecked={want_unchecked}", ok, str(rows))
    return text


def main():
    print("\n## A real checklist gets a reminder")
    text = grade("3 unchecked", payload(write("todo.md", items(3))), True, 3)
    check("message names the count", "3 unchecked items" in text, text)

    text = grade("2 unchecked, 2 done", payload(write("mixed.md", items(2, 2))), True, 2)
    check("message reports progress", "2 already done" in text, text)

    for suffix in (".markdown", ".txt"):
        grade(f"suffix {suffix}", payload(write(f"list{suffix}", items(1))), True, 1)

    print("\n## Silences that still counted the file")
    grade("no unchecked items", payload(write("done.md", items(0, 4))), False, 0)
    grade("exactly at the threshold",
          payload(write("edge.md", items(MAX_UNCHECKED))), True, MAX_UNCHECKED)
    grade("one over the threshold (a reference doc)",
          payload(write("reference.md", items(MAX_UNCHECKED + 1))), False, MAX_UNCHECKED + 1)

    print("\n## Fenced examples are not a checklist")
    fenced = "# Format\n\n```markdown\n- [ ] one\n- [ ] two\n```\n\nProse.\n"
    grade("fenced-only items", payload(write("format.md", fenced)), False, 0)
    grade("fenced examples plus one real item",
          payload(write("both.md", fenced + "\n- [ ] a real one\n")), True, 1)
    grade("tilde fences count too",
          payload(write("tilde.md", "~~~\n- [ ] x\n~~~\n")), False, 0)

    print("\n## Silences where the hook never opened anything")
    grade("suffix with no checklist meaning", payload(write("code.py", items(3))), False, None)
    grade("path that does not exist", payload(TMP / "nope.md"), False, None)
    grade("a directory, not a file", payload(TMP), False, None)
    grade("empty file_path", payload(""), False, None)

    unreadable = write("locked.md", items(2))
    unreadable.chmod(0o000)
    grade("unreadable file", payload(unreadable), False, None)
    unreadable.chmod(0o644)

    print("\n## Stands down when unenrolled")
    unenrolled = Path(tempfile.mkdtemp(prefix="checklist-reminder-unenrolled-"))
    subprocess.run(["git", "init", "-q", str(unenrolled)], capture_output=True)
    unenrolled_file = unenrolled / "todo.md"
    unenrolled_file.write_text(items(3))
    informed, _text, rows = drive(payload(unenrolled_file, cwd=str(unenrolled)))
    check("the same 3-unchecked file is silent in an unenrolled repo", not informed, informed)
    check("an unenrolled repo writes no row", rows == [], rows)
    shutil.rmtree(unenrolled, ignore_errors=True)

    print("\n## Malformed stdin carries no cwd, so enrollment cannot be told and it stands down")
    for label, raw in _harness.MALFORMED_STDIN:
        informed, _text, rows = drive(raw)
        check(f"malformed({label}): silent", not informed, informed)
        check(f"malformed({label}): no row, cwd unknown means enrollment unknown", rows == [], rows)

    print("\n## An unwritable log dir never changes the advice")
    run = _harness.run_hook(HOOK, payload(write("still.md", items(2))),
                            env=dict(ROWLOG.env(), STOP_GATE_LOG_DIR="/dev/null/nope"))
    check("unwritable log: still informs, still exit 0",
          run.proc.returncode == 0
          and "2 unchecked" in _harness.spoken(run, "checklist-reminder"),
          f"rc={run.proc.returncode} out={run.proc.stdout!r}")

    shutil.rmtree(TMP, ignore_errors=True)
    ROWLOG.cleanup()
    finish("All checklist-reminder checks passed.")


if __name__ == "__main__":
    main()
