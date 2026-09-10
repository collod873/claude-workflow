#!/usr/bin/env python3
"""Marginal cost of the Nth hook on one event.

Spawns N hooks the way the harness does, concurrently and one process each, and
reports the wall time of the whole batch. The question is not what one hook
costs but what the *second* one adds, so only the deltas matter.
"""
import json
import statistics
import subprocess
import time
from pathlib import Path

STUB = Path(__file__).parent / "stub_hook.py"
LIVE = Path.home() / ".claude" / "hooks" / "validate-bash.py"

PAYLOAD = json.dumps({
    "session_id": "bench",
    "hook_event_name": "PreToolUse",
    "tool_name": "Bash",
    "tool_input": {"command": "git status"},
}).encode()


def batch(cmds, runs=40):
    """Wall time, in ms, of spawning every cmd at once and awaiting all."""
    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        procs = [subprocess.Popen(c, stdin=subprocess.PIPE,
                                  stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL) for c in cmds]
        for p in procs:
            p.stdin.write(PAYLOAD)
            p.stdin.close()
        for p in procs:
            p.wait()
        times.append((time.perf_counter() - t0) * 1000)
    return sorted(times)


def main():
    stub = ["python3", str(STUB), "X", "pass", "0"]
    arms = [
        ("1 hook", [["python3", str(LIVE)]]),
        ("2 hooks", [["python3", str(LIVE)], stub]),
        ("3 hooks", [["python3", str(LIVE)], stub, stub]),
    ]
    medians = []
    for label, cmds in arms:
        ts = batch(cmds)
        med = statistics.median(ts)
        medians.append(med)
        print(f"{label:10} min={ts[0]:6.1f}ms median={med:6.1f}ms "
              f"p90={ts[int(.9 * len(ts))]:6.1f}ms max={ts[-1]:6.1f}ms")
    for i in range(1, len(medians)):
        print(f"marginal cost of hook #{i + 1}: {medians[i] - medians[i - 1]:+.1f} ms")
    print("cores:", subprocess.run(["nproc"], capture_output=True,
                                   text=True).stdout.strip())


if __name__ == "__main__":
    main()
