#!/usr/bin/env python3
import fnmatch
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import _hook

SUITE_TIMEOUT_SECONDS = int(os.environ.get("CLAUDE_HOOK_GATE_SUITE_TIMEOUT") or 120)
TOTAL_BUDGET_SECONDS = int(os.environ.get("CLAUDE_HOOK_GATE_BUDGET") or 240)
MAX_WORKERS = 4
SHARED_MODULES = {"_hook.py", "_harness.py"}
SETTINGS_GLOB = "settings*.json"
ROSTER_NAME = "roster.json"
DISPATCHER_NAME = "dispatch.py"
TREE_SUITE = "test_dispatch.py"
TREE_CHECK = "check_roster_matches_tree"
HOME_SETTINGS = Path.home() / ".claude" / "settings.json"
CONFORMANCE = Path(os.environ.get("CLAUDE_HOOK_GATE_DISPATCHCHECK")
                   or (Path.home() / "Claude Projects" / "Hookkit" / "dispatchcheck.py"))
REENTRY_MARKER = "CLAUDE_HOOK_GATE_RUNNING"
GIT_TIMEOUT_SECONDS = 10
SCRIPT_TOKEN = re.compile(r"[^\s\"';|&]+\.(?:py|sh|mjs|js)")
FAIL_LINE = re.compile(r"^\s*(?:\[FAIL\]|- )")
DETAIL_LINES = 6
DETAIL_CHARS = 700
HEAD_CHARS = 200


def hooks_dir_of(path: Path) -> Path | None:
    parent = path.parent
    if parent.name == "hooks" and parent.parent.name == ".claude":
        return parent
    return None


def is_settings(path: Path) -> bool:
    return fnmatch.fnmatch(path.name, SETTINGS_GLOB) and path.parent.name == ".claude"


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def registered_commands(settings: dict):
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict):
                continue
            for entry in group.get("hooks") or []:
                if isinstance(entry, dict) and isinstance(entry.get("command"), str):
                    yield event, entry["command"]


def script_paths(command: str) -> list[tuple[str, Path | None]]:
    found = []
    for token in SCRIPT_TOKEN.findall(command):
        expanded = os.path.expanduser(os.path.expandvars(token))
        found.append((token, Path(expanded) if expanded.startswith("/") else None))
    return found


def dispatchers(settings: dict) -> dict[Path, set[str]]:
    found: dict[Path, set[str]] = {}
    for event, command in registered_commands(settings):
        for _, resolved in script_paths(command):
            if resolved is not None and resolved.name == DISPATCHER_NAME and resolved.is_file():
                found.setdefault(resolved.resolve(), set()).add(event)
    return found


def git_value(repo: Path, args: list[str]) -> str:
    try:
        run = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                             timeout=GIT_TIMEOUT_SECONDS)
    except (OSError, subprocess.SubprocessError):
        return ""
    return run.stdout.strip() if run.returncode == 0 else ""


def same_repo(one: Path, other: Path) -> bool:
    tops = [git_value(p, ["rev-parse", "--show-toplevel"]) for p in (one, other)]
    if all(tops) and tops[0] == tops[1]:
        return True
    origins = [git_value(p, ["remote", "get-url", "origin"]) for p in (one, other)]
    return all(origins) and origins[0] == origins[1]


def event_coverage(roster: dict, settings: dict, where: str) -> list[tuple[str, str]]:
    registered = settings.get("hooks") if isinstance(settings.get("hooks"), dict) else {}
    found = []
    for event, names in roster.items():
        if isinstance(names, list) and names and event not in registered:
            found.append(("unregistered-event",
                          f"{', '.join(names)} are rostered on {event}, which {where} does not "
                          f"register, so nothing fires them"))
    return found


def governing_settings(hooks_dir: Path) -> list[tuple[Path, dict]]:
    found = []
    for candidate in (HOME_SETTINGS, hooks_dir.parent / "settings.json",
                      hooks_dir.parent / "settings.local.json"):
        settings = load_json(candidate)
        if not isinstance(settings, dict):
            continue
        for dispatcher in dispatchers(settings):
            if dispatcher.parent == hooks_dir or same_repo(dispatcher.parent, hooks_dir):
                found.append((candidate, settings))
                break
    return found


def pairs_of(roster: dict) -> set[tuple[str, str]]:
    return {(event, name) for event, names in roster.items()
            if isinstance(names, list) for name in names if isinstance(name, str)}


def previous_roster(path: Path) -> dict | None:
    top = git_value(path.parent, ["rev-parse", "--show-toplevel"])
    if not top:
        return None
    try:
        relative = path.resolve().relative_to(Path(top).resolve())
    except ValueError:
        return None
    try:
        run = subprocess.run(["git", "-C", top, "show", f"HEAD:{relative}"],
                             capture_output=True, text=True, timeout=GIT_TIMEOUT_SECONDS)
    except (OSError, subprocess.SubprocessError):
        return None
    if run.returncode != 0:
        return None
    try:
        doc = json.loads(run.stdout)
    except ValueError:
        return None
    return doc if isinstance(doc, dict) else None


def check_roster(path: Path) -> list[tuple[str, str]]:
    roster = load_json(path)
    if roster is None:
        return [("unparseable", f"{path.name} does not parse, so the dispatcher can read no roster "
                                f"from it")]
    if not isinstance(roster, dict) or not all(isinstance(v, list) for v in roster.values()):
        return [("roster-shape", f"{path.name} is not {{event: [hook filenames]}}")]
    found = []
    before = previous_roster(path)
    if before is not None:
        for event, name in sorted(pairs_of(before) - pairs_of(roster)):
            found.append(("roster-removal",
                          f"{name} no longer runs on {event}; it is committed as rostered there and "
                          f"nothing else fires it"))
    for settings_path, settings in governing_settings(path.parent):
        found += event_coverage(roster, settings, settings_path.name)
    return found


def check_settings(path: Path) -> list[tuple[str, str]]:
    settings = load_json(path)
    if settings is None:
        return [("unparseable", f"{path} does not parse")]
    if not isinstance(settings, dict):
        return [("settings-shape", f"{path} is not an object")]
    found = []
    for event, command in registered_commands(settings):
        for token, resolved in script_paths(command):
            if resolved is not None and not resolved.exists():
                found.append(("missing-script",
                              f"{event} registers {token}, which is not a file, so that slot runs "
                              f"nothing"))
    for dispatcher in dispatchers(settings):
        roster = load_json(dispatcher.parent / ROSTER_NAME)
        if isinstance(roster, dict):
            found += event_coverage(roster, settings, path.name)
    return found


def suites_for(path: Path, hooks_dir: Path) -> list[list[str]]:
    if path.name in SHARED_MODULES:
        return [[str(p)] for p in sorted(hooks_dir.glob("test_*.py"))]
    if path.name.startswith("test_") and path.suffix == ".py":
        return [[str(path)]]
    own = hooks_dir / f"test_{path.stem.replace('-', '_')}.py"
    return [[str(own)]] if own.is_file() else []


def rostered(name: str, hooks_dir: Path) -> bool:
    roster = load_json(hooks_dir / ROSTER_NAME)
    if not isinstance(roster, dict):
        return False
    return any(name in names for names in roster.values() if isinstance(names, list))


def named_by_a_typescript_suite(path: Path, hooks_dir: Path) -> bool:
    return any(hooks_dir.glob(f"{path.stem}*.test.ts"))


def detail_of(run: subprocess.CompletedProcess) -> str:
    lines = [line.strip() for line in (run.stdout or "").splitlines() if FAIL_LINE.match(line)]
    if not lines:
        lines = [line.strip() for line in (run.stderr or "").splitlines() if line.strip()]
        lines = lines[-DETAIL_LINES:]
    if not lines:
        lines = [line.strip() for line in (run.stdout or "").splitlines() if line.strip()]
        lines = lines[-DETAIL_LINES:]
    return " | ".join(lines[:DETAIL_LINES])[:DETAIL_CHARS]


def run_suite(argv: list[str], hooks_dir: Path, deadline: float) -> tuple[str, str] | None:
    label = " ".join(Path(part).name if "/" in part else part for part in argv)
    left = deadline - time.monotonic()
    if left <= 1:
        return ("budget", f"{label} did not run: the gate's {TOTAL_BUDGET_SECONDS}s budget was "
                          f"spent, so it is unverified")
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", REENTRY_MARKER: "1"}
    try:
        run = subprocess.run([sys.executable, *argv], cwd=str(hooks_dir), env=env,
                             capture_output=True, text=True,
                             timeout=min(SUITE_TIMEOUT_SECONDS, left))
    except subprocess.TimeoutExpired:
        return (label, f"{label} outlived {SUITE_TIMEOUT_SECONDS}s")
    except OSError as exc:
        return (label, f"{label} could not run ({exc})")
    if run.returncode == 0:
        return None
    return (label, f"{label} exits {run.returncode}: {detail_of(run)}")


def run_suites(jobs: list[list[str]], hooks_dir: Path, deadline: float) -> list[tuple[str, str]]:
    if not jobs:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(jobs))) as pool:
        results = list(pool.map(lambda argv: run_suite(argv, hooks_dir, deadline), jobs))
    return [r for r in results if r]


def examine(path: Path, deadline: float) -> tuple[list[tuple[str, str]], int]:
    hooks_dir = hooks_dir_of(path)
    if hooks_dir is None:
        return check_settings(path), 0
    found = []
    jobs = []
    if path.name == ROSTER_NAME:
        found += check_roster(path)
    elif path.suffix in (".py", ".sh", ".mjs"):
        jobs = suites_for(path, hooks_dir)
        if not jobs and rostered(path.name, hooks_dir) and not named_by_a_typescript_suite(path, hooks_dir):
            found.append(("missing-suite",
                          f"{path.name} is rostered and has no test_{path.stem.replace('-', '_')}.py, "
                          f"so nothing can show it still works"))
    dispatcher = hooks_dir / DISPATCHER_NAME
    if path.name in SHARED_MODULES | {DISPATCHER_NAME} and dispatcher.is_file() and CONFORMANCE.is_file():
        jobs = jobs + [[str(CONFORMANCE), str(dispatcher)]]
    tree = hooks_dir / TREE_SUITE
    if tree.is_file():
        jobs = jobs + [[str(tree), TREE_CHECK]]
    found += run_suites(jobs, hooks_dir, deadline)
    return found, len(jobs)


def report(path: Path, found: list[tuple[str, str]]) -> str:
    labels = []
    for label, _ in found:
        if label not in labels:
            labels.append(label)
    head = f"[hook-gate] {path.name}: {', '.join(labels)}"[:HEAD_CHARS]
    return "\n".join([head, *(detail for _, detail in found)])


def main() -> None:
    if os.environ.get(REENTRY_MARKER):
        return
    payload, ok = _hook.read_payload()
    if not ok or payload.get("tool_name") not in _hook.EDIT_TOOLS:
        return
    edited = _hook.edited_path(payload["tool_input"])
    if not edited:
        return
    path = Path(edited).resolve()
    if hooks_dir_of(path) is None and not is_settings(path):
        return

    started = time.monotonic()
    found, ran = examine(path, started + TOTAL_BUDGET_SECONDS)
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(
        payload, "blocked" if found else "clean", target=path.name, suites=ran,
        findings=[label for label, _ in found]))
    if not found:
        return
    print(json.dumps(_hook.block_envelope(report(path, found))))


if __name__ == "__main__":
    main()
