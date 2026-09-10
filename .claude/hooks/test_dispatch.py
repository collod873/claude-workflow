#!/usr/bin/env python3
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS_DIR = Path(__file__).resolve().parent
DISPATCH = HOOKS_DIR / "dispatch.py"
ROSTER = json.loads((HOOKS_DIR / "roster.json").read_text())

NOT_A_LIFECYCLE_HOOK = {
    "_hook.py", "_harness.py", "stub_gh.py", "conftest.py", "dispatch.py",
    "gauntlet.sh",
}


def is_lifecycle_hook(name: str) -> bool:
    if name in NOT_A_LIFECYCLE_HOOK or name.startswith("test_"):
        return False
    return name.endswith(".py") or name.endswith(".sh")


def check_roster_matches_tree() -> None:
    on_disk = {p.name for p in HOOKS_DIR.iterdir() if p.is_file() and is_lifecycle_hook(p.name)}
    rostered = {name for names in ROSTER.values() for name in names}

    missing_from_roster = sorted(on_disk - rostered)
    check("every non-helper hook file appears somewhere in roster.json",
          not missing_from_roster, missing_from_roster)

    missing_on_disk = sorted(n for n in rostered if not (HOOKS_DIR / n).is_file())
    check("every roster entry names a file that exists",
          not missing_on_disk, missing_on_disk)


def write_script(path: Path, body: str) -> Path:
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


ECHO_JSON_A = (
    "#!/usr/bin/env python3\n"
    "import json\n"
    "print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse',"
    " 'additionalContext': 'from A'}, 'systemMessage': 'from A'}))\n"
)
ECHO_JSON_B = (
    "#!/usr/bin/env python3\n"
    "import json\n"
    "print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse',"
    " 'additionalContext': 'from B'}}))\n"
)
SILENT_OK = "#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n"
TEXT_ONLY = "#!/usr/bin/env python3\nprint('plain text notice')\n"
EXITS_TWO = (
    "#!/usr/bin/env python3\n"
    "import sys\n"
    "print('refused', file=sys.stderr)\n"
    "sys.exit(2)\n"
)
EXITS_TWO_OTHER = (
    "#!/usr/bin/env python3\n"
    "import sys\n"
    "print('also refused', file=sys.stderr)\n"
    "sys.exit(2)\n"
)
EXITS_ONE = (
    "#!/usr/bin/env python3\n"
    "import sys\n"
    "print('broke', file=sys.stderr)\n"
    "sys.exit(1)\n"
)
WRITES_TRACEBACK_BUT_EXITS_ZERO = (
    "#!/usr/bin/env python3\n"
    "import sys\n"
    "print('Traceback (most recent call last):', file=sys.stderr)\n"
    "print('  something went wrong', file=sys.stderr)\n"
    "sys.exit(0)\n"
)
RECORDS_INPUT = (
    "#!/usr/bin/env python3\n"
    "import json, os, sys\n"
    "data = os.read(0, 1 << 20)\n"
    "row = json.dumps({'payload': data.decode('utf-8', 'replace'),\n"
    "                  'marker': os.environ.get('RECORD_MARKER', '')})\n"
    "with open(os.environ['RECORD_PATH'], 'a') as f:\n"
    "    f.write(row + chr(10))\n"
    "sys.exit(0)\n"
)


def build_fixture(tmp: Path, roster_map: dict) -> Path:
    hooks = tmp / "hooks"
    hooks.mkdir()
    (hooks / "dispatch.py").write_text(DISPATCH.read_text())
    (hooks / "_hook.py").write_text((HOOKS_DIR / "_hook.py").read_text())
    (hooks / "roster.json").write_text(json.dumps(roster_map))
    return hooks


def run_dispatch(hooks_dir: Path, event: str, stdin_bytes: bytes, extra_env: dict | None = None):
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    return subprocess.run([sys.executable, str(hooks_dir / "dispatch.py"), event],
                          input=stdin_bytes, capture_output=True, env=env, timeout=_harness.HOOK_TIMEOUT * 3)


def check_merge_semantics() -> None:
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["a.py", "b.py"]})
        write_script(hooks / "a.py", ECHO_JSON_A)
        write_script(hooks / "b.py", ECHO_JSON_B)

        r = run_dispatch(hooks, "Ev", b"{}")
        check("two JSON-emitting hooks: exit 0", r.returncode == 0, r.stderr)
        doc = json.loads(r.stdout)
        check("first writer of systemMessage wins", doc.get("systemMessage") == "from A", doc)
        check("additionalContext joined by newline, in roster order",
              doc["hookSpecificOutput"]["additionalContext"] == "from A\nfrom B", doc)
        check("hookEventName present once, first writer wins",
              doc["hookSpecificOutput"]["hookEventName"] == "PreToolUse", doc)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["silent.py", "text.py"]})
        write_script(hooks / "silent.py", SILENT_OK)
        write_script(hooks / "text.py", TEXT_ONLY)
        r = run_dispatch(hooks, "Ev", b"{}")
        check("a silent hook contributes nothing; the text hook's line survives",
              r.returncode == 0 and r.stdout == b"plain text notice", r.stdout)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["a.py", "silent.py"]})
        write_script(hooks / "a.py", ECHO_JSON_A)
        write_script(hooks / "silent.py", SILENT_OK)
        r = run_dispatch(hooks, "Ev", b"{}")
        check("all-silent-but-one still prints just that one hook's JSON",
              r.returncode == 0 and json.loads(r.stdout)["systemMessage"] == "from A", r.stdout)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["silent.py"]})
        write_script(hooks / "silent.py", SILENT_OK)
        r = run_dispatch(hooks, "Ev", b"{}")
        check("every hook silent: exit 0, nothing printed",
              r.returncode == 0 and r.stdout == b"" and r.stderr == b"", (r.stdout, r.stderr))

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["one.py", "two.py", "silent.py"]})
        write_script(hooks / "one.py", EXITS_TWO)
        write_script(hooks / "two.py", EXITS_TWO_OTHER)
        write_script(hooks / "silent.py", SILENT_OK)
        record = tmp / "seen.log"
        r = run_dispatch(hooks, "Ev", b"{}", extra_env={})
        check("two hooks exit 2: dispatcher exits 2", r.returncode == 2, r.returncode)
        check("both refusals' stderr are joined",
              b"refused" in r.stderr and b"also refused" in r.stderr, r.stderr)
        check("an exit-2 result carries no stdout merge", r.stdout == b"", r.stdout)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["ok.py", "broken.py"]})
        write_script(hooks / "ok.py", ECHO_JSON_A)
        write_script(hooks / "broken.py", EXITS_ONE)
        r = run_dispatch(hooks, "Ev", b"{}")
        check("a plain non-zero, non-2 exit: dispatcher exits 1", r.returncode == 1, r.returncode)
        check("its stderr passes through", b"broke" in r.stderr, r.stderr)
        check("the other hook's JSON still printed", b"from A" in r.stdout, r.stdout)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["traceback.py"]})
        write_script(hooks / "traceback.py", WRITES_TRACEBACK_BUT_EXITS_ZERO)
        r = run_dispatch(hooks, "Ev", b"{}")
        check("a traceback on stderr counts as broken even at exit 0",
              r.returncode == 1, r.returncode)
        check("the traceback passes through", b"Traceback" in r.stderr, r.stderr)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["rec1.py", "rec2.py"]})
        write_script(hooks / "rec1.py", RECORDS_INPUT)
        write_script(hooks / "rec2.py", RECORDS_INPUT)
        record = tmp / "seen.log"
        stdin_bytes = b'{"marker": "shared-payload"}'
        run_dispatch(hooks, "Ev", stdin_bytes,
                    extra_env={"RECORD_PATH": str(record), "RECORD_MARKER": "x"})
        rows = [json.loads(line) for line in record.read_text().splitlines() if line.strip()]
        payloads = [row["payload"] for row in rows]
        check("every hook in the roster receives the identical stdin bytes",
              len(payloads) == 2 and all(p == stdin_bytes.decode() for p in payloads), payloads)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["nope.py"]})
        r = run_dispatch(hooks, "Ev", b"{}")
        check("a roster entry naming a file that does not exist: reported as broken (exit 1), "
              "never confused with a hook's own exit-2 deny",
              r.returncode == 1 and b"nope.py" in r.stderr, (r.returncode, r.stderr))

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        hooks = build_fixture(tmp, {"Ev": ["a.py"]})
        write_script(hooks / "a.py", SILENT_OK)
        r = run_dispatch(hooks, "OtherEvent", b"{}")
        check("an event with no roster entries: silent exit 0",
              r.returncode == 0 and r.stdout == b"" and r.stderr == b"", (r.stdout, r.stderr))


def check_real_hooks_per_event() -> None:
    enrolled_repo = Path(tempfile.mkdtemp(prefix="dispatch-real-"))
    subprocess.run(["git", "init", "-q", str(enrolled_repo)], check=True, capture_output=True)
    _harness.enroll(enrolled_repo)

    def payload(**fields) -> bytes:
        base = {"session_id": "sess-dispatch", "cwd": str(enrolled_repo)}
        base.update(fields)
        return json.dumps(base).encode()

    r = run_dispatch(HOOKS_DIR, "PreToolUse", payload(
        hook_event_name="PreToolUse", tool_name="Bash",
        tool_input={"command": 'gh issue close 999 --comment "done"'}))
    check("PreToolUse/real roster: a bare close is denied via close-gate, reaching the dispatcher",
          r.returncode == 0, (r.returncode, r.stderr))
    doc = json.loads(r.stdout) if r.stdout.strip() else {}
    check("PreToolUse/real roster: the merged JSON carries close-gate's deny",
          doc.get("hookSpecificOutput", {}).get("permissionDecision") == "deny", doc)

    r = run_dispatch(HOOKS_DIR, "PreToolUse", payload(
        hook_event_name="PreToolUse", tool_name="Bash", tool_input={"command": "git status"}))
    check("PreToolUse/real roster: an ordinary command passes through silently",
          r.returncode == 0 and r.stdout == b"", (r.returncode, r.stdout))

    checklist = enrolled_repo / "todo.md"
    checklist.write_text("- [ ] one\n- [ ] two\n")
    r = run_dispatch(HOOKS_DIR, "PostToolUse", payload(
        hook_event_name="PostToolUse", tool_name="Write",
        tool_input={"file_path": str(checklist)}))
    check("PostToolUse/real roster: checklist-reminder's own reminder reaches the dispatcher",
          r.returncode == 0, (r.returncode, r.stderr))
    doc = json.loads(r.stdout) if r.stdout.strip() else {}
    check("PostToolUse/real roster: additionalContext names the unchecked count",
          "2 unchecked" in doc.get("hookSpecificOutput", {}).get("additionalContext", ""), doc)

    r = run_dispatch(HOOKS_DIR, "SessionStart", payload(hook_event_name="SessionStart"))
    check("SessionStart/real roster: clone-refresh stands down (not the dedicated clone), "
          "circuit-breaker resets quietly: exit 0, silent",
          r.returncode == 0 and r.stdout == b"", (r.returncode, r.stdout, r.stderr))

    subprocess.run(["git", "-C", str(enrolled_repo), "config", "user.email", "t@example.com"],
                   check=True, capture_output=True)
    subprocess.run(["git", "-C", str(enrolled_repo), "config", "user.name", "Test"],
                   check=True, capture_output=True)
    (enrolled_repo / ".claude").mkdir(exist_ok=True)
    (enrolled_repo / ".claude" / "contract.json").write_text(
        json.dumps({"stop": {"cmd": "true", "why": "x"}}))
    subprocess.run(["git", "-C", str(enrolled_repo), "add", "."], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(enrolled_repo), "commit", "-q", "-m", "contract"], check=True,
                   capture_output=True)
    r = run_dispatch(HOOKS_DIR, "Stop", payload(hook_event_name="Stop"),
                     extra_env={"HOME": str(Path(tempfile.mkdtemp(prefix="dispatch-stop-home-")))})
    check("Stop/real roster: a clean, passing repo is silent",
          r.returncode == 0 and r.stdout == b"", (r.returncode, r.stdout, r.stderr))


def main() -> None:
    check_roster_matches_tree()
    check_merge_semantics()
    check_real_hooks_per_event()
    finish("All dispatch checks passed.")


if __name__ == "__main__":
    main()
