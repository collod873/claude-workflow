#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS_DIR = Path(__file__).resolve().parent
HOOK = HOOKS_DIR / "clone-guard.py"


def build_clone(tmp: Path) -> tuple[Path, Path]:
    home = tmp / "home"
    clone = home / ".agents" / "workflow"
    hooks = clone / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    (hooks / "clone-guard.py").write_text(HOOK.read_text())
    (hooks / "_hook.py").write_text((HOOKS_DIR / "_hook.py").read_text())
    (clone / "docs").mkdir()
    (clone / "docs" / "note.md").write_text("existing\n")
    return home, clone


def payload(tool_name: str, file_path: str) -> bytes:
    key = "notebook_path" if tool_name == "NotebookEdit" else "file_path"
    return json.dumps({
        "hook_event_name": "PreToolUse",
        "session_id": "sess-clone-guard",
        "tool_name": tool_name,
        "tool_input": {key: file_path},
    }).encode()


def run(hook: Path, home: Path, stdin_bytes: bytes):
    env = dict(os.environ)
    env["HOME"] = str(home)
    return subprocess.run([sys.executable, str(hook)], input=stdin_bytes,
                          capture_output=True, env=env, timeout=_harness.HOOK_TIMEOUT * 3)


def main() -> None:
    print("\n## Running as the dedicated clone: refuses an edit inside it")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home, clone = build_clone(tmp)
        target = clone / "docs" / "note.md"
        for tool in ("Edit", "Write", "MultiEdit"):
            r = run(clone / ".claude" / "hooks" / "clone-guard.py", home,
                   payload(tool, str(target)))
            check(f"{tool} inside the clone: exit 2", r.returncode == 2, r.stderr)
            check(f"{tool} inside the clone: names the working checkout",
                  b"/home/collin/Claude Projects/Workflow" in r.stderr, r.stderr)
            check(f"{tool} inside the clone: names the offending path",
                  str(target).encode() in r.stderr, r.stderr)
            check(f"{tool} inside the clone: no stdout at all (this is exit-2, not deny-JSON)",
                  r.stdout == b"", r.stdout)

        r = run(clone / ".claude" / "hooks" / "clone-guard.py", home,
               payload("NotebookEdit", str(clone / "docs" / "nb.ipynb")))
        check("NotebookEdit inside the clone: exit 2", r.returncode == 2, r.stderr)

    print("\n## Running as the dedicated clone: never refuses outside it")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home, clone = build_clone(tmp)
        elsewhere = tmp / "elsewhere.md"
        elsewhere.write_text("not in the clone\n")
        r = run(clone / ".claude" / "hooks" / "clone-guard.py", home,
               payload("Edit", str(elsewhere)))
        check("a path outside the clone: exit 0", r.returncode == 0, r.stderr)
        check("a path outside the clone: silent", r.stdout == b"" and r.stderr == b"",
              (r.stdout, r.stderr))

        r = run(clone / ".claude" / "hooks" / "clone-guard.py", home,
               payload("Bash", str(clone / "docs" / "note.md")))
        check("a non-edit tool naming a path inside the clone: exit 0", r.returncode == 0, r.stderr)

        for label, raw in _harness.MALFORMED_STDIN:
            r = run(clone / ".claude" / "hooks" / "clone-guard.py", home, raw)
            check(f"malformed stdin ({label}): exit 0, never refuses", r.returncode == 0, r.stderr)

    print("\n## Running from a working checkout: never refuses, even inside itself")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home = tmp / "home-not-agents"
        home.mkdir()
        target = HOOKS_DIR / "clone-guard.py"
        r = run(HOOK, home, payload("Edit", str(target)))
        check("this repo's own checkout is not ~/.agents/workflow: exit 0",
              r.returncode == 0, r.stderr)
        check("this repo's own checkout: silent", r.stdout == b"" and r.stderr == b"",
              (r.stdout, r.stderr))

    finish("All clone-guard checks passed.")


if __name__ == "__main__":
    main()
