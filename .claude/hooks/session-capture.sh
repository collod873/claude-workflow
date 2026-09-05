#!/bin/bash
set -uo pipefail

here="${BASH_SOURCE[0]%/*}"
[ "$here" = "${BASH_SOURCE[0]}" ] && here="."
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck source=bin/node-on-path.sh
. "$repo_root/bin/node-on-path.sh"
# shellcheck source=.claude/hooks/lib/_hook.sh
. "$repo_root/.claude/hooks/lib/_hook.sh"

run_row() {
  hook_lib_append_log session-capture "$(hook_lib_run_row session-capture SessionEnd "${session:-unknown}" "${project:-unknown}" "$1")"
}

node_on_path && have_node=1 || have_node=0

INPUT="$(cat 2>/dev/null || true)"

if [ "$have_node" -eq 0 ]; then
  run_row "skipped-no-node"
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
  run_row "skipped-no-transcript-path"
  exit 0
fi

if [ ! -f "$transcript" ]; then
  run_row "skipped-transcript-missing"
  exit 0
fi

run_row "dispatched"

(
  node "$repo_root/.claude/hooks/session-capture-hook.mjs" "$transcript" "${session:-unknown}" "${project:-unknown}" "${source:-other}"
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
