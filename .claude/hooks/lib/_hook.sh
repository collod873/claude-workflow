_hook_dir="${BASH_SOURCE[0]%/*}"
[ "$_hook_dir" = "${BASH_SOURCE[0]}" ] && _hook_dir="."
HOOK_LIB_MJS="$(cd "$_hook_dir" && pwd)/_hook.mjs"
unset _hook_dir

IFS= read -r -d '' HOOK_PAYLOAD || true

hook_run_row_escaped() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

hook_run_row_without_node() {
  local hook="$1" verdict="$2"
  local event="" session_id=""
  [[ "$HOOK_PAYLOAD" =~ \"hook_event_name\":\"([^\"]*)\" ]] && event="${BASH_REMATCH[1]}"
  [[ "$HOOK_PAYLOAD" =~ \"session_id\":\"([^\"]*)\" ]] && session_id="${BASH_REMATCH[1]}"

  local dir="${STOP_GATE_LOG_DIR:-$HOME/.claude/logs}"
  {
    mkdir -p "$dir" &&
      printf '{"hook":"%s","event":"%s","session_id":"%s","verdict":"%s","ts":"%s"}\n' \
        "$(hook_run_row_escaped "$hook")" \
        "$(hook_run_row_escaped "$event")" \
        "$(hook_run_row_escaped "$session_id")" \
        "$(hook_run_row_escaped "$verdict")" \
        "$(date '+%Y-%m-%dT%H:%M:%S')" \
        >>"$dir/$hook-$(date '+%Y-%m-%d').jsonl"
  } 2>/dev/null || true
}

hook_run_row() {
  local verdict="$1"
  shift
  local hook="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
  hook="${hook##*/}"
  hook="${hook%.*}"

  if command -v node >/dev/null 2>&1; then
    HOOK_LIB_MJS="$HOOK_LIB_MJS" HOOK_PAYLOAD="$HOOK_PAYLOAD" HOOK_VERDICT="$verdict" HOOK_NAME="$hook" \
      node -e '
        import(process.env.HOOK_LIB_MJS).then(({ runRow, appendLog }) => {
          let payload = {};
          try { payload = JSON.parse(process.env.HOOK_PAYLOAD || "{}"); } catch {}
          const extra = { hook: process.env.HOOK_NAME };
          for (const kv of process.argv.slice(1)) {
            const i = kv.indexOf("=");
            if (i === -1) continue;
            extra[kv.slice(0, i)] = kv.slice(i + 1);
          }
          appendLog(runRow(payload, process.env.HOOK_VERDICT, extra));
        });
      ' "$@" 2>/dev/null && return 0
  fi

  hook_run_row_without_node "$hook" "$verdict"
}
