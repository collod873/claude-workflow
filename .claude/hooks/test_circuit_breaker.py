#!/usr/bin/env python3
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

import _harness
from _harness import check, finish

HOOK = Path(__file__).with_name("circuit-breaker.py")
ROWLOG = _harness.RowLog("circuit-breaker-log-")

WARN_THRESHOLD = 3
STOP_THRESHOLD = 5
STALE_HOURS = 4

STATE_DIRS = []


def fresh_state():
    d = Path(tempfile.mkdtemp(prefix="circuit-breaker-state-"))
    STATE_DIRS.append(d)
    return d


def state_file(state_dir, session="sess-breaker", agent=""):
    return state_dir / f"{session}--{agent or 'main'}.json"


def payload(event, tool_name="Bash", session="sess-breaker", agent="", **extra):
    return json.dumps({
        "hook_event_name": event,
        "session_id": session,
        "agent_type": agent,
        "cwd": "/home/collin/Projects/Demo",
        "tool_name": tool_name,
        **extra,
    }).encode()


def drive(state_dir, stdin_bytes):
    run = _harness.run_hook(HOOK, stdin_bytes,
                            env=ROWLOG.env(CIRCUIT_BREAKER_STATE=str(state_dir)))
    assert run.proc.returncode == 0, f"exit {run.proc.returncode}: {run.proc.stderr!r}"
    assert run.proc.stderr == b"", run.proc.stderr
    return _harness.spoken(run, "circuit-breaker"), ROWLOG.last("circuit-breaker")


def grade(label, state_dir, stdin_bytes, want_verdict, want_failures, want_speaks):
    msg, rows = drive(state_dir, stdin_bytes)
    check(f"{label}: {'speaks' if want_speaks else 'silent'}",
          bool(msg) == want_speaks, f"msg={msg[:70]!r}")
    ok = (len(rows) == 1 and rows[0].get("verdict") == want_verdict
          and rows[0].get("failures") == want_failures)
    check(f"{label}: one row, verdict={want_verdict}, failures={want_failures}", ok, str(rows))
    return msg, rows


def main():
    print("\n## The failure streak escalates, and every step leaves a row")
    st = fresh_state()
    for n in range(1, WARN_THRESHOLD):
        _, rows = grade(f"failure {n}", st, payload("PostToolUseFailure"), "count", n, False)
        check(f"failure {n}: the row names the tool", rows[0].get("tool") == "Bash", str(rows))
    msg, rows = grade(f"failure {WARN_THRESHOLD}", st, payload("PostToolUseFailure"),
                      "warn", WARN_THRESHOLD, True)
    check("warn states the fact: the count and the last tool",
          f"{WARN_THRESHOLD} tool calls in a row" in msg and "Bash" in msg, msg)
    check("warn gives one checkable step: name the cause before the next call",
          "name the cause" in msg, msg)
    check("warn's row carries the injected length", rows[0].get("chars") == len(msg), str(rows))

    for n in range(WARN_THRESHOLD + 1, STOP_THRESHOLD):
        grade(f"failure {n}", st, payload("PostToolUseFailure"), "warn", n, True)
    msg, _ = grade(f"failure {STOP_THRESHOLD}", st, payload("PostToolUseFailure"),
                   "stop", STOP_THRESHOLD, True)
    check("stop's step changes the approach, not the arguments",
          "changes the approach" in msg, msg)
    check("state lives in one file per session and agent",
          state_file(st).is_file(), str(list(st.iterdir())))

    print("\n## A success resets the counter")
    grade("success after a streak", st, payload("PostToolUse"), "reset", 0, False)
    grade("first failure after a reset starts over", st, payload("PostToolUseFailure"),
          "count", 1, False)

    print("\n## An interrupt is not a failure of the approach (#197)")
    sti = fresh_state()
    for n in range(1, WARN_THRESHOLD):
        drive(sti, payload("PostToolUseFailure"))
    grade("Ctrl-C mid-streak: counter untouched, silent",
          sti, payload("PostToolUseFailure", is_interrupt=True), "nothing",
          WARN_THRESHOLD - 1, False)
    grade("the next real failure still reaches the warn threshold",
          sti, payload("PostToolUseFailure"), "warn", WARN_THRESHOLD, True)

    print("\n## Two sessions never touch each other's streak (#196)")
    st2 = fresh_state()
    for n in range(1, WARN_THRESHOLD):
        drive(st2, payload("PostToolUseFailure", session="sess-a"))
    grade("session B's success leaves A's streak alone",
          st2, payload("PostToolUse", session="sess-b"), "reset", 0, False)
    grade("session A's next failure still warns", st2,
          payload("PostToolUseFailure", session="sess-a"), "warn", WARN_THRESHOLD, True)
    grade("session B's first failure is its own count of one", st2,
          payload("PostToolUseFailure", session="sess-b"), "count", 1, False)
    check("two state files, one per session",
          state_file(st2, "sess-a").is_file() and state_file(st2, "sess-b").is_file(),
          str(list(st2.iterdir())))

    print("\n## A subagent's streak is its own, not the main agent's")
    st3 = fresh_state()
    for n in range(1, STOP_THRESHOLD + 1):
        drive(st3, payload("PostToolUseFailure", session="sess-s", agent="general-purpose"))
    grade("the main agent's first failure after a subagent's streak of five counts one",
          st3, payload("PostToolUseFailure", session="sess-s"), "count", 1, False)
    check("the subagent's file is keyed on its agent_type",
          state_file(st3, "sess-s", "general-purpose").is_file(), str(list(st3.iterdir())))

    print("\n## SessionStart resets the session's own counter and prunes dead sessions")
    st4 = fresh_state()
    for _ in range(WARN_THRESHOLD):
        drive(st4, payload("PostToolUseFailure"))
    dead = state_file(st4, "sess-dead")
    dead.write_text(json.dumps({"consecutive_failures": 4, "updated": 0}))
    old = time.time() - (STALE_HOURS + 1) * 3600
    os.utime(dead, (old, old))
    grade("SessionStart", st4, payload("SessionStart"), "reset", 0, False)
    check("SessionStart cleared this session's state file",
          json.loads(state_file(st4).read_text())["consecutive_failures"] == 0,
          state_file(st4).read_text())
    check("SessionStart pruned a dead session's stale file", not dead.exists(), str(dead))

    print("\n## A success with nothing to reset is still a fire")
    st5 = fresh_state()
    grade("success on a clean counter", st5, payload("PostToolUse"), "reset", 0, False)

    print("\n## A stale state file is not a live streak")
    st6 = fresh_state()
    state_file(st6).write_text(json.dumps({
        "consecutive_failures": STOP_THRESHOLD,
        "updated": time.time() - (STALE_HOURS + 1) * 3600,
    }))
    grade("failure after a stale gap", st6, payload("PostToolUseFailure"), "count", 1, False)

    print("\n## An unreadable state file fails open at zero")
    st7 = fresh_state()
    state_file(st7).write_text("{not json")
    grade("failure with a corrupt state file", st7, payload("PostToolUseFailure"),
          "count", 1, False)
    state_file(st7).write_text(json.dumps({"consecutive_failures": "four",
                                           "updated": time.time()}))
    grade("failure with a count that is not a number", st7, payload("PostToolUseFailure"),
          "count", 1, False)

    print("\n## An unwritable state directory never changes the exit code (fail open)")
    unwritable = fresh_state() / "committed.txt"
    unwritable.write_text("a file where a directory should be\n")
    grade("failure with no writable state: counted as a fresh one, exit 0, no stderr",
          unwritable, payload("PostToolUseFailure"), "count", 1, False)
    grade("SessionStart with no writable state: still a reset row, exit 0",
          unwritable, payload("SessionStart"), "reset", 0, False)

    print("\n## Events it is not wired on, and stdin it cannot read")
    st8 = fresh_state()
    grade("an event with no meaning here rows `nothing`, not `reset`",
          st8, payload("UserPromptSubmit"), "nothing", 0, False)
    for label, raw in _harness.MALFORMED_STDIN:
        want = "nothing" if label == "empty-object" else "bad-stdin"
        grade(f"malformed({label}) rows `{want}`", st8, raw, want, 0, False)
    grade("a payload with no session_id lands in the nosession bucket, exit 0",
          st8, json.dumps({"hook_event_name": "PostToolUseFailure", "tool_name": "Bash"}).encode(),
          "count", 1, False)
    check("nosession bucket is its own file", (st8 / "nosession--main.json").is_file(),
          str(list(st8.iterdir())))

    print("\n## The row's event field separates the three wirings")
    st9 = fresh_state()
    for event, verdict in (("SessionStart", "reset"), ("PostToolUse", "reset"),
                           ("PostToolUseFailure", "count")):
        _, rows = drive(st9, payload(event))
        check(f"row: {event} names itself",
              len(rows) == 1 and rows[0].get("event") == event
              and rows[0].get("verdict") == verdict, str(rows))

    print("\n## An unwritable log dir never changes the escalation")
    st10 = fresh_state()
    for _ in range(WARN_THRESHOLD):
        run = _harness.run_hook(HOOK, payload("PostToolUseFailure"),
                                env=dict(ROWLOG.env(CIRCUIT_BREAKER_STATE=str(st10)),
                                         STOP_GATE_LOG_DIR="/dev/null/nope"))
    check("unwritable log: the warn still lands, still exit 0",
          run.proc.returncode == 0
          and "in a row" in _harness.spoken(run, "circuit-breaker"),
          f"rc={run.proc.returncode} out={run.proc.stdout!r}")

    for d in STATE_DIRS:
        shutil.rmtree(d, ignore_errors=True)
    ROWLOG.cleanup()
    finish("All circuit-breaker checks passed.")


if __name__ == "__main__":
    main()
