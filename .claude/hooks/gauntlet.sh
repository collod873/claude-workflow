#!/bin/bash
# Thin shim: put node on PATH, then hand the hook payload to gauntlet-hook.mjs.
#
# The interpreter is absolute rather than `/usr/bin/env bash` on purpose. `env` resolves `bash`
# through PATH, so the portable shebang is the one thing here that cannot survive the broken PATH
# this script exists to survive — it exits 127 before a line of it runs.
#
# It exists only because settings.json cannot resolve an interpreter and a hook shell does not
# inherit a login PATH. It never decides anything, and it exits 0 on every path it owns — a shim
# that can fail is a hook that can wedge a session.

set -uo pipefail

# Builtins only — `dirname` is a PATH lookup, and PATH is the thing we do not have yet.
here="${BASH_SOURCE[0]%/*}"
[ "$here" = "${BASH_SOURCE[0]}" ] && here="."
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck source=bin/node-on-path.sh
. "$repo_root/bin/node-on-path.sh"

node_on_path || exit 0

exec node "$repo_root/.claude/hooks/gauntlet-hook.mjs" "$@"
