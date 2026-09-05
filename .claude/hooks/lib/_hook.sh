hook_lib_log_dir() {
  printf '%s' "${STOP_GATE_LOG_DIR:-$HOME/.claude/logs}"
}

hook_lib_local_ts() {
  date '+%Y-%m-%dT%H:%M:%S'
}

hook_lib_json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

hook_lib_run_row() {
  local hook="$1" event="$2" session_id="$3" project="$4" verdict="$5"
  printf '{"hook":"%s","event":"%s","session_id":"%s","project":"%s","verdict":"%s","ts":"%s"}' \
    "$(hook_lib_json_escape "$hook")" \
    "$(hook_lib_json_escape "$event")" \
    "$(hook_lib_json_escape "$session_id")" \
    "$(hook_lib_json_escape "$project")" \
    "$(hook_lib_json_escape "$verdict")" \
    "$(hook_lib_local_ts)"
}

hook_lib_append_log() {
  local hook="$1" row="$2"
  local dir
  dir="$(hook_lib_log_dir)"
  {
    mkdir -p "$dir" &&
      printf '%s\n' "$row" >>"$dir/${hook}-$(date '+%Y-%m-%d').jsonl"
  } 2>/dev/null || true
}
