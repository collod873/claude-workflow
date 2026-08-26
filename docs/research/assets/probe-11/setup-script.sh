#!/bin/bash
# claude-workflow#11 probe: does a cloud session read the ~/.claude/ that its own
# setup script wrote? Throwaway — this environment exists only for that experiment.
set -u
exec > >(tee -a /tmp/probe-setup.log) 2>&1
echo "### probe-setup begin"
date -u +%FT%TZ
echo "whoami=$(whoami) HOME=${HOME:-unset}"
id
echo "GH_TOKEN=${GH_TOKEN:-unset}"
echo "GITHUB_TOKEN=${GITHUB_TOKEN:-unset}"

# ---------------------------------------------------------------- A. the clone
# Is the private fleet repo reachable from a setup script at all? The GitHub
# proxy substitutes credentials on outbound GitHub requests, but no doc says
# whether that covers a raw `git clone` in the setup phase.
CLONE=failed
if git clone --depth 1 https://github.com/collod873/agent-skills /opt/agent-skills 2>/tmp/probe-clone.err; then
  CLONE=ok
  echo "CLONE=ok skill_dirs=$(find /opt/agent-skills -maxdepth 2 -name SKILL.md | wc -l)"
else
  echo "CLONE=failed"
  sed 's/^/CLONE_ERR: /' /tmp/probe-clone.err
fi

# --------------------------------------------------- B. probe assets, inline
# Written by heredoc, not taken from the clone, so the load-bearing question is
# answered even when A fails.
mkdir -p /opt/probe

cat > /opt/probe/pretooluse.py <<'PY'
#!/usr/bin/env python3
"""PreToolUse probe. Logs every Bash call, and denies one sentinel command so a
hook that fired and allowed is distinguishable from a hook that never ran."""
import json, sys, datetime

raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    d = {}
cmd = (d.get("tool_input") or {}).get("command", "")
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
with open("/tmp/probe-hook.log", "a") as f:
    f.write("%s PreToolUse tool=%s cmd=%s\n" % (stamp, d.get("tool_name"), cmd[:200]))

if "PROBE_SENTINEL_BLOCK_ME" in cmd:
    sys.stderr.write("BLOCKED_BY_PROBE_HOOK: the setup-script-installed "
                     "PreToolUse hook is live and denied this command.\n")
    sys.exit(2)
sys.exit(0)
PY

cat > /opt/probe/sessionstart.py <<'PY'
#!/usr/bin/env python3
import sys, datetime
sys.stdin.read()
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
with open("/tmp/probe-sessionstart.log", "a") as f:
    f.write("%s SessionStart hook fired from user settings\n" % stamp)
sys.exit(0)
PY

chmod +x /opt/probe/pretooluse.py /opt/probe/sessionstart.py

mkdir -p /opt/probe/skills/probe-clean /opt/probe/skills/probe-flagged

cat > /opt/probe/skills/probe-clean/SKILL.md <<'MD'
---
name: probe-clean
description: Spec-clean probe skill. Use when asked to run the clean skill probe.
---

Reply with exactly this line and nothing else:

PROBE_CLEAN_SKILL_LOADED
MD

cat > /opt/probe/skills/probe-flagged/SKILL.md <<'MD'
---
name: probe-flagged
description: Probe skill carrying the flag every pipeline verb carries. Use when asked to run the flagged skill probe.
disable-model-invocation: true
---

Reply with exactly this line and nothing else:

PROBE_FLAGGED_SKILL_LOADED
MD

# Real fleet skills, if the clone landed: one spec-clean, one flagged.
if [ "$CLONE" = ok ]; then
  for s in grilling wait-what; do
    [ -f "/opt/agent-skills/$s/SKILL.md" ] && cp -r "/opt/agent-skills/$s" /opt/probe/skills/ || true
  done
fi

cat > /opt/probe/settings-fragment.json <<'JSON'
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "/opt/probe/sessionstart.py" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "/opt/probe/pretooluse.py" } ] }
    ]
  }
}
JSON

# ------------------------------------------ C. install into every plausible HOME
# The script runs as root, so ~ is /root. Claude Code may run as someone else.
HOMES="/root"
for d in /home/*; do [ -d "$d" ] && HOMES="$HOMES $d"; done
echo "HOMES=$HOMES"

: > /tmp/probe-manifest.txt
for h in $HOMES; do
  mkdir -p "$h/.claude/skills"
  cp -r /opt/probe/skills/. "$h/.claude/skills/"

  if [ -f "$h/.claude/settings.json" ]; then
    cp "$h/.claude/settings.json" "$h/.claude/settings.json.probe-backup"
    python3 - "$h/.claude/settings.json" /opt/probe/settings-fragment.json <<'PY'
import json, sys
tgt, frag = sys.argv[1], sys.argv[2]
a = json.load(open(tgt)); b = json.load(open(frag))
h = a.setdefault("hooks", {})
for ev, entries in b["hooks"].items():
    h.setdefault(ev, []).extend(entries)
json.dump(a, open(tgt, "w"), indent=2)
PY
    echo "MERGED $h/.claude/settings.json (backup alongside)" >> /tmp/probe-manifest.txt
  else
    cp /opt/probe/settings-fragment.json "$h/.claude/settings.json"
    echo "WROTE  $h/.claude/settings.json" >> /tmp/probe-manifest.txt
  fi

  owner=$(stat -c %U:%G "$h")
  chown -R "$owner" "$h/.claude" || true
  echo "WROTE  $h/.claude/skills/ -> $(ls -1 "$h/.claude/skills" | tr '\n' ' ')" >> /tmp/probe-manifest.txt
done

echo "CLONE=$CLONE" >> /tmp/probe-manifest.txt
echo "### probe-setup manifest"
cat /tmp/probe-manifest.txt
echo "### probe-setup end"
exit 0
