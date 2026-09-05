# shellcheck shell=bash
# The run-row writer for a hook written in bash: the same row `_hook.py`'s `run_row()` +
# `append_log()` write, spelled once per language (#210). Source it as the hook's first
# line; call `hook_run_row <verdict> [key=value ...]` on every exit path.
#
#   . "$(dirname "${BASH_SOURCE[0]}")/lib/_hook.sh"      # a consuming repo's copy
#   . "$HOME/.claude/hooks/_hook.sh"                       # this machine's symlink
#   ...
#   hook_run_row allow slug=x chars=12
#
# A thin shim, on purpose: it parses no JSON of its own. The payload goes to `_hook.mjs`
# beside this file, which reads it the one way every JS hook does, so a field's spelling
# (`hook_event_name`, `tool_use_id`) lives in one place and a bash hook building a row
# by hand (Workflow's old `hook_lib_run_row`, its own quote-escaping included) is the
# private copy this replaces. A bash hook lives beside Node hooks everywhere one exists
# on this machine, so Node is the toolchain it can count on; where `node` is not on
# PATH there is no row, and nothing else changes: a verdict never depends on its own
# observability (ADR-0005).
#
# Sourcing reads stdin into `HOOK_PAYLOAD`, because a row needs the payload and stdin
# can be read once. A hook that forwards the payload to a child pipes `$HOOK_PAYLOAD`
# to it; a hook that already read stdin sets `HOOK_PAYLOAD` before sourcing and nothing
# is read here. `HOOK_NAME` defaults to the sourcing script's own stem (`$0`, the way
# `_hook.py` reads `__main__`), `HOOK_STARTED_MS` to the moment of sourcing, so
# `seconds` measures the hook and not the shim; both may be set beforehand.
#
# `key=value` extras are typed as JSON literals where they parse (`chars=12` is a
# number) and as strings where they do not, the same fields a Python hook passes as
# keyword arguments. A consuming repo carries a byte-identical copy at
# `.claude/hooks/lib/_hook.sh`; `bin/re-seed` reports when it drifts.

_HOOK_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
# Epoch milliseconds from bash's own clock: `date +%s%3N` is GNU-only and a uutils `date`
# prints nanoseconds for it, which read as a start 50,000 years in the future.
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
export HOOK_PAYLOAD HOOK_NAME HOOK_STARTED_MS

hook_run_row() {
  local verdict="${1:-}"
  shift 2>/dev/null || true
  command -v node >/dev/null 2>&1 || return 0
  printf '%s' "$HOOK_PAYLOAD" | node "$_HOOK_SH_DIR/_hook.mjs" \
    --hook "$HOOK_NAME" --started "$HOOK_STARTED_MS" "$verdict" "$@" >/dev/null 2>&1 || true
  return 0
}
