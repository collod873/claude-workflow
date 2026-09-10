#!/usr/bin/env python3
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
import _hook
from _harness import check, finish

HOOKS_DIR = Path(__file__).resolve().parent

QUOTED_SPAN_CASES: list[tuple[str, str, list[tuple[int, int]]]] = [
    ("no-quotes",
     "gh issue close 5",
     []),
    ("single-quoted-arg",
     "grep 'foo' file",
     [(5, 10)]),
    ("double-quoted-arg",
     'cat "secrets/.env"',
     [(4, 18)]),
    ("double-quoted-escaped-quote",
     'echo "a\\"b"',
     [(5, 11)]),
    ("unterminated-single-quote",
     "echo 'abc",
     [(5, 9)]),
    ("heredoc-unquoted-marker",
     "cat <<EOF\nbody line\nEOF",
     [(10, 20)]),
    ("heredoc-dash-quoted-marker",
     "cat <<-'EOF'\nbody\nEOF",
     [(13, 18)]),
    ("heredoc-with-no-body-or-close",
     "cat <<EOF",
     []),
    ("prose-mention-single-quoted",
     "grep -rn 'gh issue close' hooks/",
     [(9, 25)]),
    ("close-comment-heredoc",
     "gh issue close 93 --comment \"$(cat <<'EOF'\n"
     "Closing record: verified via `cat .env` - MET\n"
     "EOF\n)\"",
     [(28, 95)]),
]


def check_quoted_spans():
    probe = re.compile(r"\S+")
    for label, cmd, expected in QUOTED_SPAN_CASES:
        got = _hook.quoted_spans(cmd)
        check(f"quoted_spans({label})", got == expected,
              f"cmd={cmd!r} got={got} want={expected}")
        kept = _hook.unquoted_matches(probe, cmd, expected)
        check(f"unquoted_matches({label}): no kept match starts inside a span",
              all(not any(a <= m.start() < b for a, b in expected) for m in kept),
              [m.start() for m in kept])
        check(f"unquoted_matches({label}): recomputes spans when none passed",
              [m.span() for m in _hook.unquoted_matches(probe, cmd)]
              == [m.span() for m in kept])


def check_read_payload():
    with tempfile.TemporaryDirectory() as tmp:
        fixture = Path(tmp) / "read-payload-fixture.py"
        fixture.write_text(
            "import json, sys\n"
            f"sys.path.insert(0, {str(HOOKS_DIR)!r})\n"
            "import _hook\n"
            "payload, ok = _hook.read_payload()\n"
            "print(json.dumps({'ok': ok, 'payload': payload,\n"
            "                  'tool_input_is_dict': isinstance(payload.get('tool_input'), dict)}))\n"
        )
        cases = [(label, raw, label == "empty-object") for label, raw in _harness.MALFORMED_STDIN] + [
            ("tool-input-null", b'{"tool_input": null}', True),
            ("tool-input-list", b'{"tool_input": [1]}', True),
            ("tool-input-dict", b'{"tool_input": {"command": "ls"}}', True),
            ("bad-utf8", b'\xff\xfe{}', False),
        ]
        for label, raw, want_ok in cases:
            r = _harness.run_hook(fixture, raw)
            out = json.loads(r.proc.stdout.decode() or "{}")
            check(f"read_payload({label}): ok is {want_ok}", out.get("ok") is want_ok, out)
            check(f"read_payload({label}): payload is a dict with tool_input a dict",
                  isinstance(out.get("payload"), dict)
                  and (not want_ok or out.get("tool_input_is_dict")), out)
            if not want_ok:
                check(f"read_payload({label}): payload is {{}} on failure",
                      out.get("payload") == {}, out)
        r = _harness.run_hook(fixture, b'{"tool_input": {"command": "ls"}}')
        check("read_payload: a real tool_input survives intact",
              json.loads(r.proc.stdout.decode())["payload"]["tool_input"] == {"command": "ls"},
              r.proc.stdout)


def check_append_log():
    with tempfile.TemporaryDirectory() as tmp:
        log_dir = Path(tmp)
        saved = _hook.LOG_DIR
        _hook.LOG_DIR = log_dir
        try:
            aged = log_dir / "some-hook-2000-01-01.jsonl"
            aged.write_text("{}\n")
            _hook.append_log("some-hook", {"event": "x", "ts": "fixed"})
            _hook.append_log("some-hook", {"event": "y"})
            today = log_dir / f"some-hook-{_hook.datetime.now():%Y-%m-%d}.jsonl"
            rows = [json.loads(l) for l in today.read_text().splitlines()]
            check("append_log: two rows appended", len(rows) == 2, rows)
            check("append_log: a caller's ts is kept", rows[0]["ts"] == "fixed", rows[0])
            check("append_log: ts stamped when absent, seconds precision",
                  re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", rows[1].get("ts", "")),
                  rows[1])
            check("append_log: pre-aged sibling pruned", not aged.exists())

            verbatim = log_dir / "nested" / "exact-name-2000-01-01.jsonl"
            _hook.append_log("ignored", {"k": 1}, path=verbatim)
            _hook.append_log("ignored", {"k": 2}, path=verbatim)
            check("append_log(path=): written verbatim, mkdir'd, not pruned",
                  verbatim.exists() and len(verbatim.read_text().splitlines()) == 2)

            unwritable = Path(os.devnull) / "x" / "y.jsonl"
            _hook.append_log("ignored", {"k": 3}, path=unwritable)
            check("append_log: an unwritable target is swallowed", True)
        finally:
            _hook.LOG_DIR = saved


def check_run_row():
    payload = {
        "hook_event_name": "PostToolUseFailure",
        "session_id": "sess-9",
        "cwd": "/home/someone/Projects/Lumaria",
    }
    row = _hook.run_row(payload, "warn", failures=3)
    for field in ("hook", "event", "session_id", "project", "verdict", "seconds", "ts"):
        if field == "ts":
            check("run_row: ts is left to append_log", field not in row, row)
            continue
        check(f"run_row: stamps {field}", field in row, row)
    check("run_row: hook is the caller's own stem", row["hook"] == _hook.HOOK_NAME, row)
    check("run_row: event comes off the payload", row["event"] == "PostToolUseFailure", row)
    check("run_row: session_id comes off the payload", row["session_id"] == "sess-9", row)
    check("run_row: project is the cwd basename", row["project"] == "Lumaria", row)
    check("run_row: verdict is the caller's word", row["verdict"] == "warn", row)
    check("run_row: seconds is a number", isinstance(row["seconds"], float), row)
    check("run_row: extra rides alongside", row["failures"] == 3, row)

    for label, bad in (("empty", {}), ("nulls", {"cwd": None, "session_id": None,
                                                 "hook_event_name": None})):
        row = _hook.run_row(bad, "bad-stdin")
        check(f"run_row({label}): no field is missing",
              row["event"] == "" and row["session_id"] == "" and row["project"] == "", row)

    check("run_row: a caller may override a stamped field",
          _hook.run_row({"cwd": "/a/b"}, "clean", project="elsewhere")["project"] == "elsewhere")

    gate = _hook.run_row({"hook_event_name": "PreToolUse", "session_id": "s",
                          "tool_use_id": "toolu_01ABC"}, "deny")
    check("run_row: stamps the payload's tool_use_id on a tool event",
          gate.get("tool_use_id") == "toolu_01ABC", gate)
    stop = _hook.run_row({"hook_event_name": "Stop", "session_id": "s"}, "clean")
    check("run_row: no tool_use_id on a Stop payload, which carries none",
          "tool_use_id" not in stop, stop)
    for label, empty in (("null", {"tool_use_id": None}), ("blank", {"tool_use_id": ""})):
        check(f"run_row: a {label} tool_use_id is no id at all",
              "tool_use_id" not in _hook.run_row(empty, "clean"), empty)


def check_deny_envelope():
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        _hook.deny("something went wrong")
    out = json.loads(buf.getvalue())
    hso = out.get("hookSpecificOutput", {})
    expected_msg = f"[{_hook.HOOK_NAME}] something went wrong"
    check("deny: hookEventName is PreToolUse",
          hso.get("hookEventName") == "PreToolUse", hso)
    check("deny: permissionDecision is deny",
          hso.get("permissionDecision") == "deny", hso)
    check("deny: permissionDecisionReason and systemMessage are identical",
          bool(hso.get("permissionDecisionReason"))
          and hso.get("permissionDecisionReason") == out.get("systemMessage"), out)
    check("deny: message is [HOOK_NAME]-prefixed",
          out.get("systemMessage") == expected_msg,
          f"got={out.get('systemMessage')!r} want={expected_msg!r}")


def check_exposure_fixture():
    fixture = "\n".join([
        json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Read", "input": {}}]}}),
        json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Edit", "input": {"file_path": "a.py"}}]}}),
        json.dumps({"message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Write", "input": {"file_path": "b.py"}}]}}),
        json.dumps({"type": "user", "message": {"role": "user", "content": "no tool use here"}}),
        json.dumps({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "content": '{"type": "tool_use", "name": "Edit"}'}]}}),
        '{"name": "Edit" matches the prefilter, is not JSON',
    ])
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as fh:
        fh.write(fixture)
        transcript_path = fh.name
    try:
        exposed, n = _hook.exposure({"transcript_path": transcript_path})
        check("exposure: exposed is True on a transcript with edits", exposed is True, (exposed, n))
        check("exposure: counts exactly the assistant's Edit/Write/... tool_use blocks",
              n == 2, n)

        read_only = "\n".join([
            json.dumps({"type": "user", "message": {"role": "user", "content": [
                {"type": "tool_result", "content": '"name": "Edit" quoted in a result'}]}}),
            json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "text", "text": 'discussing "name": "Write" in prose'}]}}),
        ])
        Path(transcript_path).write_text(read_only)
        exposed_ro, n_ro = _hook.exposure({"transcript_path": transcript_path})
        check("exposure: a session that only read or discussed an edit tool is NOT exposed",
              exposed_ro is False and n_ro == 0, (exposed_ro, n_ro))

        exposed_none, n_none = _hook.exposure({"transcript_path": "/no/such/file"})
        check("exposure: unreadable transcript is unknown, not 'no'",
              exposed_none is None and n_none == 0, (exposed_none, n_none))

        exposed_missing, n_missing = _hook.exposure({})
        check("exposure: missing transcript_path is unknown, not 'no'",
              exposed_missing is None and n_missing == 0, (exposed_missing, n_missing))
    finally:
        Path(transcript_path).unlink(missing_ok=True)


def check_active_sessions():
    from datetime import datetime, timedelta
    log_dir = Path(tempfile.mkdtemp(prefix="active-sessions-"))
    now = datetime(2026, 8, 29, 0, 2, 0)
    day = f"{now:%Y-%m-%d}"
    yesterday = f"{now - timedelta(days=1):%Y-%m-%d}"

    def ts(seconds_ago):
        return (now - timedelta(seconds=seconds_ago)).isoformat(timespec="seconds")

    def row(session_id, project, seconds_ago, **extra):
        return json.dumps(dict(hook="validate-bash", session_id=session_id,
                               project=project, verdict="allow", ts=ts(seconds_ago),
                               **extra))

    (log_dir / f"validate-bash-{day}.jsonl").write_text("\n".join([
        row("me", "skills", 5),
        row("other-a", "skills", 30),
        row("other-a", "skills", 90),
        row("other-b", "lumaria", 10),
        row("", "skills", 10),
        "{not json",
        json.dumps([1, 2, 3]),
        row("other-d", "skills", 60 * 60),
    ]) + "\n")
    (log_dir / f"stop-gate-{yesterday}.jsonl").write_text(
        row("other-c", "skills", 4 * 60) + "\n")
    try:
        got = _hook.active_sessions("skills", exclude_session_id="me",
                                    within_seconds=300, log_dir=log_dir, now=now)
        check("active_sessions: exactly the live foreign sessions for this project",
              set(got) == {"other-a", "other-c"}, got)
        check("active_sessions: a session's latest row is the one reported",
              got.get("other-a") == ts(30), got)
        check("active_sessions: newest first",
              list(got) == ["other-a", "other-c"], got)
        check("active_sessions: an empty or missing log dir reads as nobody",
              _hook.active_sessions("skills", log_dir=log_dir / "nope", now=now) == {}, "")
        check("active_sessions: a project nobody touched reads as nobody",
              _hook.active_sessions("pwpp", log_dir=log_dir, now=now) == {}, "")
    finally:
        shutil.rmtree(log_dir, ignore_errors=True)


def check_caller_stem_subprocess():
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        fixture = tmp_path / "some-fixture-hook.py"
        fixture.write_text(
            "import sys\n"
            f"sys.path.insert(0, {str(HOOKS_DIR)!r})\n"
            "import _hook\n"
            "print(_hook._caller_stem())\n"
        )
        r = _harness.run_hook(fixture, b"")
        check("_caller_stem: names the running script, not _hook",
              r.proc.stdout.decode().strip() == "some-fixture-hook", r.proc.stdout)

        symlink = tmp_path / "renamed-via-symlink.py"
        symlink.symlink_to(fixture)
        r2 = _harness.run_hook(symlink, b"")
        check("_caller_stem: through a symlink, resolves to the real file's stem",
              r2.proc.stdout.decode().strip() == "some-fixture-hook", r2.proc.stdout)


ROSTER = HOOKS_DIR / "roster.json"

EDIT_PAYLOADS = [
    ("Write", {"file_path": "/tmp/a.py", "content": "SECRET=1"}, "/tmp/a.py", "SECRET=1"),
    ("Edit", {"file_path": "/tmp/a.py", "old_string": "gone", "new_string": "SECRET=1"},
     "/tmp/a.py", "SECRET=1"),
    ("MultiEdit", {"file_path": "/tmp/a.py", "edits": [
        {"old_string": "x", "new_string": "SECRET=1"},
        {"old_string": "y", "new_string": "SECRET=2"}]},
     "/tmp/a.py", "SECRET=1\nSECRET=2"),
    ("NotebookEdit", {"notebook_path": "/tmp/a.ipynb", "cell_id": "c1",
                      "new_source": "SECRET=1"},
     "/tmp/a.ipynb", "SECRET=1"),
]


def check_edit_payload_readers():
    for tool, tool_input, want_path, want_content in EDIT_PAYLOADS:
        check(f"edited_path({tool}) -> {want_path}",
              _hook.edited_path(tool_input) == want_path,
              _hook.edited_path(tool_input))
        check(f"new_content({tool}) -> the new text, all of it",
              _hook.new_content(tool_input) == want_content,
              repr(_hook.new_content(tool_input)))

    removing = {"file_path": "/tmp/a.py", "old_string": "AKIAIOSFODNN7EXAMPLE",
                "new_string": "os.environ['KEY']"}
    check("new_content: old_string is never collected; deleting a secret is not writing one",
          "AKIA" not in _hook.new_content(removing), _hook.new_content(removing))

    for junk in ({}, {"file_path": 5}, {"content": None}, {"edits": "not a list"},
                 {"edits": [None, {"new_string": 7}]}):
        check(f"edited_path/new_content survive junk: {junk}",
              isinstance(_hook.edited_path(junk), str)
              and isinstance(_hook.new_content(junk), str), junk)
    for junk in (None, "string", 42):
        check(f"edited_path/new_content survive a non-dict tool_input: {junk!r}",
              _hook.edited_path(junk) == "" and _hook.new_content(junk) == "", junk)


def check_read_stdin_bytes():
    class FakeStdin:
        def __init__(self, data: bytes):
            self.buffer = io.BytesIO(data)

    saved = sys.stdin
    try:
        sys.stdin = FakeStdin(b'{"a": 1}')
        check("read_stdin_bytes: returns the raw bytes on stdin, undecoded",
              _hook.read_stdin_bytes() == b'{"a": 1}', "")
        sys.stdin = FakeStdin(b"")
        check("read_stdin_bytes: empty stdin is empty bytes, not an error",
              _hook.read_stdin_bytes() == b"", "")
    finally:
        sys.stdin = saved


def check_enrolled():
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td) / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], capture_output=True)

        check("enrolled: a repo with no .github/workflows is not enrolled",
              _hook.enrolled(str(repo)) is False, "")

        nested = repo / "src" / "deep"
        nested.mkdir(parents=True)
        check("enrolled: a path below the repo root, still not enrolled",
              _hook.enrolled(str(nested)) is False, "")

        workflows = repo / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "other.yml").write_text("on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n")
        check("enrolled: a workflow with no caller stub is still not enrolled",
              _hook.enrolled(str(repo)) is False, "")

        (workflows / "caller.yml").write_text(
            "on: push\njobs:\n  call:\n    uses: collod873/claude-workflow/.github/workflows/x.yml@main\n"
        )
        _hook._ENROLLED_CACHE.clear()
        check("enrolled: a caller stub under .github/workflows/ makes the repo enrolled",
              _hook.enrolled(str(repo)) is True, "")
        check("enrolled: a path below an enrolled root walks up to it",
              _hook.enrolled(str(nested)) is True, "")

        (workflows / "caller.yml").unlink()
        check("enrolled: cached per process, a later removal does not flip the answer",
              _hook.enrolled(str(repo)) is True, "")
        _hook._ENROLLED_CACHE.clear()
        check("enrolled: clearing the cache re-reads the tree",
              _hook.enrolled(str(repo)) is False, "")

    with tempfile.TemporaryDirectory() as td:
        outside = Path(td) / "not-a-repo"
        outside.mkdir()
        check("enrolled: no .git anywhere above is not enrolled",
              _hook.enrolled(str(outside)) is False, "")

    for junk in (None, "", "/no/such/path/at/all"):
        check(f"enrolled: survives {junk!r}", _hook.enrolled(junk) is False, "")


def check_edit_matcher_registration():
    try:
        registered = json.loads(ROSTER.read_text())
    except (OSError, ValueError) as exc:
        check("roster.json unreadable: registration case skipped by name, not silently",
              True, f"{type(exc).__name__}: {exc}")
        return

    watchers = {"credential-scan.py": "PreToolUse", "post-edit-validate.py": "PostToolUse"}
    missing = [name for name, event in watchers.items() if name not in registered.get(event, [])]
    check("every edit-watching hook is registered under its event in roster.json",
          not missing, f"unregistered: {missing}")


def main():
    check_deny_envelope()
    check_exposure_fixture()
    check_active_sessions()
    check_caller_stem_subprocess()
    check_quoted_spans()
    check_read_stdin_bytes()
    check_read_payload()
    check_append_log()
    check_run_row()
    check_edit_payload_readers()
    check_enrolled()
    check_edit_matcher_registration()
    finish("All _hook.py checks passed.")


if __name__ == "__main__":
    main()
