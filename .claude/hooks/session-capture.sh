#!/bin/bash
set -uo pipefail

here="${BASH_SOURCE[0]%/*}"
[ "$here" = "${BASH_SOURCE[0]}" ] && here="."
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck source=bin/node-on-path.sh
. "$repo_root/bin/node-on-path.sh"

log_path="${SESSION_CAPTURE_LOG_PATH:-$HOME/.claude/session-capture.log}"

log_outcome() {
  {
    mkdir -p "$(dirname "$log_path")" &&
      printf '%s\t%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >>"$log_path"
  } 2>/dev/null || true
}

node_on_path && have_node=1 || have_node=0

INPUT="$(cat 2>/dev/null || true)"

if [ "$have_node" -eq 0 ]; then
  log_outcome "skipped no-node"
  exit 0
fi

PARSED="$(
  printf '%s' "$INPUT" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      let j = {};
      try { j = JSON.parse(d); } catch { j = {}; }
      process.stdout.write(
        [j.transcript_path ?? "", j.session_id ?? "unknown", j.cwd ?? "", j.reason ?? "other"].join("\x1f"),
      );
    });
  ' 2>/dev/null || true
)"

IFS=$'\x1f' read -r transcript session project source <<<"$PARSED"

if [ -z "${transcript:-}" ]; then
  log_outcome "skipped no-transcript-path"
  exit 0
fi

if [ ! -f "$transcript" ]; then
  log_outcome "skipped transcript-missing"
  exit 0
fi

(
  node "$repo_root/.claude/hooks/session-capture-hook.mjs" "$transcript" "${session:-unknown}" "${project:-unknown}" "${source:-other}"
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
