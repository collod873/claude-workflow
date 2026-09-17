#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import _harness
from _harness import check, finish

HOOKS_DIR = Path(__file__).resolve().parent
GATE = HOOKS_DIR / "hook-gate.py"
CARRIED = ("hook-gate.py", "_hook.py", "_harness.py", "test_dispatch.py", "dispatch.py")
LEAN = ("hook-gate.py", "_hook.py", "_harness.py")
GATE_TIMEOUT = _harness.HOOK_TIMEOUT * 30

PASSING_SUITE = "#!/usr/bin/env python3\nprint('  [PASS] guard refuses the thing')\n"
FAILING_SUITE = ("#!/usr/bin/env python3\n"
                 "import sys\n"
                 "print('  [PASS] guard loads')\n"
                 "print('  [FAIL] guard refuses nothing: the trigger case went through')\n"
                 "sys.exit(1)\n")
HANGING_SUITE = "#!/usr/bin/env python3\nimport time\ntime.sleep(600)\n"
A_HOOK = "#!/usr/bin/env python3\nimport _hook\n_hook.read_stdin_bytes()\n"


def fixture(roster: dict, files: dict | None = None, settings: dict | None = None,
            carry: tuple = CARRIED) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="hook-gate-case-"))
    hooks = tmp / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    for name in carry:
        shutil.copy(HOOKS_DIR / name, hooks / name)
    (hooks / "roster.json").write_text(json.dumps(roster))
    for name, body in (files or {}).items():
        (hooks / name).write_text(body)
    if settings is not None:
        (tmp / ".claude" / "settings.json").write_text(json.dumps(settings))
    (tmp / "home").mkdir()
    (tmp / "home" / ".claude").mkdir()
    return hooks


def gate_env(hooks: Path, env_extra: dict | None = None) -> dict:
    home = hooks.parent.parent / "home"
    env = {**os.environ, "HOME": str(home), "STOP_GATE_LOG_DIR": str(home / "logs"),
           "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("CLAUDE_HOOK_GATE_RUNNING", None)
    env.update(env_extra or {})
    return env


def fire(hooks: Path, target: Path, tool: str = "Write", env_extra: dict | None = None):
    payload = {"hook_event_name": "PostToolUse", "session_id": "hook-gate-test",
               "cwd": str(hooks.parent.parent), "tool_name": tool,
               "tool_input": {"file_path": str(target)}}
    run = _harness.run_hook(hooks / "hook-gate.py", json.dumps(payload).encode(),
                            timeout=GATE_TIMEOUT, env=gate_env(hooks, env_extra), cwd=str(hooks))
    return run.proc, run.output


def reason_of(doc: dict) -> str:
    return doc.get("reason", "")


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True)


def check_out_of_scope_is_silent() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py"]})
    ordinary = hooks.parent.parent / "notes.md"
    ordinary.write_text("nothing to do with hooks\n")
    run, doc = fire(hooks, ordinary)
    check("a file outside any .claude/hooks directory: silent, exit 0",
          run.returncode == 0 and run.stdout == b"", (run.returncode, run.stdout))

    run, doc = fire(hooks, hooks / "hook-gate.py", tool="Bash")
    check("a tool that is not an edit: silent, so the gate costs nothing on ordinary calls",
          run.stdout == b"", run.stdout)

    would_block = fixture({"PostToolUse": ["hook-gate.py", "vanished.py"]})
    run, doc = fire(would_block, would_block / "roster.json")
    check("the recursion fixture is one the gate does block when it runs at the top",
          doc.get("decision") == "block", doc)
    run, doc = fire(would_block, would_block / "roster.json",
                    env_extra={"CLAUDE_HOOK_GATE_RUNNING": "1"})
    check("that same edit under a gate already running above it: silent, so a suite that fires "
          "hooks cannot recurse into the gate",
          run.stdout == b"", run.stdout)

    for label, stdin_bytes in _harness.MALFORMED_STDIN:
        run = _harness.run_hook(hooks / "hook-gate.py", stdin_bytes, timeout=GATE_TIMEOUT,
                                env=gate_env(hooks), cwd=str(hooks)).proc
        check(f"{label} stdin: silent and exit 0, because a PostToolUse gate cannot undo the edit "
              f"and a convenience hook fails open",
              run.returncode == 0 and run.stdout == b"", (run.returncode, run.stdout))


def check_a_broken_hook_is_named() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py", "guard.py"]},
                    {"guard.py": A_HOOK, "test_guard.py": FAILING_SUITE})
    run, doc = fire(hooks, hooks / "guard.py")
    reason = reason_of(doc)
    check("editing a hook whose own suite fails: the slot blocks (PostToolUse.decision-block)",
          doc.get("decision") == "block", doc)
    check("the block names the suite that failed",
          "test_guard.py" in reason, reason[:200])
    check("and carries the failing check's own line, so the next move needs no second read",
          "guard refuses nothing" in reason, reason[:400])
    check("the head line stays inside the dispatcher's 200-character cap, so what survives the "
          "cut is the list of what failed",
          len(reason.splitlines()[0]) <= 200, len(reason.splitlines()[0]))
    check("a block sets no systemMessage, so the human is not told the same thing twice",
          "systemMessage" not in doc, doc)
    check("the gate itself exits 0; it reports through JSON, never through its exit code",
          run.returncode == 0, (run.returncode, run.stderr))


def check_a_working_hook_passes() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py", "guard.py"]},
                    {"guard.py": A_HOOK, "test_guard.py": PASSING_SUITE})
    run, doc = fire(hooks, hooks / "guard.py")
    check("editing a hook whose suite passes: silent, so a clean tree goes green on day one",
          run.stdout == b"", (run.stdout, run.stderr))


def check_a_hook_with_no_suite() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py", "lonely.py"]}, {"lonely.py": A_HOOK})
    run, doc = fire(hooks, hooks / "lonely.py")
    check("a rostered hook with no test_*.py: blocked, because nothing can show it still works",
          doc.get("decision") == "block" and "lonely.py" in reason_of(doc), doc)
    check("and the block names the file the author has to write",
          "test_lonely.py" in reason_of(doc), reason_of(doc)[:300])


def check_an_unrostered_hook() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py"]},
                    {"stray.py": A_HOOK, "test_stray.py": PASSING_SUITE})
    run, doc = fire(hooks, hooks / "stray.py")
    check("a new hook file no roster names: blocked by the tree check dispatch.py's own suite "
          "owns, not by a second copy of it here",
          doc.get("decision") == "block" and "stray.py" in reason_of(doc), doc)


def check_a_roster_that_names_a_missing_file() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py", "vanished.py"]})
    run, doc = fire(hooks, hooks / "roster.json")
    check("a roster entry naming a file that is not there: blocked",
          doc.get("decision") == "block" and "vanished.py" in reason_of(doc), doc)

    hooks = fixture({"PostToolUse": ["hook-gate.py"]})
    (hooks / "roster.json").write_text("{not json")
    run, doc = fire(hooks, hooks / "roster.json")
    check("a roster that does not parse: blocked, and the reason says so",
          doc.get("decision") == "block" and "does not parse" in reason_of(doc), doc)

    hooks = fixture({"PostToolUse": ["hook-gate.py"]})
    (hooks / "roster.json").write_text(json.dumps({"PostToolUse": "hook-gate.py"}))
    run, doc = fire(hooks, hooks / "roster.json")
    check("a roster whose event holds a bare string rather than a list: blocked, since the "
          "dispatcher would run the letters of it",
          doc.get("decision") == "block" and "roster-shape" in reason_of(doc), doc)


def check_a_removed_roster_entry() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py", "guard.py"], "Stop": ["stopper.py"]},
                    {"guard.py": A_HOOK, "test_guard.py": PASSING_SUITE,
                     "stopper.py": A_HOOK, "test_stopper.py": PASSING_SUITE})
    repo = hooks.parent.parent
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "roster")
    (hooks / "roster.json").write_text(json.dumps(
        {"PostToolUse": ["hook-gate.py", "guard.py"], "Stop": []}))
    run, doc = fire(hooks, hooks / "roster.json")
    check("a hook dropped from the roster it was committed in: blocked, naming the hook and the "
          "event it no longer runs on",
          doc.get("decision") == "block" and "stopper.py" in reason_of(doc)
          and "Stop" in reason_of(doc), doc)

    (hooks / "roster.json").write_text(json.dumps(
        {"PostToolUse": ["hook-gate.py", "guard.py"], "Stop": ["stopper.py"],
         "SessionEnd": ["guard.py"]}))
    run, doc = fire(hooks, hooks / "roster.json")
    check("adding an entry is not a removal, so growing the roster is silent",
          run.stdout == b"", run.stdout)


def check_settings_that_disarm() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py"], "Stop": ["stopper.py"]},
                    {"stopper.py": A_HOOK, "test_stopper.py": PASSING_SUITE})
    settings_path = hooks.parent / "settings.json"
    both = {"hooks": {event: [{"hooks": [{"type": "command",
                                          "command": f"python3 {hooks / 'dispatch.py'} {event}"}]}]
                      for event in ("PostToolUse", "Stop")}}
    settings_path.write_text(json.dumps(both))
    run, doc = fire(hooks, settings_path)
    check("settings that register every event the roster uses: silent",
          run.stdout == b"", run.stdout)

    only_post = {"hooks": {"PostToolUse": both["hooks"]["PostToolUse"]}}
    settings_path.write_text(json.dumps(only_post))
    run, doc = fire(hooks, settings_path)
    check("an event deleted from settings while the roster still rosters hooks on it: blocked, "
          "naming the hooks that stopped firing",
          doc.get("decision") == "block" and "stopper.py" in reason_of(doc), doc)

    missing = {"hooks": {"PostToolUse": [{"hooks": [
        {"type": "command", "command": f"python3 {hooks / 'gone.py'} PostToolUse"}]}]}}
    settings_path.write_text(json.dumps(missing))
    run, doc = fire(hooks, settings_path)
    check("a registration whose script is not a file: blocked, because that slot runs nothing",
          doc.get("decision") == "block" and "gone.py" in reason_of(doc), doc)

    settings_path.write_text("{oops")
    run, doc = fire(hooks, settings_path)
    check("settings that do not parse: blocked", doc.get("decision") == "block", doc)


def check_the_roster_is_judged_against_live_settings() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py"], "Stop": ["stopper.py"]},
                    {"stopper.py": A_HOOK, "test_stopper.py": PASSING_SUITE})
    (hooks.parent / "settings.json").write_text(json.dumps({"hooks": {"PostToolUse": [
        {"hooks": [{"type": "command",
                    "command": f"python3 {hooks / 'dispatch.py'} PostToolUse"}]}]}}))
    run, doc = fire(hooks, hooks / "roster.json")
    check("a roster event no settings file registers: blocked, so a hook cannot be rostered onto "
          "an event nothing fires",
          doc.get("decision") == "block" and "Stop" in reason_of(doc), doc)


CONFORMANCE_PASSES = "#!/usr/bin/env python3\nprint('7 scenarios, 0 findings')\n"
CONFORMANCE_FAILS = ("#!/usr/bin/env python3\n"
                     "import sys\n"
                     "print('deny-survives-sibling-crash: harness would proceed, expected deny')\n"
                     "sys.exit(1)\n")


def check_the_dispatcher_faces_the_conformance_suite() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py"]}, carry=LEAN + ("dispatch.py",))
    checker = hooks.parent.parent / "dispatchcheck.py"

    checker.write_text(CONFORMANCE_FAILS)
    run, doc = fire(hooks, hooks / "dispatch.py",
                    env_extra={"CLAUDE_HOOK_GATE_DISPATCHCHECK": str(checker)})
    reason = reason_of(doc)
    check("editing the dispatcher puts it in front of Hookkit's conformance suite, and a scenario "
          "it now fails blocks the edit",
          doc.get("decision") == "block" and "dispatchcheck.py" in reason, doc)
    check("and the block carries the scenario's own line, not just an exit code",
          "deny-survives-sibling-crash" in reason, reason[:300])

    checker.write_text(CONFORMANCE_PASSES)
    run, doc = fire(hooks, hooks / "dispatch.py",
                    env_extra={"CLAUDE_HOOK_GATE_DISPATCHCHECK": str(checker)})
    check("a dispatcher that still conforms: silent", run.stdout == b"", run.stdout)

    run, doc = fire(hooks, hooks / "dispatch.py",
                    env_extra={"CLAUDE_HOOK_GATE_DISPATCHCHECK": str(checker) + ".absent"})
    check("a machine without Hookkit on it: silent, since the suite is Hookkit's asset and the "
          "gate's own checks stand without it",
          run.stdout == b"", run.stdout)


SQUAD = ["alpha-guard", "bravo-guard", "charlie-guard", "delta-guard", "echo-guard",
         "foxtrot-guard", "golf-guard", "hotel-guard", "india-guard", "juliet-guard"]


def check_a_shared_module_runs_every_suite() -> None:
    files = {}
    for name in SQUAD:
        files[f"{name}.py"] = A_HOOK
        files[f"test_{name.replace('-', '_')}.py"] = FAILING_SUITE
    hooks = fixture({"PostToolUse": ["hook-gate.py", *(f"{n}.py" for n in SQUAD)]}, files,
                    carry=LEAN)
    run, doc = fire(hooks, hooks / "_hook.py")
    reason = reason_of(doc)
    missed = [n for n in SQUAD if f"test_{n.replace('-', '_')}.py" not in reason]
    check("editing _hook.py runs every suite in the directory, because a shared module's edit "
          "reaches every hook that imports it",
          doc.get("decision") == "block" and not missed, missed)
    check("ten failing suites still leave a head line inside the dispatcher's 200-character cap, "
          "so the cut never eats the first name",
          len(reason.splitlines()[0]) <= 200, len(reason.splitlines()[0]))
    check("and the names that do not fit the head are still in the body the spill log keeps",
          len(reason) > 200, len(reason))


def check_the_budget_is_reported_not_swallowed() -> None:
    hooks = fixture({"PostToolUse": ["hook-gate.py", "slow.py"]},
                    {"slow.py": A_HOOK, "test_slow.py": HANGING_SUITE})
    run, doc = fire(hooks, hooks / "slow.py",
                    env_extra={"CLAUDE_HOOK_GATE_SUITE_TIMEOUT": "2", "CLAUDE_HOOK_GATE_BUDGET": "4"})
    check("a suite that hangs: blocked, naming it, rather than the gate going quiet when its "
          "budget runs out",
          doc.get("decision") == "block" and "test_slow.py" in reason_of(doc), doc)


ALL = [check_out_of_scope_is_silent, check_a_broken_hook_is_named, check_a_working_hook_passes,
       check_a_hook_with_no_suite, check_an_unrostered_hook,
       check_a_roster_that_names_a_missing_file, check_a_removed_roster_entry,
       check_settings_that_disarm, check_the_roster_is_judged_against_live_settings,
       check_the_dispatcher_faces_the_conformance_suite, check_a_shared_module_runs_every_suite,
       check_the_budget_is_reported_not_swallowed]


def main() -> None:
    wanted = set(sys.argv[1:])
    for fn in ALL:
        if not wanted or fn.__name__ in wanted:
            fn()
    finish("All hook-gate checks passed.")


if __name__ == "__main__":
    main()
