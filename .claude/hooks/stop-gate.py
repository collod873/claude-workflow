#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import _hook

SLOT = "stop"
MAX_BLOCKS = 1
COUNTER_DIR = Path("/tmp")
CHECK_TIMEOUT = int(os.environ.get("STOP_GATE_TIMEOUT", "240"))
GIT_TIMEOUT = 10
TAIL_CHARS = 1500


def _project_dir(payload: dict) -> Path:
    override = os.environ.get("CLAUDE_PROJECT_DIR")
    if override:
        return Path(override)
    cwd = payload.get("cwd")
    if cwd:
        return Path(cwd)
    return Path.cwd()


def _counter_path(session_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in session_id)
    return COUNTER_DIR / f"claude-stopgate-{safe}.count"


def _read_count(path: Path) -> int:
    try:
        return int(path.read_text().strip())
    except Exception:
        return 0


def _write_count(path: Path, n: int) -> None:
    try:
        path.write_text(str(n))
    except Exception:
        pass


def _clear_count(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        pass


def _load_contract(project_dir: Path) -> tuple[dict | None, str | None]:
    contract_path = project_dir / ".claude" / "contract.json"
    if not contract_path.exists():
        return None, None
    try:
        data = json.loads(contract_path.read_text())
    except Exception as exc:
        return None, f".claude/contract.json is not valid JSON ({exc})"
    if not isinstance(data, dict):
        return None, ".claude/contract.json must be a JSON object"
    return data, None


def _check_command(contract: dict) -> tuple[str | None, str | None, str]:
    slot = contract.get(SLOT)
    if not isinstance(slot, dict):
        return None, (
            f"contract has no '{SLOT}' slot shaped as {{\"cmd\": ..., \"why\": ...}}. "
            f"the turn-end gate reads '{SLOT}' only (ADR-0022); declare a fast check or "
            f"{{\"cmd\": null, \"why\": \"...\"}}"
        ), "bad-cmd"
    if "cmd" not in slot:
        return None, (
            f"contract's '{SLOT}' slot has no 'cmd' key (found: "
            f"{', '.join(sorted(map(str, slot))) or 'nothing'}). Declare a fast check as "
            f'{{"cmd": "...", "why": "..."}}, or opt out explicitly with '
            f'{{"cmd": null, "why": "..."}}'
        ), "no-cmd-key"
    cmd = slot["cmd"]
    if cmd is None:
        return None, None, "null-cmd"
    if not isinstance(cmd, str) or not cmd.strip():
        return None, f"contract's '{SLOT}.cmd' must be a non-empty string, or null", "bad-cmd"
    return cmd, None, ""


def _git_dirty(project_dir: Path) -> tuple[bool | None, str | None]:
    git = shutil.which("git")
    if git is None:
        return None, "git not found on PATH"
    try:
        result = subprocess.run(
            [git, "-C", str(project_dir), "status", "--porcelain", "--untracked-files=all"],
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return None, "git status timed out"
    except OSError as exc:
        return None, f"git invocation failed ({exc})"
    if result.returncode != 0:
        detail = (result.stderr or "").strip().splitlines()
        return None, "git status failed" + (f" ({detail[0]})" if detail else "")
    return bool(result.stdout.strip()), None


_EXPOSURE: tuple[bool | None, int] | None = None


def _exposure(payload: dict) -> tuple[bool | None, int]:
    global _EXPOSURE
    if _EXPOSURE is None:
        _EXPOSURE = _hook.exposure(payload)
    return _EXPOSURE


def _row(payload: dict, verdict: str, **extra) -> None:
    exposed, edits = _exposure(payload)
    _hook.append_log(_hook.HOOK_NAME, _hook.run_row(
        payload, verdict, exposed=exposed, edited_files=edits, **extra))


def _release(counter_path: Path | None, stop_hook_active: bool) -> tuple[str, int]:
    count = (_read_count(counter_path) if counter_path is not None else 0) + 1
    if stop_hook_active or count > MAX_BLOCKS:
        return "handback", count
    return "block", count


def _block(headline: str, detail: str = "") -> dict:
    text = f"[{_hook.HOOK_NAME}] BLOCKED: {headline}"
    return {
        "decision": "block",
        "reason": text + (f"\n{detail}" if detail else ""),
        "systemMessage": text,
    }


def _handback(headline: str) -> dict:
    return {"systemMessage": f"[{_hook.HOOK_NAME}] UNRESOLVED: {headline}"}


def _not_mine(headline: str) -> dict:
    return {"systemMessage": f"[{_hook.HOOK_NAME}] NOT YOURS: {headline}"}


def _deferred(headline: str) -> dict:
    return {"systemMessage": f"[{_hook.HOOK_NAME}] DEFERRED: {headline}"}


def _chars(doc: dict) -> int:
    return sum(len(doc.get(k) or "") for k in ("reason", "systemMessage"))


def _say(doc: dict) -> None:
    print(json.dumps(doc))
    sys.exit(0)


def _background_tasks(payload: dict) -> int:
    tasks = payload.get("background_tasks")
    return len(tasks) if isinstance(tasks, list) else 0


def _fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8", "replace")).hexdigest()[:16]


def _told_path(counter_path: Path) -> Path:
    return counter_path.with_suffix(".notmine")


def _deferred_path(counter_path: Path) -> Path:
    return counter_path.with_suffix(".deferred")


def _clear_stamps(counter_path: Path) -> None:
    _clear_count(counter_path)
    _clear_count(_told_path(counter_path))
    _clear_count(_deferred_path(counter_path))


def _already_told(told_path: Path, fingerprint: str) -> bool:
    try:
        if told_path.read_text().strip() == fingerprint:
            return True
    except Exception:
        pass
    try:
        told_path.write_text(fingerprint)
    except Exception:
        pass
    return False


def _others_clause(others: dict[str, str]) -> str:
    if not others:
        return ""
    sid, ts = next(iter(others.items()))
    more = f" (+{len(others) - 1} more)" if len(others) > 1 else ""
    return f"session {sid[:8]}… was active here at {ts[11:19]}{more}"


_OTHERS: dict[str, str] | None = None


def _live_siblings(project: str, session_id: str) -> dict[str, str]:
    global _OTHERS
    if _OTHERS is None:
        _OTHERS = _hook.active_sessions(project, session_id)
    return _OTHERS


def _fenced(cmd: str, tail: str, truncated: bool) -> str:
    if not tail.strip():
        return f"--- {cmd!r} printed nothing ---"
    label = f"last {TAIL_CHARS} chars, truncated" if truncated else "output"
    return f"--- {cmd!r} {label} ---\n{tail}\n--- end ---"


def _verdict_line(cmd: str, raw: str) -> str:
    lines = [ln.rstrip() for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return ""
    runner = Path(cmd.split()[0]).name if cmd.split() else ""
    for line in reversed(lines):
        if runner and line.lstrip().lower().startswith(f"{runner.lower()}:"):
            return line.strip()
    return lines[-1].strip()


def main() -> None:
    payload, ok = _hook.read_payload()
    project_dir = _project_dir(payload)
    if not ok:
        _row(payload, "fail-open", project=project_dir.name)
        return

    if not _hook.enrolled(project_dir):
        return

    stop_hook_active = bool(payload.get("stop_hook_active", False))

    session_id = payload.get("session_id") or ""
    counter_path = _counter_path(session_id) if session_id else None

    def refuse(verdict: str, message: str, *, broken: str = "", **extra) -> None:
        exposed, _edits = _exposure(payload)
        background = _background_tasks(payload) if broken and counter_path else 0
        if background:
            told = not _already_told(_deferred_path(counter_path), _fingerprint(verdict))
            doc = _deferred(
                f"{broken} is broken in {project_dir.name}; {background} background task(s) "
                f"still running, so this Stop is a pause. Refused once they finish.")
            _row(payload, verdict, project=project_dir.name, released="deferred",
                 told=told, background_tasks=background,
                 **({"chars": _chars(doc)} if told else {}), **extra)
            if not told:
                return
            _say(doc)
        others = _live_siblings(project_dir.name, session_id) if broken and counter_path else {}
        if others and exposed is False:
            told = not _already_told(_told_path(counter_path), _fingerprint(verdict))
            doc = _not_mine(
                f"{broken} is broken in {project_dir.name}, but this session edited nothing "
                f"and {_others_clause(others)}. Another session's work in progress.")
            _row(payload, verdict, project=project_dir.name, released="not-mine",
                 told=told, other_sessions=list(others),
                 **({"chars": _chars(doc)} if told else {}), **extra)
            if not told:
                return
            _say(doc)
        released, count = _release(counter_path, stop_hook_active)
        doc = _handback(message) if released == "handback" else _block(message)
        _row(payload, verdict, project=project_dir.name, released=released,
             chars=_chars(doc), **extra)
        if released == "handback":
            if counter_path is not None:
                _clear_count(counter_path)
        elif counter_path is not None:
            _write_count(counter_path, count)
        _say(doc)

    contract, contract_err = _load_contract(project_dir)
    if contract_err:
        refuse("bad-contract", f"{contract_err}; fix .claude/contract.json",
               broken="the contract", why=contract_err)
        return
    if contract is None:
        _row(payload, "no-contract", project=project_dir.name)
        return

    cmd, cmd_err, cmd_verdict = _check_command(contract)
    if cmd_err:
        refuse(cmd_verdict, f"{cmd_err}; fix .claude/contract.json",
               broken="the contract", why=cmd_err)
        return
    if cmd is None:
        _row(payload, "null-cmd", project=project_dir.name)
        return

    dirty, git_err = _git_dirty(project_dir)
    if git_err:
        refuse("git-error",
               f"{git_err}; cannot tell a clean tree from an unknowable one. "
               "refusing to guess",
               broken="git in this checkout", cmd=cmd, why=git_err)
        return
    tree = "uncommitted changes present" if dirty else "working tree clean"

    if counter_path is None:
        refuse("no-session",
               "session identity unresolved on stdin; refusing to share a global counter",
               cmd=cmd)
        return

    started = time.monotonic()
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            timeout=CHECK_TIMEOUT,
        )
        failed = result.returncode != 0
        raw = (result.stdout or "") + (result.stderr or "")
        tail, truncated = raw[-TAIL_CHARS:], len(raw) > TAIL_CHARS
    except subprocess.TimeoutExpired:
        failed = True
        raw = ""
        tail, truncated = f"exceeded its {CHECK_TIMEOUT}s timeout", False
    seconds = round(time.monotonic() - started, 2)

    others = _live_siblings(project_dir.name, session_id)
    exposed, _edits = _exposure(payload)
    mine = exposed is not False
    background = _background_tasks(payload)

    told = None
    doc: dict | None = None
    beside = f"; {_others_clause(others)}" if others else ""
    if not failed:
        verdict = "clean"
    elif background:
        verdict = "deferred"
        told = not _already_told(_deferred_path(counter_path), _fingerprint(cmd))
        doc = _deferred(
            f"{cmd!r} is red in {project_dir.name} ({tree}); {background} background "
            f"task(s) still running, so this Stop is a pause. Refused once they finish.")
    elif not mine and others:
        verdict = "not-mine"
        told = not _already_told(_told_path(counter_path), _fingerprint(cmd))
        doc = _not_mine(
            f"{cmd!r} is red in {project_dir.name}, but this session edited nothing and "
            f"{_others_clause(others)}. Another session's work in progress.")
    else:
        verdict, count = _release(counter_path, stop_hook_active)
        if verdict == "handback":
            doc = _handback(
                f"checks still failing after one retry ({cmd!r}, {tree}); stopping for "
                f"human review.")
        else:
            summary = _verdict_line(cmd, raw)
            doc = _block(
                f"{cmd!r} failed ({tree}){beside}; fix the violation it names; the check "
                f"and the gate stay as they are.",
                (f"verdict: {summary}\n" if summary else "") + _fenced(cmd, tail, truncated),
            )

    extra: dict = {"told": told} if told is not None else {}
    if verdict == "deferred":
        extra["background_tasks"] = background
    if doc is not None and told is not False:
        extra["chars"] = _chars(doc)
    _row(payload, verdict, project=project_dir.name, cmd=cmd, seconds=seconds,
         other_sessions=list(others), **extra)

    if verdict == "clean":
        _clear_stamps(counter_path)
        return
    if verdict in ("deferred", "not-mine"):
        if not told:
            return
        _say(doc)
    if verdict == "handback":
        _clear_count(counter_path)
    else:
        _write_count(counter_path, count)
    _say(doc)


if __name__ == "__main__":
    main()
