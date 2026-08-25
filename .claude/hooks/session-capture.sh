#!/bin/bash
# session-capture.sh — SessionEnd hook (#44; part of #36's spec). Captures the session's
# conversation spine to durable storage: no model call, no judgement, storage only. It is the
# only step with an irreversible clock on it (#36 §Solution "1 · Capture") — a day it doesn't
# run is a day of corpus permanently gone — so it must be fast, detached, and fail open at every
# step. It is not registered anywhere by this ticket; wiring it into a real
# `~/.claude/settings.json` is a separate, owner-run step, never something a test or a worker
# does to the real machine config.
#
# Meant to be registered with matcher "clear|logout|other" — deliberately NOT
# "prompt_input_exit": an interrupted or aborted prompt is not a session that ended. Inherited
# unchanged from crewops' capture-decisions.sh and Lumaria's decision-capture.sh; see #36
# §Solution for why it isn't re-derived here. This script does not itself re-check `reason` —
# the matcher is what keeps `prompt_input_exit` from ever reaching it in production.
#
# Mechanics: read stdin SYNCHRONOUSLY (this hook must not block SessionEnd), then hand the
# transcript path plus session/project/source off to session-capture-hook.mjs in a FULLY
# DETACHED background subshell (stdio redirected off this script's fds, disowned) so this script
# returns instantly. Two failure modes are cheap enough to check synchronously, and are checked
# here rather than in the detached child, so their log line is guaranteed to exist by the time
# this script returns rather than racing a caller that reads the log right after: no transcript
# path in the payload, and no `node` on PATH. Everything past that — a transcript that vanishes
# between this check and the child's read, an output directory that can't be written — is the
# detached child's problem; see its own header.
#
# Failure mode: FAIL OPEN, silently, at every step. Never a non-zero exit, never stdout/stderr
# noise — a hook that wedges SessionEnd is worse than the corpus it exists to protect.
set -uo pipefail

# Builtins only — `dirname` is a PATH lookup, and PATH is the thing we do not have yet.
here="${BASH_SOURCE[0]%/*}"
[ "$here" = "${BASH_SOURCE[0]}" ] && here="."
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck source=bin/node-on-path.sh
. "$repo_root/bin/node-on-path.sh"

log_path="${SESSION_CAPTURE_LOG_PATH:-$HOME/.claude/session-capture.log}"

# Same one-line-per-run shape as the node half writes (session-capture-hook.mjs's `log`) — two
# halves of one hook, one timeline, so both format the timestamp the same way: UTC,
# `YYYY-MM-DDTHH:MM:SSZ`.
log_outcome() {
  {
    mkdir -p "$(dirname "$log_path")" &&
      printf '%s\t%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >>"$log_path"
  } 2>/dev/null || true
}

INPUT="$(cat 2>/dev/null || true)"

# node_on_path fixes PATH for date/mkdir/dirname unconditionally, even on the branch where it
# can't find node — see its own header — so log_outcome above already works either way.
if ! node_on_path; then
  log_outcome "skipped no-node"
  exit 0
fi

# A quick, throwaway node parse rather than a hand-rolled grep/sed over the payload: the hook
# JSON's field order and quoting are not this script's contract to reimplement. Fields are joined
# on \x1f (unit separator), not a tab: `read`'s IFS-whitespace splitting collapses a *leading*
# empty field when the delimiter is tab (or any IFS-whitespace char) even with IFS set to just
# that character, which silently turned an absent transcript_path into the session_id.
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
