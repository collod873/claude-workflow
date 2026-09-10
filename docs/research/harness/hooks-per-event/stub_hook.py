#!/usr/bin/env python3
"""Instrumented stub hook, PreToolUse, PostToolUse and Stop.

argv: <name> <behaviour> [sleep_seconds]
behaviour: deny | allow | exit2 | pass | ask | ctx | block | stopblock | stopexit2
           | stopctx | stopsys

`ctx` is the non-blocking arm: exit 0, no permissionDecision, guidance carried
on `hookSpecificOutput.additionalContext` plus a `systemMessage`. It plants two
independent signals (a quotable tag and an instruction whose obedience is
observable in the final reply) so "did Claude actually see it" does not rest on
the model choosing to quote.

`block` is PostToolUse's refusal shape: top-level `decision: "block"` + `reason`
(REFERENCE.md:78) rather than PreToolUse's `hookSpecificOutput.permissionDecision`.
Carries a `systemMessage` too, so the same run answers whether ADR-0012's rule
transfers: does `reason` race like `permissionDecisionReason` did, and does
`systemMessage` still land per-hook.

Appends one TSV row per invocation to $HOOKTEST_LOG:
    name  start_epoch  end_epoch  command
so overlap between concurrently-registered hooks is measurable.
"""
import json
import os
import sys
import time

name = sys.argv[1]
behaviour = sys.argv[2]
nap = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

start = time.time()
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
command = data.get("tool_input", {}).get("command", "") or \
    data.get("tool_input", {}).get("file_path", "")
event = data.get("hook_event_name", "PreToolUse")

if nap:
    time.sleep(nap)

end = time.time()
log = os.environ.get("HOOKTEST_LOG")
if log:
    # Columns 5-6 (event as the harness named it, agent_type) answer the
    # subagent-scope question: which events fire for a subagent's work, and
    # whether the payload says whose work it is.
    with open(log, "a") as fh:
        fh.write(f"{name}\t{start:.6f}\t{end:.6f}\t{command}\t"
                 f"{data.get('hook_event_name', '?')}\t{data.get('agent_type', '')}\n")

if behaviour == "ctx":
    print(json.dumps({
        "systemMessage": f"SYSMSG_{name}",
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": (
                f"CTXMARK_{name}: injected by {name} without blocking. "
                f"End your final reply with the exact word OBEYED_{name}."
            ),
        },
    }))
    sys.exit(0)

if behaviour == "exit2":
    print(f"STDERR_{name}: refused by {name}", file=sys.stderr)
    sys.exit(2)

if behaviour == "block":
    print(json.dumps({
        "systemMessage": f"SYSMSG_{name}",
        "decision": "block",
        "reason": f"REASON_{name}: block from {name}",
    }))
    sys.exit(0)

# Stop-arm refusals: the same two shapes, refusing exactly once. `stop_hook_active`
# is the harness saying this Stop is already the forced continuation of a previous
# block, so a stub that ignored it would refuse every turn-end until the 8-block
# force-release, eight Haiku turns to learn what one answers. Refuse on the
# first Stop, pass on the second; the second fire's existence is the measurement.
if behaviour in ("stopblock", "stopexit2"):
    if data.get("stop_hook_active"):
        sys.exit(0)
    if behaviour == "stopexit2":
        print(f"STDERR_{name}: stop refused by {name}", file=sys.stderr)
        sys.exit(2)
    print(json.dumps({
        "systemMessage": f"SYSMSG_{name}",
        "decision": "block",
        "reason": f"REASON_{name}: stop refused by {name}. Reply with one word: RESUMED",
    }))
    sys.exit(0)

# Stop-arm hand-backs (#204): the two shapes a Stop hook that means to let the turn *end*
# might use. `stopctx` is what stop-gate.py's hand-back was: `systemMessage` plus
# `hookSpecificOutput.additionalContext`, no `decision`. `stopsys` is `systemMessage`
# alone. Each speaks once and passes on `stop_hook_active`, so a second Stop fire in the
# log means the harness continued the turn on that shape; one fire means it ended.
if behaviour in ("stopctx", "stopsys"):
    if data.get("stop_hook_active"):
        sys.exit(0)
    doc = {"systemMessage": f"SYSMSG_{name}"}
    if behaviour == "stopctx":
        doc["hookSpecificOutput"] = {
            "hookEventName": "Stop",
            "additionalContext": (f"CTXMARK_{name}: hand-back from {name}. "
                                  f"Reply with one word: RESUMED"),
        }
    print(json.dumps(doc))
    sys.exit(0)

if behaviour in ("deny", "allow", "ask"):
    print(json.dumps({
        "systemMessage": f"SYSMSG_{name}",
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": behaviour,
            "permissionDecisionReason": f"REASON_{name}: {behaviour} from {name}",
        },
    }))
    sys.exit(0)

sys.exit(0)
