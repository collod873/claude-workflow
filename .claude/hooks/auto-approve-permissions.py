#!/usr/bin/env python3
import json
import sys

import _hook

INTERACTIVE_TOOLS = {
    "AskUserQuestion",
    "ExitPlanMode",
    "mcp__claude_ai_Gmail__complete_authentication",
    "mcp__claude_ai_Google_Calendar__complete_authentication",
    "mcp__plugin_figma_figma__complete_authentication",
}

data, ok = _hook.read_payload()
tool_name = data.get("tool_name", "") if ok else ""
if not ok:
    verdict = "bad-stdin"
elif tool_name in INTERACTIVE_TOOLS:
    verdict = "passthrough"
else:
    verdict = "allow"

_hook.append_log(_hook.HOOK_NAME, _hook.run_row(data, verdict, tool=tool_name))

if verdict != "allow":
    sys.exit(0)

json.dump({
    "hookSpecificOutput": {
        "hookEventName": "PermissionRequest",
        "decision": {"behavior": "allow"}
    }
}, sys.stdout)
