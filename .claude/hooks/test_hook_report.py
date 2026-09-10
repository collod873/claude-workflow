#!/usr/bin/env python3
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import _harness
from _harness import check, finish

REPO = next((c for c in (Path(__file__).resolve().parent.parent, Path(__file__).resolve().parent.parent.parent) if (c / "bin").is_dir()), Path(__file__).resolve().parent.parent)
REPORT = REPO / "bin" / "hook-report"
TMP = Path(tempfile.mkdtemp(prefix="hook-report-fixture-"))
LOGS = TMP / "logs"


def day(offset):
    return (datetime.now() - timedelta(days=offset)).strftime("%Y-%m-%d")


def write_rows(mechanism, offset, rows):
    LOGS.mkdir(parents=True, exist_ok=True)
    path = LOGS / f"{mechanism}-{day(offset)}.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def hook_row(hook, event, verdict, seconds, project="Demo", **extra):
    return dict({"hook": hook, "event": event, "session_id": "s", "project": project,
                 "verdict": verdict, "seconds": seconds, "ts": "2026-08-28T00:00:00"}, **extra)


def build_fixture():
    write_rows("validate-bash", 0, [
        hook_row("validate-bash", "PreToolUse", "allow", 0.01) for _ in range(6)
    ] + [
        hook_row("validate-bash", "PreToolUse", "deny", 0.02, guard="compound-close"),
        hook_row("validate-bash", "PreToolUse", "deny", 0.03, guard="wasteful-dir"),
    ])

    write_rows("circuit-breaker", 0, [
        hook_row("circuit-breaker", "PostToolUse", "reset", 0.005),
        hook_row("circuit-breaker", "PostToolUseFailure", "count", 0.006),
        hook_row("circuit-breaker", "PostToolUseFailure", "warn", 0.007, failures=3,
                 tool="Bash", chars=120),
    ])

    write_rows("stop-gate", 0, [
        hook_row("stop-gate", "Stop", "clean", 0.5, exposed=True),
        hook_row("stop-gate", "Stop", "clean", 0.7, exposed=False),
        hook_row("stop-gate", "Stop", "block", 0.9, exposed=True, chars=1800),
        hook_row("stop-gate", "Stop", "handback", 0.9, exposed=True, chars=150),
        hook_row("stop-gate", "Stop", "handback", 0.9, exposed=True, chars=150),
    ])

    write_rows("clone-check", 0, [
        {"tool": "clone-check", "event": "bin", "project": "Lumaria", "verdict": "clean",
         "seconds": 1.2, "files": 300, "clones": 0, "ts": "2026-08-28T00:00:00"},
        {"tool": "clone-check", "event": "bin", "project": "Demo", "verdict": "clones",
         "seconds": 1.4, "files": 220, "clones": 2, "ts": "2026-08-28T00:00:00"},
    ])

    write_rows("validate-bash", 40, [hook_row("validate-bash", "PreToolUse", "deny", 9.9,
                                              guard="dotenv")])

    write_rows("stop-fires", 0, [{"session_id": "s", "project": "Demo",
                                  "ts": "2026-08-28T00:00:00"}])


def run(*args):
    return subprocess.run([sys.executable, str(REPORT), "--log-dir", str(LOGS), *args],
                          capture_output=True, text=True)


def cells(out, mechanism, event=None):
    for line in out.splitlines():
        if not line.startswith("| "):
            continue
        parts = [c.strip() for c in line.strip("|").split("|")]
        if parts[0] == mechanism and (event is None or parts[1] == event):
            return parts
    return []


def main():
    build_fixture()

    print("\n## The table's shape is the audit's")
    r = run("--days", "2")
    check("exits 0", r.returncode == 0, r.stderr)
    header = [c.strip() for c in
              next(l for l in r.stdout.splitlines() if l.startswith("| Mechanism")).strip("|").split("|")]
    check("columns are the audit's table plus Injected (#197)",
          header == ["Mechanism", "Event", "Fires", "Exposed", "Catches", "Verdicts",
                     "Median s", "Injected"], header)
    check("no cell reads n/i, the column the hand-built table could not fill",
          "n/i" not in r.stdout, r.stdout)

    print("\n## Fires, exposed, catches and median are arithmetic")
    row = cells(r.stdout, "validate-bash")
    check("validate-bash: 8 fires", row[2:3] == ["8"], row)
    check("validate-bash: all 8 exposed; a Bash call is always something to read",
          row[3:4] == ["8"], row)
    check("validate-bash: 2 catches, the two denies", row[4:5] == ["2"], row)
    check("validate-bash: verdicts counted, commonest first",
          row[5] == "allow 6 · deny 2", row)
    check("validate-bash: median is the middle seconds value, not n/i",
          row[6] == "0.010", row)

    print("\n## A mechanism on two events gets two lines")
    check("circuit-breaker/PostToolUse is its own line",
          cells(r.stdout, "circuit-breaker", "PostToolUse")[2:3] == ["1"],
          cells(r.stdout, "circuit-breaker", "PostToolUse"))
    fail_line = cells(r.stdout, "circuit-breaker", "PostToolUseFailure")
    check("circuit-breaker/PostToolUseFailure is its own line, with its own catches",
          fail_line[2:5] == ["2", "2", "1"], fail_line)

    print("\n## Injected is the sum of what a mechanism put in front of Claude (#197)")
    check("a mechanism whose speaking row carries `chars` reports the sum",
          fail_line[7:8] == ["120"], fail_line)
    check("a mechanism with no `chars` on any row reads `-`, not 0: uninstrumented, not silent",
          cells(r.stdout, "validate-bash")[7:8] == ["-"], cells(r.stdout, "validate-bash"))

    print("\n## An explicit `exposed` field beats the verdict heuristic")
    row = cells(r.stdout, "stop-gate")
    check("stop-gate: 5 fires, 4 exposed (the transcript said so), 3 catches",
          row[2:5] == ["5", "4", "3"], row)
    check("stop-gate: Injected is the sum over its speaking rows, not `-` (#204)",
          row[7:8] == ["2100"], row)

    print("\n## A hand-back outnumbering its blocks trips a wire below the table")
    wires = [l for l in r.stdout.splitlines() if l.startswith("tripwire:")]
    check("stop-gate's 2 hand-backs to 1 block is named, with the counts and what it means",
          wires == ["tripwire: stop-gate/Stop handback 2 > block 1: "
                    "the hand-back is continuing the turn, not ending it"], wires)
    check("no other mechanism trips it: the wire is the inequality, not the verdict word",
          len(wires) == 1, wires)
    lumaria_only = run("--days", "2", "--repo", "Lumaria")
    check("a window with no hand-backs prints no tripwire line at all",
          "tripwire:" not in lumaria_only.stdout, lumaria_only.stdout)

    print("\n## The window is honoured")
    check("a row 40 days old never reaches a --days 2 table",
          "dotenv" not in r.stdout and cells(r.stdout, "validate-bash")[2] == "8", r.stdout)
    wide = run("--days", "60")
    check("widening the window brings it back",
          cells(wide.stdout, "validate-bash")[2] == "9", wide.stdout)

    print("\n## Pre-#182 rows are attributed, not dropped or labelled '?'")
    row = cells(r.stdout, "stop-fires")
    check("a row with no mechanism name is attributed to its own log file",
          row[2:3] == ["1"], row)
    check("a row with no verdict is named as such rather than blanked",
          "pre-row" in row[5], row)

    print("\n## --repo answers 'is this repo's gate being run'")
    lumaria = run("--days", "2", "--repo", "Lumaria")
    check("--repo keeps only that repo's rows",
          cells(lumaria.stdout, "clone-check")[2:3] == ["1"], lumaria.stdout)
    check("--repo excludes every other mechanism that never ran there",
          cells(lumaria.stdout, "validate-bash") == [], lumaria.stdout)
    check("the header names the repo being asked about", "in Lumaria" in lumaria.stdout,
          lumaria.stdout.splitlines()[:1])

    absent = run("--days", "2", "--repo", "NeverRanHere")
    check("a repo with no rows reports that as a finding, not an error",
          absent.returncode == 0 and "No rows" in absent.stdout, absent.stdout)

    print("\n## An empty or missing log directory is not a crash")
    empty = run("--days", "2", "--log-dir", str(TMP / "does-not-exist"))
    check("a missing log dir exits 0 and says so",
          empty.returncode == 0 and "No rows" in empty.stdout, empty.stdout)

    print("\n## The reader is _harness.rows(), not a second copy")
    check("hook-report reads through the shared reader every harness asserts with",
          "_harness.rows(" in REPORT.read_text(), "hook-report must not re-implement rows()")
    check("the shared reader agrees with the report's own count",
          len(_harness.rows(LOGS, days=2)) == 19, len(_harness.rows(LOGS, days=2)))

    shutil.rmtree(TMP, ignore_errors=True)
    finish("All hook-report checks passed.")


if __name__ == "__main__":
    main()
