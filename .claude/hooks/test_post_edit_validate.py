#!/usr/bin/env python3
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("post-edit-validate.py")
ROWLOG = _harness.RowLog("post-edit-validate-log-")
TMP = Path(tempfile.mkdtemp(prefix="post-edit-validate-fixture-"))
subprocess.run(["git", "init", "-q", str(TMP)], capture_output=True)
_harness.enroll(TMP)
HAVE_NODE = shutil.which("node") is not None


def write(name, text):
    p = TMP / name
    p.write_text(text)
    return p


def payload(file_path, cwd=None):
    return json.dumps({
        "hook_event_name": "PostToolUse",
        "session_id": "sess-validate",
        "cwd": cwd or str(TMP),
        "tool_name": "Write",
        "tool_input": {"file_path": str(file_path)},
    }).encode()


def drive(stdin_bytes):
    run = _harness.run_hook(HOOK, stdin_bytes, env=ROWLOG.env())
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    return run.hook_specific_output.get("additionalContext", ""), ROWLOG.last("post-edit-validate")


def grade(label, stdin_bytes, want_verdict, want_suffix):
    text, rows = drive(stdin_bytes)
    speaks = want_verdict == "error"
    check(f"{label}: {'reports the error' if speaks else 'stays quiet'}",
          bool(text) == speaks, f"text={text[:90]!r}")
    ok = (len(rows) == 1 and rows[0].get("verdict") == want_verdict
          and rows[0].get("suffix") == want_suffix)
    check(f"{label}: one row, verdict={want_verdict}, suffix={want_suffix!r}", ok, str(rows))
    return text


def main():
    print("\n## Python")
    grade("valid .py", payload(write("good.py", "def f():\n    return 1\n")), "ok", ".py")
    text = grade("broken .py", payload(write("bad.py", "def f(\n")), "error", ".py")
    check("python error names the file", "bad.py" in text, text)
    check("python error tells the model to fix it first",
          "Fix this before continuing" in text, text)

    print("\n## JSON")
    grade("valid .json", payload(write("good.json", '{"a": 1}')), "ok", ".json")
    text = grade("broken .json", payload(write("bad.json", "{not json")), "error", ".json")
    check("json error names the parse failure", "JSON parse error" in text, text)

    print("\n## HTML: unclosed script/style only")
    grade("balanced .html", payload(write("good.html", "<script>x</script>\n")), "ok", ".html")
    text = grade("unclosed <script>", payload(write("bad.html", "<script>x\n")), "error", ".html")
    check("html error counts opens against closes", "1 opened, 0 closed" in text, text)
    grade("unclosed <style>", payload(write("style.html", "<style>a{}\n")), "error", ".html")
    grade("unclosed div is not an error",
          payload(write("div.html", "<div>text\n")), "ok", ".html")

    print("\n## JavaScript")
    if HAVE_NODE:
        grade("valid .js", payload(write("good.js", "const a = 1;\n")), "ok", ".js")
        grade("broken .js", payload(write("bad.js", "const a = ;\n")), "error", ".js")
    else:
        check("node absent: .js cases skipped by name, not silently", True,
              "node not on PATH")

    print("\n## Degraded env: the routed validator's binary is missing")
    empty_path = Path(tempfile.mkdtemp(prefix="post-edit-validate-nopath-"))
    run = _harness.run_hook(HOOK, payload(write("degraded.js", "const a = ;\n")),
                            env=ROWLOG.env(PATH=str(empty_path)))
    rows = ROWLOG.last("post-edit-validate")
    check("missing node: exit 0, no traceback", run.proc.returncode == 0,
          f"rc={run.proc.returncode} err={run.proc.stderr[-300:]!r}")
    check("missing node: stays silent; a missing dep is not a syntax error",
          run.proc.stdout == b"" and run.proc.stderr == b"",
          f"out={run.proc.stdout!r} err={run.proc.stderr!r}")
    check("missing node: one row, verdict=no-runner, suffix='.js'",
          len(rows) == 1 and rows[0].get("verdict") == "no-runner"
          and rows[0].get("suffix") == ".js", str(rows))
    run = _harness.run_hook(HOOK, payload(write("degraded.md", "# hi\n")),
                            env=ROWLOG.env(PATH=str(empty_path)))
    rows = ROWLOG.last("post-edit-validate")
    check("missing node: an unrouted suffix is still no-validator, not no-runner",
          len(rows) == 1 and rows[0].get("verdict") == "no-validator", str(rows))
    shutil.rmtree(empty_path, ignore_errors=True)

    print("\n## No validator for this suffix: the coverage question")
    for name, text in [("notes.md", "# hi\n"), ("data.csv", "a,b\n"),
                       ("script.sh", "echo hi\n"), ("noext", "x\n")]:
        grade(f"no validator: {name}", payload(write(name, text)),
              "no-validator", Path(name).suffix)

    print("\n## Nothing to validate at all")
    grade("path that does not exist", payload(TMP / "gone.py"), "no-validator", ".py")
    grade("empty file_path", payload(""), "no-validator", "")

    print("\n## Malformed stdin carries no cwd, so enrollment cannot be told and it stands down")
    for label, raw in _harness.MALFORMED_STDIN:
        text, rows = drive(raw)
        check(f"malformed({label}): stays quiet", text == "", f"text={text[:90]!r}")
        check(f"malformed({label}): no row, cwd unknown means enrollment unknown", rows == [], rows)

    print("\n## Stands down when unenrolled")
    unenrolled = Path(tempfile.mkdtemp(prefix="post-edit-validate-unenrolled-"))
    subprocess.run(["git", "init", "-q", str(unenrolled)], capture_output=True)
    broken = unenrolled / "bad.py"
    broken.write_text("def f(\n")
    text, rows = drive(payload(broken, cwd=str(unenrolled)))
    check("the same broken .py is silent in an unenrolled repo", text == "", f"text={text[:90]!r}")
    check("an unenrolled repo writes no row", rows == [], rows)
    shutil.rmtree(unenrolled, ignore_errors=True)

    print("\n## An unwritable log dir never changes the report")
    run = _harness.run_hook(HOOK, payload(write("bad2.py", "def f(\n")),
                            env=dict(ROWLOG.env(), STOP_GATE_LOG_DIR="/dev/null/nope"))
    check("unwritable log: the syntax error still lands, still exit 0",
          run.proc.returncode == 0
          and "bad2.py" in run.hook_specific_output.get("additionalContext", ""),
          f"rc={run.proc.returncode} out={run.proc.stdout!r}")

    shutil.rmtree(TMP, ignore_errors=True)
    ROWLOG.cleanup()
    finish("All post-edit-validate checks passed.")


if __name__ == "__main__":
    main()
