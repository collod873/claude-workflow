#!/usr/bin/env python3
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("md-html-refresh.py")
ROWLOG = _harness.RowLog("md-html-refresh-log-")
TMP = Path(tempfile.mkdtemp(prefix="md-html-refresh-fixture-"))
subprocess.run(["git", "init", "-q", str(TMP)], capture_output=True)
_harness.enroll(TMP)

SOURCE = "# The title\n\nA paragraph.\n\n## A section\n\nMore words.\n"


def write(name, text):
    p = TMP / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def payload(file_path, tool_name="Edit", cwd=None):
    return json.dumps({
        "hook_event_name": "PostToolUse",
        "session_id": "sess-md-html-refresh",
        "cwd": cwd or str(TMP),
        "tool_name": tool_name,
        "tool_input": {"file_path": str(file_path)},
    }).encode()


def drive(stdin_bytes, env=None):
    run = _harness.run_hook(HOOK, stdin_bytes, env=env or ROWLOG.env())
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    check("silent: nothing on Claude's channel", _harness.spoken(run, "md-html-refresh") == "",
          run.proc.stdout)
    return run.proc.stdout, ROWLOG.last("md-html-refresh")


def grade(label, stdin_bytes, want_verdict, env=None):
    _, rows = drive(stdin_bytes, env=env)
    ok = len(rows) == 1 and rows[0].get("verdict") == want_verdict
    check(f"{label}: one row, verdict={want_verdict}", ok, str(rows))
    return rows


def main():
    print("\n## An enrolled Markdown file is rebuilt")
    source = write("doc.md", SOURCE)
    page = source.with_suffix(".html")
    page.write_text("<!doctype html>stale\n", encoding="utf-8")

    grade("enrolled", payload(source), "rendered")
    rebuilt = page.read_text(encoding="utf-8")
    check("the stale page is gone", "stale" not in rebuilt, rebuilt[:80])
    check("the page carries the source's title", "<title>The title</title>" in rebuilt,
          rebuilt[:200])
    check("no toc when the old page had none", 'class="toc"' not in rebuilt, rebuilt[:200])

    print("\n## A page rendered with a toc keeps it")
    toc_source = write("with-toc.md", SOURCE)
    toc_page = toc_source.with_suffix(".html")
    toc_page.write_text('<!doctype html><nav class="toc">old</nav>\n', encoding="utf-8")

    grade("toc preserved", payload(toc_source), "rendered")
    rebuilt_toc = toc_page.read_text(encoding="utf-8")
    check("the rebuild kept the toc", 'class="toc"' in rebuilt_toc, rebuilt_toc[:200])
    check("the toc is regenerated, not the old one", ">old<" not in rebuilt_toc,
          rebuilt_toc[:200])

    print("\n## Nothing else is touched")
    lonely = write("lonely.md", SOURCE)
    grade("never rendered", payload(lonely), "no-sibling")
    check("no page was invented", not lonely.with_suffix(".html").exists(), str(lonely))

    code = write("mod.ts", "export const x = 1;\n")
    code_page = write("mod.html", "<!doctype html>untouched\n")
    grade("not markdown", payload(code), "not-markdown")
    check("a same-named page is left alone",
          "untouched" in code_page.read_text(encoding="utf-8"), str(code_page))

    missing = TMP / "gone.md"
    grade("path does not exist", payload(missing), "not-markdown")

    print("\n## Malformed stdin carries no cwd, so enrollment cannot be told and it stands down")
    for label, stdin_bytes in _harness.MALFORMED_STDIN:
        stdout, rows = drive(stdin_bytes)
        check(f"malformed {label}: nothing on stdout", stdout == b"", stdout)
        check(f"malformed {label}: no row, cwd unknown means enrollment unknown", rows == [], rows)

    print("\n## Stands down when unenrolled")
    unenrolled = Path(tempfile.mkdtemp(prefix="md-html-refresh-unenrolled-"))
    subprocess.run(["git", "init", "-q", str(unenrolled)], capture_output=True)
    unenrolled_source = unenrolled / "doc.md"
    unenrolled_source.write_text(SOURCE, encoding="utf-8")
    unenrolled_page = unenrolled_source.with_suffix(".html")
    unenrolled_page.write_text("<!doctype html>stale\n", encoding="utf-8")
    stdout, rows = drive(payload(unenrolled_source, cwd=str(unenrolled)))
    check("the same rebuild is silent in an unenrolled repo", stdout == b"", stdout)
    check("an unenrolled repo writes no row", rows == [], rows)
    check("the stale page is left untouched",
          "stale" in unenrolled_page.read_text(encoding="utf-8"), "")
    shutil.rmtree(unenrolled, ignore_errors=True)

    print("\n## No node on PATH leaves the last good page standing")
    degraded_source = write("degraded.md", SOURCE)
    degraded_page = degraded_source.with_suffix(".html")
    degraded_page.write_text("<!doctype html>last good\n", encoding="utf-8")

    bare = ROWLOG.env(PATH="/nonexistent", HOME=str(TMP))
    grade("no runner", payload(degraded_source), "no-runner", env=bare)
    check("the last good page survives",
          "last good" in degraded_page.read_text(encoding="utf-8"),
          degraded_page.read_text(encoding="utf-8")[:80])

    print("\n## Every edit tool is honoured")
    for tool in ("Write", "MultiEdit", "NotebookEdit"):
        grade(f"{tool} rebuilds too", payload(source, tool_name=tool), "rendered")

    shutil.rmtree(TMP, ignore_errors=True)
    ROWLOG.cleanup()
    finish("All md-html-refresh checks passed.")


if __name__ == "__main__":
    main()
