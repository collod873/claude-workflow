#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import _harness
import _hook
from _harness import check, finish

HOOK = Path(__file__).resolve().parent / "stop-gate.py"

PASS_CMD = "true"
FAIL_CMD = "false"
FAIL_CMD_NOISY = "date +%s%N; false"


LOG_DIR = Path(tempfile.mkdtemp(prefix="stopgate-log-"))


def _env(path_dirs: list[str] | None = None, check_deadline: int | None = None) -> dict:
    env = {"HOME": tempfile.gettempdir(), "STOP_GATE_LOG_DIR": str(LOG_DIR)}
    if path_dirs is not None:
        env["PATH"] = os.pathsep.join(path_dirs)
    else:
        env["PATH"] = os.environ.get("PATH", "/usr/bin:/bin")
    if check_deadline is not None:
        env["STOP_GATE_TIMEOUT"] = str(check_deadline)
    return env


def _run(payload: dict, env: dict) -> subprocess.CompletedProcess:
    stdin_bytes = json.dumps(payload).encode()
    return _harness.run_hook(HOOK, stdin_bytes, env=env).proc


def _out(r: subprocess.CompletedProcess) -> dict:
    try:
        doc = json.loads(r.stdout)
    except (json.JSONDecodeError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def _blocked(r: subprocess.CompletedProcess) -> bool:
    doc = _out(r)
    return (r.returncode == 0 and doc.get("decision") == "block"
            and isinstance(doc.get("reason"), str)
            and str(doc.get("systemMessage", "")).startswith("[stop-gate] BLOCKED"))


def _reason(r: subprocess.CompletedProcess) -> str:
    doc = _out(r)
    return str(doc.get("reason") or doc.get("systemMessage") or "")


def _ends_turn(r: subprocess.CompletedProcess, prefix: str) -> bool:
    doc = _out(r)
    system = doc.get("systemMessage", "")
    return (r.returncode == 0 and set(doc) == {"systemMessage"}
            and isinstance(system, str) and "\n" not in system
            and system.startswith(f"[stop-gate] {prefix}"))


def _other_session_row(root: Path, session_id: str, seconds_ago: int = 0) -> None:
    ts = (datetime.now() - timedelta(seconds=seconds_ago)).isoformat(timespec="seconds")
    _hook.append_log("validate-bash", {
        "hook": "validate-bash", "event": "PreToolUse", "session_id": session_id,
        "project": root.name, "verdict": "allow", "ts": ts,
    }, path=LOG_DIR / f"validate-bash-{datetime.now():%Y-%m-%d}.jsonl")


def _transcript(root: Path, tools: tuple[str, ...]) -> Path:
    path = root / "transcript.jsonl"
    path.write_text("".join(
        json.dumps({"message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": tool, "input": {"file_path": "a.txt"}}]}}) + "\n"
        for tool in tools
    ))
    return path


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    (root / "committed.txt").write_text("v1\n")
    _harness.enroll(root)
    subprocess.run(["git", "add", "."], cwd=root, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=root, check=True)


def _dirty(root: Path) -> None:
    (root / "committed.txt").write_text("v2\n")


def _commit_all(root: Path, message: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-q", "-m", message], cwd=root, check=True)


def _porcelain(root: Path) -> str:
    return subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout


def _write_contract(root: Path, contract: dict | None) -> None:
    claude_dir = root / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)
    if contract is None:
        return
    (claude_dir / "contract.json").write_text(json.dumps(contract))


_OMIT = object()
SESSION_IDS_USED: list[str] = []


def _payload(root: Path, session_id=_OMIT, stop_hook_active: bool = False) -> dict:
    if session_id is _OMIT:
        session_id = "sess-" + uuid.uuid4().hex[:8]
    p = {"cwd": str(root), "stop_hook_active": stop_hook_active}
    if session_id is not None:
        p["session_id"] = session_id
        SESSION_IDS_USED.append(session_id)
    return p


def main() -> None:
    real_git = shutil.which("git")
    assert real_git, "git must be on PATH to run this harness"

    scratch_dirs: list[str] = []

    def counter_for(session_id: str) -> Path:
        return Path(f"/tmp/claude-stopgate-{session_id}.count")

    no_git_dir = tempfile.mkdtemp(prefix="stopgate-no-git-")
    scratch_dirs.append(no_git_dir)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        r = _run(_payload(root), _env())
        check("happy: clean repo -> exit 0", r.returncode == 0, f"rc={r.returncode} err={r.stderr!r}")
        check("happy: clean repo -> silent stdout", r.stdout == b"", repr(r.stdout))
        check("happy: clean repo -> silent stderr", r.stderr == b"", _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        r = _run(_payload(root), _env())
        check("dirty+pass -> exit 0 silent", r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
              f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        _commit_all(root, "add contract")
        check("clean-tree fixture is genuinely clean", _porcelain(root) == "", repr(_porcelain(root)))
        r = _run(_payload(root), _env())
        check("clean tree + failing check -> blocks", _blocked(r),
              f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")
        check("clean tree + failing check -> BLOCKED on stderr, hook named",
              "[stop-gate] BLOCKED" in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        _commit_all(root, "add contract")
        session = "sess-rearm-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        env = _env()

        r1 = _run(_payload(root, session_id=session), env)
        check("re-arm: 1st failure on a clean tree blocks", _blocked(r1), f"rc={r1.returncode}")

        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": PASS_CMD, "why": "x"}})
        )
        _commit_all(root, "check now passes")
        r2 = _run(_payload(root, session_id=session), env)
        check("re-arm: clean tree + passing check -> exit 0 silent",
              r2.returncode == 0 and r2.stdout == b"" and r2.stderr == b"",
              f"rc={r2.returncode} out={r2.stdout!r} err={r2.stderr!r}")

        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": FAIL_CMD, "why": "x"}})
        )
        _commit_all(root, "check red again")
        r3 = _run(_payload(root, session_id=session), env)
        check("re-arm: a green stop clears the count, so the next failure blocks fresh",
              _blocked(r3), f"rc={r3.returncode} out={r3.stdout!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        r = _run(_payload(root), _env())
        check("no contract -> exit 0 silent", r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
              f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": None, "why": "no test suite yet"}})
        r = _run(_payload(root), _env())
        check("declared null -> exit 0 silent", r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
              f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        (root / ".claude").mkdir()
        (root / ".claude" / "contract.json").write_text("{not json")
        r = _run(_payload(root), _env())
        check("malformed JSON contract -> blocks", _blocked(r), f"rc={r.returncode} err={r.stderr!r}")
        check("malformed JSON contract -> names hook", "[stop-gate]" in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": None})
        r = _run(_payload(root), _env())
        check("bare 'stop': null -> blocks (inexpressible)", _blocked(r), f"rc={r.returncode}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {})
        r = _run(_payload(root), _env())
        check("missing 'stop' key -> blocks", _blocked(r), f"rc={r.returncode}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        marker = root / "ran.marker"
        _write_contract(root, {"stop": {"cmd": f"touch {marker}", "why": "x"}})
        r = _run(_payload(root), _env())
        check("runs the exact contract cmd", marker.exists(), f"rc={r.returncode} err={r.stderr!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-breaker-" + uuid.uuid4().hex[:8]
        env = _env()

        r1 = _run(_payload(root, session_id=session), env)
        check("trigger: 1st failure -> exit 2", _blocked(r1), f"rc={r1.returncode}")
        check("trigger: 1st failure -> BLOCKED on stderr, hook named", "[stop-gate] BLOCKED" in _reason(r1),
              _reason(r1))

        _dirty(root)
        r2 = _run(_payload(root, session_id=session), env)
        check("trigger: 2nd consecutive failure -> exit 0 (hand-back)", r2.returncode == 0,
              f"rc={r2.returncode} err={r2.stderr!r}")
        try:
            out2 = json.loads(r2.stdout)
        except json.JSONDecodeError:
            out2 = {}
        check("trigger: hand-back systemMessage names hook",
              str(out2.get("systemMessage", "")).startswith("[stop-gate] UNRESOLVED"), out2)
        check("trigger: hand-back is systemMessage alone, so the turn ends (#204)",
              _ends_turn(r2, "UNRESOLVED"), out2)
        check("trigger: hand-back carries no tail",
              "--- end ---" not in r2.stdout.decode() and "printed nothing" not in r2.stdout.decode(),
              out2)

        _dirty(root)
        r3 = _run(_payload(root, session_id=session), env)
        check("breaker re-arms after hand-back -> exit 2 again", _blocked(r3),
              f"rc={r3.returncode}")


    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-active-" + uuid.uuid4().hex[:8]
        r = _run(_payload(root, session_id=session, stop_hook_active=True), _env())
        check("stop_hook_active=true -> hand-back even on 1st failure", r.returncode == 0,
              f"rc={r.returncode} err={r.stderr!r}")
        counter = Path(f"/tmp/claude-stopgate-{session}.count")
        check("stop_hook_active hand-back leaves no counter file", not counter.exists())

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-reset-" + uuid.uuid4().hex[:8]
        env = _env()
        r1 = _run(_payload(root, session_id=session), env)
        check("reset: 1st failure blocks", _blocked(r1))

        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": PASS_CMD, "why": "x"}})
        )
        _dirty(root)
        r2 = _run(_payload(root, session_id=session), env)
        check("reset: clean stop after a block -> silent", r2.returncode == 0 and r2.stdout == b"")

        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": FAIL_CMD, "why": "x"}})
        )
        _dirty(root)
        r3 = _run(_payload(root, session_id=session), env)
        check("reset: next failure blocks fresh (not a hand-back)", _blocked(r3))

    with tempfile.TemporaryDirectory() as no_contract_dir:
        for label, raw in _harness.MALFORMED_STDIN:
            r = _harness.run_hook(HOOK, raw, env=_env(), cwd=no_contract_dir).proc
            check(f"malformed stdin ({label}) -> silent exit 0",
                  r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
                  f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        r = _run(_payload(root), _env(path_dirs=[no_git_dir]))
        check("missing git -> blocks (not silent)", _blocked(r), f"rc={r.returncode} out={r.stdout!r}")
        check("missing git -> message names git and the hook",
              "git" in _reason(r) and "[stop-gate]" in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        r = _run(_payload(root, session_id=None), _env())
        check("missing session_id -> blocks", _blocked(r), f"rc={r.returncode}")
        check("missing session_id -> names the identity problem",
              "session identity" in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        p = _payload(root)
        p["session_id"] = ""
        r = _run(p, _env())
        check("empty session_id -> blocks", _blocked(r), f"rc={r.returncode}")

    no_jq_dir = tempfile.mkdtemp(prefix="stopgate-no-jq-")
    scratch_dirs.append(no_jq_dir)
    os.symlink(real_git, os.path.join(no_jq_dir, "git"))
    assert shutil.which("jq") is not None, "this machine should have jq on the default PATH"
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        session_a = "sess-a-" + uuid.uuid4().hex[:6]
        session_b = "sess-b-" + uuid.uuid4().hex[:6]
        env_no_jq = _env(path_dirs=[no_jq_dir])
        ra = _run(_payload(root, session_id=session_a), env_no_jq)
        rb = _run(_payload(root, session_id=session_b), env_no_jq)
        check("PATH without jq: session A still resolves and passes", ra.returncode == 0)
        check("PATH without jq: session B still resolves and passes", rb.returncode == 0)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": "sleep 30", "why": "x"}})
        session = "sess-timeout-" + uuid.uuid4().hex[:8]
        env = _env(check_deadline=1)
        r = _run(_payload(root, session_id=session), env)
        check("check command exceeding STOP_GATE_TIMEOUT -> treated as a failure (blocks)",
              _blocked(r), f"rc={r.returncode}")
        check("timeout message names the deadline", "timeout" in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {
            "test": {"cmd": FAIL_CMD, "why": "CI owns it"},
            "stop": {"cmd": None, "why": "no fast check"},
        })
        r = _run(_payload(root), _env())
        check("failing 'test' + null 'stop' -> silent (test slot is never read)",
              r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
              f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"test": {"cmd": PASS_CMD, "why": "x"}})
        r = _run(_payload(root), _env())
        check("'test'-only contract -> blocks, names the 'stop' slot",
              _blocked(r) and "'stop'" in _reason(r), f"rc={r.returncode} err={r.stderr!r}")

    def _rows() -> list[dict]:
        return _harness.rows(LOG_DIR, "stop-gate")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        transcript = root / "transcript.jsonl"
        transcript.write_text(
            json.dumps({"message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": "Read", "input": {}}]}}) + "\n"
        )
        session = "sess-log-" + uuid.uuid4().hex[:8]
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(transcript)
        r = _run(p, _env())
        rows = [x for x in _rows() if x.get("session_id") == session]
        check("log: a clean run appends exactly one row", r.returncode == 0 and len(rows) == 1,
              f"rows={rows}")
        row = rows[0] if rows else {}
        check("log: read-only transcript -> exposed=false, edited_files=0",
              row.get("exposed") is False and row.get("edited_files") == 0, row)
        check("log: row carries cmd, seconds, verdict=clean, project",
              row.get("cmd") == PASS_CMD and isinstance(row.get("seconds"), (int, float))
              and row.get("verdict") == "clean" and row.get("project") == root.name, row)

        transcript.write_text(transcript.read_text() + "".join(
            json.dumps({"message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": tool, "input": {"file_path": "a.txt"}}]}}) + "\n"
            for tool in ("Edit", "Write")
        ))
        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": FAIL_CMD, "why": "x"}})
        )
        r2 = _run(p, _env())
        rows = [x for x in _rows() if x.get("session_id") == session]
        check("log: failing run -> second row, verdict=block, exposed=true, edited_files=2",
              _blocked(r2) and len(rows) == 2 and rows[1].get("verdict") == "block"
              and rows[1].get("exposed") is True and rows[1].get("edited_files") == 2,
              f"rc={r2.returncode} rows={rows}")
        r3 = _run(p, _env())
        rows = [x for x in _rows() if x.get("session_id") == session]
        check("log: hand-back run -> verdict=handback",
              r3.returncode == 0 and len(rows) == 3 and rows[2].get("verdict") == "handback",
              f"rc={r3.returncode} rows={rows}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        session = "sess-notx-" + uuid.uuid4().hex[:8]
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(root / "does-not-exist.jsonl")
        r = _run(p, _env())
        rows = [x for x in _rows() if x.get("session_id") == session]
        check("log: unreadable transcript -> exposed=null, still exit 0",
              r.returncode == 0 and len(rows) == 1 and rows[0].get("exposed") is None,
              f"rc={r.returncode} rows={rows}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        env = _env()
        env["STOP_GATE_LOG_DIR"] = str(root / "committed.txt")
        r = _run(_payload(root), env)
        check("log: unwritable log dir -> still silent exit 0",
              r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
              f"rc={r.returncode} err={r.stderr!r}")

    def _one_row(label: str, want: str | None, run) -> None:
        path_log = Path(tempfile.mkdtemp(prefix="stopgate-path-"))
        scratch_dirs.append(str(path_log))
        env = _env()
        env["STOP_GATE_LOG_DIR"] = str(path_log)
        run(env)
        got = _harness.rows(path_log, "stop-gate")
        if want is None:
            check(f"path {label}: no row (unenrolled, stood down)", got == [], f"rows={got}")
            return
        check(f"path {label}: exactly one row, verdict={want}",
              len(got) == 1 and got[0].get("verdict") == want,
              f"rows={got}")
        if got:
            check(f"path {label}: row names the Stop event",
                  got[0].get("event") in ("Stop", ""), got[0])

    def _repo_case(contract, mutate=None, session=_OMIT, path_dirs=None):
        def run(env):
            root = Path(tempfile.mkdtemp(prefix="stopgate-case-"))
            scratch_dirs.append(str(root))
            _init_repo(root)
            if contract is not None:
                _write_contract(root, contract)
            if mutate is not None:
                mutate(root)
            if path_dirs is not None:
                env["PATH"] = os.pathsep.join(path_dirs)
            _run(_payload(root, session_id=session), env)
        return run

    def _raw(stdin_bytes):
        def run(env):
            root = Path(tempfile.mkdtemp(prefix="stopgate-raw-"))
            scratch_dirs.append(str(root))
            _harness.run_hook(HOOK, stdin_bytes, env=env, cwd=str(root))
        return run

    for label, stdin_bytes in _harness.MALFORMED_STDIN:
        want = None if stdin_bytes.strip() == b"{}" else "fail-open"
        _one_row(f"malformed/{label}", want, _raw(stdin_bytes))

    _one_row("no-contract", "no-contract", _repo_case(None))
    _one_row("null-cmd", "null-cmd",
             _repo_case({"stop": {"cmd": None, "why": "no suite yet"}}))
    _one_row("bad-contract", "bad-contract", _repo_case(
        None, mutate=lambda root: (root / ".claude").mkdir(exist_ok=True)
        or (root / ".claude" / "contract.json").write_text("{not json")))
    _one_row("bad-cmd", "bad-cmd", _repo_case({"test": {"cmd": PASS_CMD, "why": "x"}}))
    _one_row("git-error", "git-error",
             _repo_case({"stop": {"cmd": PASS_CMD, "why": "x"}}, path_dirs=[no_git_dir]))
    _one_row("no-session", "no-session",
             _repo_case({"stop": {"cmd": PASS_CMD, "why": "x"}}, session=None))
    _one_row("clean", "clean", _repo_case({"stop": {"cmd": PASS_CMD, "why": "x"}}))
    _one_row("block", "block", _repo_case({"stop": {"cmd": FAIL_CMD, "why": "x"}}))

    def _handback(env):
        root = Path(tempfile.mkdtemp(prefix="stopgate-hb-"))
        scratch_dirs.append(str(root))
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-hb-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        first = dict(env)
        first["STOP_GATE_LOG_DIR"] = tempfile.mkdtemp(prefix="stopgate-hb-first-")
        scratch_dirs.append(first["STOP_GATE_LOG_DIR"])
        _run(_payload(root, session_id=session), first)
        _run(_payload(root, session_id=session), env)
    _one_row("handback", "handback", _handback)

    for label, slot in [
        ("typo'd key ('command')", {"command": FAIL_CMD, "why": "x"}),
        ("only a 'why'",           {"why": "x"}),
        ("empty slot",             {}),
    ]:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _init_repo(root)
            _write_contract(root, {"stop": slot})
            r = _run(_payload(root), _env())
            check(f"no 'cmd' key ({label}) -> blocks, not silence", _blocked(r),
                  f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")
            check(f"no 'cmd' key ({label}) -> message names the missing key",
                  "no 'cmd' key" in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": None, "why": "no suite yet"}})
        r = _run(_payload(root), _env())
        check("explicit {'cmd': null} still opts out silently",
              r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
              f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")

    _one_row("no-cmd-key", "no-cmd-key",
             _repo_case({"stop": {"command": FAIL_CMD, "why": "x"}}))

    def _bad_contract(root: Path) -> None:
        (root / ".claude").mkdir(exist_ok=True)
        (root / ".claude" / "contract.json").write_text("{not json")

    REFUSALS = [
        ("bad-contract", None, _bad_contract, None, b"not valid JSON"),
        ("bad-cmd", {"test": {"cmd": PASS_CMD, "why": "x"}}, None, None, b"'stop'"),
        ("no-cmd-key", {"stop": {"command": FAIL_CMD, "why": "x"}}, None, None, b"no 'cmd' key"),
        ("git-error", {"stop": {"cmd": PASS_CMD, "why": "x"}}, None, [no_git_dir], b"git"),
    ]

    for label, contract, mutate, path_dirs, fragment in REFUSALS:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _init_repo(root)
            if contract is not None:
                _write_contract(root, contract)
            if mutate is not None:
                mutate(root)
            env = _env(path_dirs=path_dirs)
            session = f"sess-brk-{label}-" + uuid.uuid4().hex[:6]
            SESSION_IDS_USED.append(session)

            r1 = _run(_payload(root, session_id=session), env)
            check(f"breaker/{label}: 1st Stop still fails LOUD (exit 2)",
                  _blocked(r1), f"rc={r1.returncode} err={r1.stderr!r}")
            check(f"breaker/{label}: the block still says what is wrong",
                  fragment.decode() in _reason(r1), _reason(r1))

            r2 = _run(_payload(root, session_id=session), env)
            check(f"breaker/{label}: 2nd Stop in the streak hands back, never wedges",
                  r2.returncode == 0, f"rc={r2.returncode} err={r2.stderr!r}")
            try:
                out2 = json.loads(r2.stdout)
            except json.JSONDecodeError:
                out2 = {}
            check(f"breaker/{label}: hand-back names the hook on systemMessage",
                  str(out2.get("systemMessage", "")).startswith("[stop-gate] UNRESOLVED"),
                  out2)
            check(f"breaker/{label}: hand-back is systemMessage alone, so the turn ends",
                  _ends_turn(r2, "UNRESOLVED"), out2)
            check(f"breaker/{label}: hand-back clears the counter, so the fix re-arms it",
                  not counter_for(session).exists(), str(counter_for(session)))

            session_b = f"sess-active-{label}-" + uuid.uuid4().hex[:6]
            SESSION_IDS_USED.append(session_b)
            r3 = _run(_payload(root, session_id=session_b, stop_hook_active=True), env)
            check(f"breaker/{label}: stop_hook_active=true hands back on the 1st refusal",
                  r3.returncode == 0, f"rc={r3.returncode} err={r3.stderr!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        r1 = _run(_payload(root, session_id=None), _env())
        check("breaker/no-session: without the harness signal it still fails LOUD",
              _blocked(r1) and "session identity" in _reason(r1),
              f"rc={r1.returncode} err={r1.stderr!r}")
        r2 = _run(_payload(root, session_id=None, stop_hook_active=True), _env())
        check("breaker/no-session: stop_hook_active=true hands back (no counter needed)",
              r2.returncode == 0, f"rc={r2.returncode} err={r2.stderr!r}")

    def _released(label: str, want: str, active: bool) -> None:
        path_log = Path(tempfile.mkdtemp(prefix="stopgate-rel-"))
        scratch_dirs.append(str(path_log))
        env = _env()
        env["STOP_GATE_LOG_DIR"] = str(path_log)
        root = Path(tempfile.mkdtemp(prefix="stopgate-rel-case-"))
        scratch_dirs.append(str(root))
        _init_repo(root)
        _bad_contract(root)
        session = "sess-rel-" + uuid.uuid4().hex[:6]
        SESSION_IDS_USED.append(session)
        _run(_payload(root, session_id=session, stop_hook_active=active), env)
        got = _harness.rows(path_log, "stop-gate")
        check(f"row/{label}: verdict=bad-contract, released={want}",
              len(got) == 1 and got[0].get("verdict") == "bad-contract"
              and got[0].get("released") == want, f"rows={got}")

    _released("first refusal", "block", False)
    _released("forced continuation", "handback", True)

    print("\n## Liveness: a red check beside a live sibling session")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD_NOISY, "why": "x"}})
        session = "sess-notmine-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        env = _env()
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Read", "Bash")))
        _other_session_row(root, "sess-sibling-live", seconds_ago=30)

        r1 = _run(p, env)
        d1 = _out(r1)
        check("not-mine: exit 0 and no decision, the turn ends", r1.returncode == 0
              and d1.get("decision") is None,
              f"rc={r1.returncode} out={r1.stdout!r} err={r1.stderr!r}")
        check("not-mine: one-line systemMessage names the hook and the sibling",
              str(d1.get("systemMessage", "")).startswith("[stop-gate] NOT YOURS")
              and "sess-sib" in d1.get("systemMessage", ""), d1)
        check("not-mine: systemMessage is the headline only, no check output",
              "\n" not in d1.get("systemMessage", ""), d1)
        check("not-mine: systemMessage alone, no additionalContext, so the turn ends (#204)",
              _ends_turn(r1, "NOT YOURS"), d1)
        check("not-mine: no counter is armed", not counter_for(session).exists())
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("not-mine: row verdict=not-mine, told=true, other_sessions names the sibling",
              len(rows) == 1 and rows[0].get("verdict") == "not-mine"
              and rows[0].get("told") is True
              and rows[0].get("other_sessions") == ["sess-sibling-live"]
              and rows[0].get("exposed") is False, rows)
        check("not-mine: the speaking row carries chars, the systemMessage's length",
              rows and rows[0].get("chars") == len(d1.get("systemMessage", "")), rows)

        r2 = _run(p, env)
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("not-mine: the same failure again is a silent row, told=false",
              r2.returncode == 0 and r2.stdout == b"" and len(rows) == 2
              and rows[1].get("verdict") == "not-mine" and rows[1].get("told") is False,
              f"out={r2.stdout!r} rows={rows}")
        check("not-mine: the silent repeat carries no chars; it put nothing anywhere",
              len(rows) == 2 and "chars" not in rows[1], rows)
        r2b = _run(p, env)
        check("not-mine: still silent on the third fire: the stamp keys on cmd, not output",
              r2b.returncode == 0 and r2b.stdout == b"", f"out={r2b.stdout!r}")

        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": PASS_CMD, "why": "x"}}))
        r3 = _run(p, env)
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("not-mine: a green stop is clean and still carries other_sessions",
              r3.returncode == 0 and r3.stdout == b"" and rows[-1].get("verdict") == "clean"
              and rows[-1].get("other_sessions") == ["sess-sibling-live"], rows[-1:])
        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": FAIL_CMD_NOISY, "why": "x"}}))
        r4 = _run(p, env)
        check("not-mine: after a green stop the same red is told again",
              str(_out(r4).get("systemMessage", "")).startswith("[stop-gate] NOT YOURS"),
              r4.stdout)
        counter_for(session).with_suffix(".notmine").unlink(missing_ok=True)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-alone-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Read",)))
        _other_session_row(root, "sess-sibling-stale", seconds_ago=_hook.LIVENESS_SECONDS + 60)
        r = _run(p, _env())
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("alone: unexposed + nobody live in the window -> still blocks", _blocked(r),
              f"rc={r.returncode} out={r.stdout!r}")
        check("alone: a stale sibling row is outside the window, other_sessions empty",
              len(rows) == 1 and rows[0].get("other_sessions") == [], rows)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-both-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Edit",)))
        _other_session_row(root, "sess-sibling-live2", seconds_ago=5)
        r = _run(p, _env())
        check("both editing: exposed + live sibling -> blocks (nothing here reads which files)",
              _blocked(r), f"rc={r.returncode} out={r.stdout!r}")
        check("both editing: the block reports the active sibling as a fact",
              "sess-sib" in _reason(r) and "was active here" in _reason(r), _reason(r))
        check("both editing: the block leads with the positive, naming no escape from it",
              "fix the violation it names" in _reason(r)
              and "weaken" not in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-unknown-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(root / "no-such-transcript.jsonl")
        _other_session_row(root, "sess-sibling-live3", seconds_ago=5)
        r = _run(p, _env())
        check("unknowable exposure + live sibling -> blocks, never waved through", _blocked(r),
              f"rc={r.returncode} out={r.stdout!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-otherproj-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Read",)))
        _hook.append_log("validate-bash", {
            "hook": "validate-bash", "session_id": "sess-elsewhere", "project": "some-other-repo",
            "verdict": "allow"}, path=LOG_DIR / f"validate-bash-{datetime.now():%Y-%m-%d}.jsonl")
        r = _run(p, _env())
        check("a live session in a different project does not make this red 'not mine'",
              _blocked(r), f"rc={r.returncode} out={r.stdout!r}")

    print("\n## The echoed tail is fenced, labelled, and marked when cut")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": "echo HEADLINE; echo TAILLINE; false",
                                        "why": "x"}})
        r = _run(_payload(root), _env())
        reason = _reason(r)
        check("fence: the tail is delimited and names the command it came from",
              "--- 'echo HEADLINE; echo TAILLINE; false' output ---" in reason
              and reason.rstrip().endswith("--- end ---"), reason)
        check("fence: a short tail is not marked truncated",
              "truncated" not in reason and "TAILLINE" in reason, reason)
        check("fence: systemMessage stays the headline only, no output",
              "\n" not in _out(r).get("systemMessage", ""), _out(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        noisy = "python3 -c \"print('x'*9000); print('LASTLINE')\"; false"
        _write_contract(root, {"stop": {"cmd": noisy, "why": "x"}})
        r = _run(_payload(root), _env())
        reason = _reason(r)
        check("fence: an over-long tail is marked truncated and keeps its end",
              "chars, truncated ---" in reason and "LASTLINE" in reason, reason[:200])

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        r = _run(_payload(root), _env())
        check("fence: a silent check says so rather than showing an empty fence",
              "printed nothing" in _reason(r), _reason(r))

    print("\n## Liveness defers a config error while a sibling is mid-edit")

    def _config_case(label: str, mutate, want_broken: str) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _init_repo(root)
            mutate(root)
            session = f"sess-cfg-{label}-" + uuid.uuid4().hex[:6]
            SESSION_IDS_USED.append(session)
            p = _payload(root, session_id=session)
            p["transcript_path"] = str(_transcript(root, ("Read",)))
            _other_session_row(root, "sess-sibling-cfg", seconds_ago=20)
            env = _env()

            r1 = _run(p, env)
            d1 = _out(r1)
            check(f"config/{label}: deferred: exit 0, no decision, the turn ends",
                  r1.returncode == 0 and d1.get("decision") is None,
                  f"rc={r1.returncode} out={r1.stdout!r}")
            check(f"config/{label}: the notice names the hook, what is broken, the sibling",
                  str(d1.get("systemMessage", "")).startswith("[stop-gate] NOT YOURS")
                  and want_broken in d1.get("systemMessage", "")
                  and "sess-sib" in d1.get("systemMessage", ""), d1)
            check(f"config/{label}: systemMessage alone, so the turn ends (#204)",
                  _ends_turn(r1, "NOT YOURS"), d1)
            check(f"config/{label}: no counter is armed; a deferral is not a block",
                  not counter_for(session).exists(), str(counter_for(session)))
            rows = [x for x in _harness.rows(LOG_DIR, "stop-gate")
                    if x.get("session_id") == session]
            check(f"config/{label}: row released=not-mine, told=true, names the sibling",
                  len(rows) == 1 and rows[0].get("released") == "not-mine"
                  and rows[0].get("told") is True
                  and rows[0].get("other_sessions") == ["sess-sibling-cfg"], rows)

            r2 = _run(p, env)
            rows = [x for x in _harness.rows(LOG_DIR, "stop-gate")
                    if x.get("session_id") == session]
            check(f"config/{label}: the same config error again is a silent row",
                  r2.returncode == 0 and r2.stdout == b"" and len(rows) == 2
                  and rows[1].get("told") is False, f"out={r2.stdout!r} rows={rows}")

    _config_case("bad-contract", _bad_contract, "the contract")
    _config_case("no-cmd-key",
                 lambda root: _write_contract(root, {"stop": {"command": "x", "why": "y"}}),
                 "the contract")
    _config_case("bad-cmd", lambda root: _write_contract(root, {"stop": "nope"}),
                 "the contract")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _bad_contract(root)
        session = "sess-cfg-alone-" + uuid.uuid4().hex[:6]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Read",)))
        _other_session_row(root, "sess-sibling-stale-cfg",
                           seconds_ago=_hook.LIVENESS_SECONDS + 60)
        r = _run(p, _env())
        check("config/alone: no live sibling -> blocks as ever, liveness waives nothing",
              _blocked(r) and "contract" in _reason(r), f"rc={r.returncode} out={r.stdout!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _bad_contract(root)
        session = "sess-cfg-exposed-" + uuid.uuid4().hex[:6]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Edit",)))
        _other_session_row(root, "sess-sibling-cfg2", seconds_ago=10)
        r = _run(p, _env())
        check("config/exposed: this session edited here, so it is refused, not deferred",
              _blocked(r), f"rc={r.returncode} out={r.stdout!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _bad_contract(root)
        session = "sess-cfg-unknown-" + uuid.uuid4().hex[:6]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(root / "no-such-transcript.jsonl")
        _other_session_row(root, "sess-sibling-cfg3", seconds_ago=10)
        r = _run(p, _env())
        check("config/unknowable exposure: refused, never deferred",
              _blocked(r), f"rc={r.returncode} out={r.stdout!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        p = _payload(root, session_id=None)
        p["transcript_path"] = str(_transcript(root, ("Read",)))
        _other_session_row(root, "sess-sibling-nosess", seconds_ago=10)
        r = _run(p, _env())
        check("config/no-session: refused beside a live sibling; no stamp to defer with",
              _blocked(r) and "session identity" in _reason(r),
              f"rc={r.returncode} out={r.stdout!r}")

    print("\n## A red check while this session's background tasks run is deferred")
    TASKS = [{"id": "t1", "type": "subagent", "status": "running", "agent_type": "fork"},
             {"id": "t2", "type": "shell", "status": "running", "command": "sleep 9"}]
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD_NOISY, "why": "x"}})
        session = "sess-bg-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        env = _env()
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Edit",)))
        p["background_tasks"] = TASKS

        r1 = _run(p, env)
        d1 = _out(r1)
        check("deferred: systemMessage alone, one line, no decision: the turn ends",
              _ends_turn(r1, "DEFERRED"), d1)
        check("deferred: the notice names the check, the project and the task count",
              "'date +%s%N; false'" in d1.get("systemMessage", "")
              and root.name in d1.get("systemMessage", "")
              and "2 background task" in d1.get("systemMessage", ""), d1)
        check("deferred: no counter is armed; a deferral is not a block",
              not counter_for(session).exists())
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("deferred: row verdict=deferred, told=true, background_tasks=2, chars set",
              len(rows) == 1 and rows[0].get("verdict") == "deferred"
              and rows[0].get("told") is True and rows[0].get("background_tasks") == 2
              and rows[0].get("chars") == len(d1.get("systemMessage", "")), rows)

        r2 = _run(p, env)
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("deferred: the same red again while tasks still run is a silent row",
              r2.returncode == 0 and r2.stdout == b"" and len(rows) == 2
              and rows[1].get("verdict") == "deferred" and rows[1].get("told") is False
              and "chars" not in rows[1], f"out={r2.stdout!r} rows={rows}")

        p["background_tasks"] = []
        r3 = _run(p, env)
        check("deferred: an empty array is refused as before, a fresh block",
              _blocked(r3), f"rc={r3.returncode} out={r3.stdout!r}")
        check("deferred: the block armed the counter the deferral left alone",
              counter_for(session).exists())

        p["background_tasks"] = TASKS
        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": PASS_CMD, "why": "x"}}))
        r4 = _run(p, env)
        (root / ".claude" / "contract.json").write_text(
            json.dumps({"stop": {"cmd": FAIL_CMD_NOISY, "why": "x"}}))
        r5 = _run(p, env)
        check("deferred: a green stop clears the stamp; the same red is told again",
              r4.stdout == b"" and _ends_turn(r5, "DEFERRED"), f"r4={r4.stdout!r} r5={r5.stdout!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-bg-live-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["transcript_path"] = str(_transcript(root, ("Read",)))
        p["background_tasks"] = TASKS[:1]
        _other_session_row(root, "sess-sibling-bg", seconds_ago=5)
        r = _run(p, _env())
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("deferred beside a live sibling: deferred, not not-mine, and the row still "
              "names the sibling",
              _ends_turn(r, "DEFERRED") and rows and rows[0].get("verdict") == "deferred"
              and rows[0].get("other_sessions") == ["sess-sibling-bg"], rows)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _bad_contract(root)
        session = "sess-bg-cfg-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        p = _payload(root, session_id=session)
        p["background_tasks"] = TASKS[:1]
        r1 = _run(p, _env())
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("deferred config error: told once, row verdict=bad-contract released=deferred",
              _ends_turn(r1, "DEFERRED") and "the contract" in _reason(r1)
              and len(rows) == 1 and rows[0].get("verdict") == "bad-contract"
              and rows[0].get("released") == "deferred" and rows[0].get("told") is True
              and isinstance(rows[0].get("chars"), int), rows)
        r2 = _run(p, _env())
        check("deferred config error: the repeat is silent", r2.stdout == b"", r2.stdout)
        p["background_tasks"] = []
        r3 = _run(p, _env())
        check("deferred config error: refused once nothing is running",
              _blocked(r3), f"rc={r3.returncode} out={r3.stdout!r}")

    for label, value in [("absent", _OMIT), ("null", None), ("not-a-list", "running"),
                         ("empty", [])]:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _init_repo(root)
            _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
            p = _payload(root)
            if value is not _OMIT:
                p["background_tasks"] = value
            r = _run(p, _env())
            check(f"background_tasks {label} -> refused as before", _blocked(r),
                  f"rc={r.returncode} out={r.stdout!r}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        p = _payload(root, session_id=None)
        p["background_tasks"] = TASKS
        r = _run(p, _env())
        check("no-session with tasks running: refused, never deferred",
              _blocked(r) and "session identity" in _reason(r), f"out={r.stdout!r}")

    print("\n## The block leads with the runner's verdict line and bounds the tail")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        runner = root / "gauntlet"
        runner.write_text("#!/bin/sh\necho 'gauntlet: FAILED at typecheck test_related'\n"
                          "python3 -c \"print('x'*4000)\"\nexit 1\n")
        runner.chmod(0o755)
        _write_contract(root, {"stop": {"cmd": "./gauntlet stop", "why": "x"}})
        session = "sess-verdict-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        r = _run(_payload(root, session_id=session), _env())
        reason = _reason(r)
        check("verdict line: the runner's own `gauntlet:` line rides above the fence",
              "verdict: gauntlet: FAILED at typecheck test_related" in reason
              and reason.index("verdict:") < reason.index("--- './gauntlet stop'"), reason[:300])
        check("verdict line: the tail is bounded at 1500 chars and marked",
              "last 1500 chars, truncated ---" in reason, reason[:300])
        fence = reason.split("---\n", 1)[1].rsplit("\n--- end ---", 1)[0]
        check("verdict line: the fenced tail is exactly the last 1500 chars",
              len(fence) == 1500, len(fence))
        check("verdict line: Claude's text stays under 2000 chars in all",
              len(reason) < 2000, len(reason))
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("verdict line: the block's row carries chars = reason + systemMessage",
              rows and rows[0].get("verdict") == "block"
              and rows[0].get("chars") == len(reason) + len(_out(r).get("systemMessage", "")),
              rows)

        r2 = _run(_payload(root, session_id=session), _env())
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("hand-back: no verdict line, no fence, one line",
              _ends_turn(r2, "UNRESOLVED") and "gauntlet: FAILED" not in r2.stdout.decode(),
              r2.stdout)
        check("hand-back: the row carries chars, the one line's length",
              len(rows) == 2 and rows[1].get("verdict") == "handback"
              and rows[1].get("chars") == len(_out(r2).get("systemMessage", "")), rows)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": "echo first; echo LAST WORD; false", "why": "x"}})
        r = _run(_payload(root), _env())
        check("verdict line: a runner with no `name:` line contributes its last line",
              "verdict: LAST WORD" in _reason(r), _reason(r))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _init_repo(root)
        _write_contract(root, {"stop": {"cmd": PASS_CMD, "why": "x"}})
        session = "sess-quiet-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        _run(_payload(root, session_id=session), _env())
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("a clean row carries no chars", rows and "chars" not in rows[0], rows)

    print("\n## Stands down when unenrolled")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
        (root / "committed.txt").write_text("v1\n")
        subprocess.run(["git", "add", "."], cwd=root, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=root, check=True)
        _dirty(root)
        _write_contract(root, {"stop": {"cmd": FAIL_CMD, "why": "x"}})
        session = "sess-unenrolled-" + uuid.uuid4().hex[:8]
        SESSION_IDS_USED.append(session)
        r = _run(_payload(root, session_id=session), _env())
        check("the same failing check that would block is silent in an unenrolled repo",
              r.returncode == 0 and r.stdout == b"" and r.stderr == b"",
              f"rc={r.returncode} out={r.stdout!r} err={r.stderr!r}")
        rows = [x for x in _harness.rows(LOG_DIR, "stop-gate") if x.get("session_id") == session]
        check("an unenrolled repo writes no row", rows == [], rows)

    shutil.rmtree(LOG_DIR, ignore_errors=True)
    for d in scratch_dirs:
        shutil.rmtree(d, ignore_errors=True)
    for session_id in SESSION_IDS_USED:
        counter_for(session_id).unlink(missing_ok=True)
        counter_for(session_id).with_suffix(".notmine").unlink(missing_ok=True)
        counter_for(session_id).with_suffix(".deferred").unlink(missing_ok=True)

    finish("All stop-gate checks passed.")


if __name__ == "__main__":
    main()
