#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import _harness
from _harness import check, finish

HOOKS_DIR = Path(__file__).resolve().parent
LIB_DIR = next((c for c in (HOOKS_DIR, HOOKS_DIR / "lib") if (c / "_hook.mjs").is_file()), HOOKS_DIR)
WRITERS = ("py", "mjs", "sh")
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")

PRE_TOOL_USE = {
    "hook_event_name": "PreToolUse",
    "session_id": "sess-210",
    "cwd": "/home/someone/Projects/Lumaria",
    "tool_use_id": "toolu_01PIN",
    "tool_name": "Bash",
    "tool_input": {"command": "ls"},
}
STOP = {
    "hook_event_name": "Stop",
    "session_id": "sess-210",
    "cwd": "/home/someone/Projects/Lumaria",
}


def write_fixtures(tmp: Path) -> dict[str, Path]:
    py = tmp / "pin-hook.py"
    py.write_text(
        "import sys\n"
        f"sys.path.insert(0, {str(HOOKS_DIR)!r})\n"
        "import _hook\n"
        "payload, ok = _hook.read_payload()\n"
        "_hook.append_log(_hook.HOOK_NAME, _hook.run_row(\n"
        "    payload, 'allow' if ok else 'bad-stdin', slug='x', chars=12))\n"
    )
    mjs = tmp / "pin-hook.mjs"
    mjs.write_text(
        f"import {{ readPayload, runRow, appendLog }} from {(LIB_DIR / '_hook.mjs').as_uri()!r};\n"
        "const [payload, ok] = readPayload();\n"
        "appendLog(runRow(payload, ok ? 'allow' : 'bad-stdin', { slug: 'x', chars: 12 }));\n"
    )
    sh = tmp / "pin-hook.sh"
    sh.write_text(
        f". {str(LIB_DIR / '_hook.sh')!r}\n"
        "hook_run_row allow slug=x chars=12\n"
    )
    return {"py": py, "mjs": mjs, "sh": sh}


def drive(writer: str, fixture: Path, stdin: bytes, extra_env: dict | None = None) -> tuple[list[dict], Path]:
    log_dir = Path(tempfile.mkdtemp(prefix=f"pin-{writer}-"))
    env = dict(os.environ, STOP_GATE_LOG_DIR=str(log_dir), **(extra_env or {}))
    if writer == "py":
        _harness.run_hook(fixture, stdin, env=env)
    else:
        runner = "node" if writer == "mjs" else "bash"
        subprocess.run([runner, str(fixture)], input=stdin, capture_output=True,
                       timeout=_harness.HOOK_TIMEOUT, env=env)
    return _harness.rows(log_dir, "pin-hook"), log_dir


def pinned(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("ts", "seconds")}


def check_one_payload_three_writers(fixtures):
    print("one PreToolUse payload through all three writers: identical rows apart from ts/seconds, into <hook>-YYYY-MM-DD.jsonl")
    stdin = json.dumps(PRE_TOOL_USE).encode()
    got = {}
    for w in WRITERS:
        rows, log_dir = drive(w, fixtures[w], stdin)
        check(f"{w}: exactly one row", len(rows) == 1, rows)
        if not rows:
            continue
        got[w] = rows[0]
        files = sorted(p.name for p in log_dir.glob("*.jsonl"))
        check(f"{w}: file is pin-hook-YYYY-MM-DD.jsonl",
              files == [f"pin-hook-{datetime.now():%Y-%m-%d}.jsonl"], files)
        check(f"{w}: ts is local time at seconds precision",
              TS_RE.match(str(rows[0].get("ts", ""))), rows[0].get("ts"))
        check(f"{w}: seconds is a small non-negative number",
              isinstance(rows[0].get("seconds"), (int, float)) and 0 <= rows[0]["seconds"] < 10,
              rows[0].get("seconds"))
    if len(got) != 3:
        return
    want = {
        "hook": "pin-hook", "event": "PreToolUse", "session_id": "sess-210",
        "project": "Lumaria", "verdict": "allow", "tool_use_id": "toolu_01PIN",
        "slug": "x", "chars": 12,
    }
    check("py: the six fields, tool_use_id, and both extras, as expected", pinned(got["py"]) == want,
          pinned(got["py"]))
    for w in ("mjs", "sh"):
        check(f"{w}: row equals the Python row apart from ts/seconds",
              pinned(got[w]) == pinned(got["py"]),
              f"{w}={pinned(got[w])}\npy={pinned(got['py'])}")
        check(f"{w}: key order matches the Python row",
              list(got[w]) == list(got["py"]), (list(got[w]), list(got["py"])))


def check_stop_and_bad_stdin(fixtures):
    print("a Stop payload writes no tool_use_id key; a payload that never parsed still writes a row, with event and session_id empty")
    stop = json.dumps(STOP).encode()
    for w in WRITERS:
        rows, _ = drive(w, fixtures[w], stop)
        check(f"{w}: Stop payload writes one row", len(rows) == 1, rows)
        if rows:
            check(f"{w}: no tool_use_id key on a Stop row", "tool_use_id" not in rows[0], rows[0])
            check(f"{w}: Stop row still carries event/session_id/project",
                  rows[0].get("event") == "Stop" and rows[0].get("session_id") == "sess-210"
                  and rows[0].get("project") == "Lumaria", rows[0])
    for label, raw in _harness.MALFORMED_STDIN:
        for w in WRITERS:
            rows, _ = drive(w, fixtures[w], raw)
            check(f"{w}: malformed stdin ({label}) still writes one row", len(rows) == 1, rows)
            if rows:
                check(f"{w}: malformed stdin ({label}): event and session_id are empty, never absent",
                      rows[0].get("event") == "" and rows[0].get("session_id") == ""
                      and rows[0].get("project") == "", rows[0])


def check_local_ts(fixtures):
    print("ts is local time at seconds precision under TZ=Asia/Tokyo and under the machine default")
    stdin = json.dumps(PRE_TOOL_USE).encode()
    for label, tz_env, now_fn in (
        ("default", {}, datetime.now),
        ("Asia/Tokyo", {"TZ": "Asia/Tokyo"}, lambda: datetime.now(ZoneInfo("Asia/Tokyo")).replace(tzinfo=None)),
    ):
        for w in WRITERS:
            before = now_fn().replace(microsecond=0)
            rows, log_dir = drive(w, fixtures[w], stdin, tz_env)
            after = now_fn().replace(microsecond=0) + timedelta(seconds=1)
            ts = rows[0].get("ts") if rows else None
            ok_shape = isinstance(ts, str) and TS_RE.match(ts)
            check(f"{w} [{label}]: ts has the one format", ok_shape, ts)
            if not ok_shape:
                continue
            when = datetime.fromisoformat(ts)
            check(f"{w} [{label}]: ts is that zone's wall clock, not UTC",
                  before <= when <= after, f"ts={ts} window=[{before}, {after}]")
            files = [p.name for p in log_dir.glob("*.jsonl")]
            check(f"{w} [{label}]: the file is dated by the same wall clock",
                  files == [f"pin-hook-{when:%Y-%m-%d}.jsonl"], files)


def check_inherited_env_discarded(fixtures):
    print("the bash shim discards an inherited HOOK_PAYLOAD/HOOK_NAME/HOOK_STARTED_MS and exports none of them")
    stale = {
        "HOOK_PAYLOAD": json.dumps({"hook_event_name": "SessionEnd", "session_id": "dead-session", "cwd": "Elsewhere"}),
        "HOOK_NAME": "dead-hook",
        "HOOK_STARTED_MS": "0",
    }
    rows, _ = drive("sh", fixtures["sh"], json.dumps(PRE_TOOL_USE).encode(), stale)
    check("sh: one row despite the inherited environment", len(rows) == 1, rows)
    if rows:
        check("sh: the row is stdin's payload, not the environment's",
              rows[0].get("session_id") == "sess-210" and rows[0].get("event") == "PreToolUse", rows[0])
        check("sh: the row names the sourcing script, not the inherited name", rows[0].get("hook") == "pin-hook", rows[0])
        check("sh: seconds is measured from this sourcing, not an inherited clock",
              isinstance(rows[0].get("seconds"), (int, float)) and 0 <= rows[0]["seconds"] < 10, rows[0].get("seconds"))
    probe = subprocess.run(
        ["bash", "-c", f". {str(LIB_DIR / '_hook.sh')!r}; env | grep -c '^HOOK_' || true"],
        input=json.dumps(PRE_TOOL_USE).encode(), capture_output=True, timeout=_harness.HOOK_TIMEOUT,
        env=dict(os.environ, **stale),
    )
    check("sh: a child of the hook inherits no HOOK_* variable", probe.stdout.decode().strip() == "0", probe.stdout)


def check_prune(fixtures):
    print("the JS writer prunes an aged sibling the way the Python one does")
    stdin = json.dumps(PRE_TOOL_USE).encode()
    for w in ("mjs", "sh"):
        log_dir = Path(tempfile.mkdtemp(prefix=f"pin-prune-{w}-"))
        aged = log_dir / "pin-hook-2000-01-01.jsonl"
        aged.write_text("{}\n")
        other = log_dir / "other-hook-2000-01-01.jsonl"
        other.write_text("{}\n")
        env = dict(os.environ, STOP_GATE_LOG_DIR=str(log_dir))
        runner = "node" if w == "mjs" else "bash"
        subprocess.run([runner, str(fixtures[w])], input=stdin, capture_output=True,
                       timeout=_harness.HOOK_TIMEOUT, env=env)
        check(f"{w}: pre-aged sibling pruned", not aged.exists())
        check(f"{w}: another hook's aged file is not its to prune", other.exists())


def main():
    with tempfile.TemporaryDirectory(prefix="pin-hook-") as tmp:
        fixtures = write_fixtures(Path(tmp))
        check_one_payload_three_writers(fixtures)
        print()
        check_stop_and_bad_stdin(fixtures)
        print()
        check_local_ts(fixtures)
        print()
        check_inherited_env_discarded(fixtures)
        print()
        check_prune(fixtures)
    finish("All run-row writer checks passed.")


if __name__ == "__main__":
    sys.exit(main())
