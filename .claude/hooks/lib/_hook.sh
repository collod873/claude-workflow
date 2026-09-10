# shellcheck shell=bash

_HOOK_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
for _hook_var in HOOK_PAYLOAD HOOK_NAME HOOK_STARTED_MS; do
  case "$(declare -p "$_hook_var" 2>/dev/null)" in
    "declare -x"*) unset "$_hook_var" ;;
  esac
done
unset _hook_var
if [ -z "${HOOK_STARTED_MS:-}" ]; then
  if [ -n "${EPOCHREALTIME:-}" ]; then
    HOOK_STARTED_MS="${EPOCHREALTIME/./}"
    HOOK_STARTED_MS="${HOOK_STARTED_MS%???}"
  else
    HOOK_STARTED_MS="$(( $(date +%s 2>/dev/null || echo 0) * 1000 ))"
  fi
fi
if [ -z "${HOOK_NAME:-}" ]; then
  HOOK_NAME="$(basename -- "$0")"
  HOOK_NAME="${HOOK_NAME%.*}"
fi
if [ -z "${HOOK_PAYLOAD+x}" ]; then
  if [ -t 0 ]; then
    HOOK_PAYLOAD=""
  else
    HOOK_PAYLOAD="$(cat 2>/dev/null || true)"
  fi
fi

hook_run_row() {
  local verdict="${1:-}"
  shift 2>/dev/null || true
  command -v node >/dev/null 2>&1 || return 0
  printf '%s' "$HOOK_PAYLOAD" | node "$_HOOK_SH_DIR/_hook.mjs" \
    --hook "$HOOK_NAME" --started "$HOOK_STARTED_MS" "$verdict" "$@" >/dev/null 2>&1 || true
  return 0
}
