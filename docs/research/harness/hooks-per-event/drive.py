#!/usr/bin/env python3
"""Drive headless Claude Code sessions with N registered PreToolUse/Bash hooks.

Answers: what does the harness do when two matching hooks both refuse, when a
JSON deny races an exit-2, and what a second hook costs on the hot path.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
HOOK = ROOT / "stub_hook.py"
WORK = ROOT / "work"
LOG = ROOT / "hooktest.log"

PROMPT = ("Use the Bash tool to run exactly this command: echo HOOKTEST_MARKER\n"
          "Do not run anything else. Then reply with one word: DONE")

# The non-blocking arm needs a tool whose hook fires before an edit, not before a
# command, so it gets its own matcher, permissions and prompt.
# Asks for the injected text back rather than for obedience: an instruction that
# competes with the user's own is a priority question, not a delivery one.
EDIT_PROMPT = ("Use the Write tool to create a file named notes.txt containing "
               "exactly the word hello. Do not use any other tool. Then reply "
               "with DONE, followed by every hook or system-reminder message "
               "you received about that Write, quoted verbatim, one per line. "
               "If you received none, write NONE.")

# PostToolUse's message arrives after the tool_result, with no discrete stream
# event of its own (confirmed below: it shows up only inside the model's own
# thinking/reply, never as a separate "user" turn). Relying on the model to
# volunteer it in an unprompted DONE, the way the Bash arm's PROMPT does,
# undercounts: a spot check found delivery the same byte-identical config
# reported none of on a later run, purely because nothing asked for it. Ask
# explicitly, the way EDIT_PROMPT does for `ctx`.
POST_PROMPT = ("Use the Bash tool to run exactly this command: echo HOOKTEST_MARKER\n"
               "Do not run anything else. Then reply with DONE, followed by "
               "every hook or system-reminder message you received about that "
               "Bash call, quoted verbatim, one per line. If you received "
               "none, write NONE.")

BASH_ARM = {"matcher": "Bash", "allow": ["Bash(echo:*)"], "prompt": PROMPT}
EDIT_ARM = {"matcher": "Edit|Write", "allow": ["Write", "Edit"],
            "prompt": EDIT_PROMPT}
# PostToolUse fires after the command already ran, so it reuses the Bash arm's
# permissions; the only things that change are which event the stub is
# registered on and the prompt (see POST_PROMPT above). #26: does ADR-0012's
# PreToolUse-only rule transfer to Post, which refuses through top-level
# `decision`/`reason` instead of `permissionDecision`?
POST_ARM = {"event": "PostToolUse", "matcher": "Bash",
            "allow": ["Bash(echo:*)"], "prompt": POST_PROMPT}


# Timeout arm: the stub sleeps past the hook's own `timeout`. Does the harness
# treat a timed-out refusal as a refusal (fail closed) or as a non-blocking
# error (fail open)? Same Bash echo, hook timeout cut to 2 s.
TIMEOUT_ARM = dict(BASH_ARM, timeout=2)

# Subagent arm: the main agent runs no Bash itself; a subagent runs the echo.
# Which hooks fire for the subagent's work, and does the payload carry
# `agent_type` so a hook can tell whose work it is?
SUB_PROMPT = ("Use the Agent tool (subagent_type general-purpose) to launch one "
              "subagent with exactly this prompt: 'Use the Bash tool to run exactly "
              "this command: echo HOOKTEST_MARKER . Do not run anything else. Then "
              "reply with one word: DONE'. Do not use the Bash tool yourself. When "
              "the subagent returns, reply with one word: DONE")
SUB_PRE_ARM = {"matcher": "Bash", "allow": ["Bash(echo:*)", "Agent"],
               "prompt": SUB_PROMPT}
SUB_STOP_ARM = {"events": ["Stop", "SubagentStop"], "matcher": "",
                "allow": ["Bash(echo:*)", "Agent"], "prompt": SUB_PROMPT}


# Stop arm: the main agent's turn ends and a stub refuses the Stop once, in the
# JSON form (`decision: "block"` + `reason` + `systemMessage`, exit 0) or the
# exit-2 form (stderr). ADR-0016 measured `decision: "block"` on PostToolUse only;
# stop-gate.py refuses on exit 2 and so has no human channel on its first block.
# Does the JSON form force a continue on Stop at all, and if so which channels
# survive? A second Stop fire in the log is the "forced continue" reading.
STOP_PROMPT = ("Reply with exactly one word: DONE. Do not use any tool. If you are "
               "told to continue, reply with the exact message you received, quoted "
               "verbatim, on one line.")
STOP_ARM = {"event": "Stop", "matcher": "", "allow": [], "prompt": STOP_PROMPT}


def settings(specs, arm):
    """specs: list of (name, behaviour, sleep)."""
    events = arm.get("events") or [arm.get("event", "PreToolUse")]
    return {
        "permissions": {"allow": arm["allow"], "deny": [], "ask": []},
        "hooks": {
            event: [
                {"matcher": arm["matcher"],
                 "hooks": [{"type": "command",
                            "command": f"python3 {HOOK} {n} {b} {s}",
                            "timeout": arm.get("timeout", 20)}]}
                for (n, b, s) in specs
            ]
            for event in events
        },
    }


def run(label, specs, arm=BASH_ARM, timeout=180):
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    if LOG.exists():
        LOG.unlink()
    sfile = ROOT / "settings.json"
    sfile.write_text(json.dumps(settings(specs, arm), indent=2))

    env = dict(os.environ, HOOKTEST_LOG=str(LOG))
    cmd = ["claude", "-p", arm["prompt"],
           "--settings", str(sfile),
           "--setting-sources", "",
           "--model", "claude-haiku-4-5-20251001",
           "--output-format", "stream-json", "--verbose",
           "--no-session-persistence"]
    if os.environ.get("HOOKTEST_NO_HOOK_EVENTS") != "1":
        cmd.insert(-1, "--include-hook-events")
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=WORK, env=env, capture_output=True,
                          text=True, timeout=timeout)
    wall = time.perf_counter() - t0

    events = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    rows = []
    if LOG.exists():
        for ln in LOG.read_text().splitlines():
            p = ln.split("\t")
            if len(p) >= 3:
                rows.append((p[0], float(p[1]), float(p[2]), *p[3:]))

    (ROOT / f"raw-{label}.jsonl").write_text(proc.stdout)
    return {"label": label, "specs": specs, "arm": arm["matcher"], "wall": wall,
            "rc": proc.returncode, "events": events, "rows": rows,
            "stderr": proc.stderr[-2000:]}


def summarise(r):
    print(f"\n{'='*78}\n## {r['label']}   hooks={[(n,b,s) for n,b,s in r['specs']]}")
    print(f"   wall={r['wall']:.2f}s  rc={r['rc']}")

    fired = [e for e in r["events"] if e.get("type") == "hook_event"
             or "hook" in json.dumps(e)[:200].lower()]
    # tool calls actually issued / results
    ran_marker = "notes.txt" if r.get("arm") == "Edit|Write" else "HOOKTEST_MARKER"
    marker_ran = False
    tool_results = []
    for e in r["events"]:
        if e.get("type") == "user":
            for c in e.get("message", {}).get("content", []) or []:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    txt = json.dumps(c.get("content"))
                    tool_results.append(txt[:400])
                    if ran_marker in txt and not c.get("is_error"):
                        marker_ran = True
    print(f"   command actually executed: {marker_ran}")

    if r["rows"]:
        base = min(row[1] for row in r["rows"])
        print("   hook invocations (t relative to first start, seconds):")
        for row in sorted(r["rows"], key=lambda x: x[1]):
            n, s, e = row[:3]
            extra = "  ".join(f"{x!r}" for x in row[3:])
            print(f"     {n:<8} start=+{s-base:6.3f}  end=+{e-base:6.3f}  {extra}")
        overlap = any(a[1] < b[2] and b[1] < a[2]
                      for i, a in enumerate(r["rows"]) for b in r["rows"][i+1:])
        if len(r["rows"]) > 1:
            print(f"   intervals overlap (parallel): {overlap}")
    else:
        print("   NO hook invocations logged")

    for tr in tool_results:
        print(f"   tool_result: {tr}")

    blob = json.dumps(r["events"])
    for token in ["REASON_A", "REASON_B", "SYSMSG_A", "SYSMSG_B",
                  "STDERR_A", "STDERR_B", "CTXMARK_A", "CTXMARK_B",
                  "OBEYED_A", "OBEYED_B"]:
        if token in blob:
            print(f"   surfaced in stream: {token}")

    final = [e for e in r["events"] if e.get("type") == "result"]
    if final:
        print(f"   final result text: {str(final[-1].get('result'))[:300]!r}")


SCENARIOS = {
    "1-control-single-pass":   [("A", "pass", 0)],
    "2-single-deny":           [("A", "deny", 0)],
    "3-two-denies":            [("A", "deny", 0), ("B", "deny", 0)],
    "4-deny-races-exit2":      [("A", "deny", 0), ("B", "exit2", 0)],
    "4b-exit2-races-deny":     [("A", "exit2", 0), ("B", "deny", 0)],
    "3b-two-denies-A-slow":    [("A", "deny", 3), ("B", "deny", 0)],
    "3c-two-denies-B-slow":    [("A", "deny", 0), ("B", "deny", 3)],
    "5-two-exit2":             [("A", "exit2", 0), ("B", "exit2", 0)],
    "6-allow-races-deny":      [("A", "allow", 0), ("B", "deny", 0)],
    "6b-deny-races-allow":     [("A", "deny", 0), ("B", "allow", 0)],
    "6c-allow-races-exit2":    [("A", "allow", 0), ("B", "exit2", 0)],
    "7-parallel-proof":        [("A", "pass", 2), ("B", "pass", 2)],
    "8-cost-one-hook":         [("A", "pass", 0)],
    "9-cost-two-hooks":        [("A", "pass", 0), ("B", "pass", 0)],
    # Non-blocking arm: does additionalContext reach Claude at all, and does it
    # survive a second hook on the same event?
    "10-ctx-single":           [("A", "ctx", 0)],
    "11-ctx-beside-silent":    [("A", "ctx", 0), ("B", "pass", 0)],
    "12-two-ctx":              [("A", "ctx", 0), ("B", "ctx", 0)],
    # PostToolUse arm (#26): does ADR-0012's rule transfer to the event that
    # refuses through `decision`/`reason` instead of `permissionDecision`, and
    # can a Post hook's "block" ever stop the tool that already ran?
    "P1-control-single-pass": [("A", "pass", 0)],
    "P2-single-block":        [("A", "block", 0)],
    "P3-two-blocks":          [("A", "block", 0), ("B", "block", 0)],
    "P4-block-races-exit2":   [("A", "block", 0), ("B", "exit2", 0)],
    "P4b-exit2-races-block":  [("A", "exit2", 0), ("B", "block", 0)],
    "P5-two-exit2":           [("A", "exit2", 0), ("B", "exit2", 0)],
    # Mirrors the live pair in the standing inventory: a hook that speaks
    # (post-edit-validate.py's additionalContext) beside one that, on plain
    # success, never emits anything at all (circuit-breaker.py).
    "P6-block-beside-silent": [("A", "block", 0), ("B", "pass", 0)],
    # Timeout arm: a refusing hook that outlives its `timeout`. Fail open or
    # fail closed? Both refusal shapes.
    "T1-deny-timeout":        [("A", "deny", 5)],
    "T2-exit2-timeout":       [("A", "exit2", 5)],
    # Subagent arm: a passing stub, logging event + agent_type per fire.
    "S1-sub-pretooluse":      [("A", "pass", 0)],
    "S2-sub-stop":            [("A", "pass", 0)],
    # Stop arm: one refusal each way, guarded on `stop_hook_active`.
    "ST1-stop-block-json":    [("A", "stopblock", 0)],
    "ST2-stop-exit2":         [("A", "stopexit2", 0)],
    # #204: does a hand-back that carries `additionalContext` end the turn, or continue
    # it under the block cap? Two fires is a continuation; one is the turn ending.
    "ST3-stop-handback-ctx":  [("A", "stopctx", 0)],
    "ST4-stop-handback-sys":  [("A", "stopsys", 0)],
}

# Scenarios not listed here run on PreToolUse/Bash.
ARMS = {"10-ctx-single": EDIT_ARM, "11-ctx-beside-silent": EDIT_ARM,
        "12-two-ctx": EDIT_ARM,
        "P1-control-single-pass": POST_ARM, "P2-single-block": POST_ARM,
        "P3-two-blocks": POST_ARM, "P4-block-races-exit2": POST_ARM,
        "P4b-exit2-races-block": POST_ARM, "P5-two-exit2": POST_ARM,
        "P6-block-beside-silent": POST_ARM,
        "T1-deny-timeout": TIMEOUT_ARM, "T2-exit2-timeout": TIMEOUT_ARM,
        "S1-sub-pretooluse": SUB_PRE_ARM, "S2-sub-stop": SUB_STOP_ARM,
        "ST1-stop-block-json": STOP_ARM, "ST2-stop-exit2": STOP_ARM,
        "ST3-stop-handback-ctx": STOP_ARM, "ST4-stop-handback-sys": STOP_ARM}

if __name__ == "__main__":
    want = sys.argv[1:] or list(SCENARIOS)
    out = []
    for name in want:
        r = run(name, SCENARIOS[name], ARMS.get(name, BASH_ARM))
        summarise(r)
        out.append({k: v for k, v in r.items() if k != "events"})
    (ROOT / "results.json").write_text(json.dumps(out, indent=2, default=str))
