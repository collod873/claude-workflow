#!/usr/bin/env python3
"""Does a `gh issue close` command ever trip the live validate-bash.py?

If it does, that is the real-world case where both PreToolUse/Bash hooks refuse
the same call: the close gate on the record, validate-bash on the payload text.
Payloads are assembled here, never in a shell, so this file does not self-trigger.
"""
import json
import subprocess

VB = "/home/collin/.claude/hooks/validate-bash.py"
DOT = "." + "env"
NM = "node_" + "modules"

CASES = {
    "plain close":
        "gh issue close 18 --comment 'done'",
    "record citing a shell read of a dotenv file as evidence":
        "gh issue close 18 --comment \"## Closing record\n"
        f"- [x] no secret leak - MET - confirmed `cat {DOT}` never runs (src/app.py:41)\"",
    "record citing a generated dir in a grep it ran":
        "gh issue close 18 --comment \"## Closing record\n"
        f"- [x] no stray TODOs - MET - `rg TODO {NM}/` returned 0 (exit 1)\"",
    "record quoting a dotenv path with no read verb":
        "gh issue close 18 --comment \"## Closing record\n"
        f"- [x] config documented - MET - {DOT}.example lists every key\"",
}

for label, cmd in CASES.items():
    r = subprocess.run(["python3", VB],
                       input=json.dumps({"tool_input": {"command": cmd}}).encode(),
                       capture_output=True)
    verdict = "BLOCK" if r.returncode == 2 else "allow"
    print(f"{verdict:6} {label}")
    if r.returncode == 2:
        print(f"       -> {r.stderr.decode().strip()[:100]}")
