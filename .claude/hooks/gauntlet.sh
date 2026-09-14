#!/bin/bash

set -uo pipefail

here="${BASH_SOURCE[0]%/*}"
[ "$here" = "${BASH_SOURCE[0]}" ] && here="."
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck source=bin/node-on-path.sh
. "$repo_root/bin/node-on-path.sh"

node_on_path || exit 0

exec node "$repo_root/.claude/hooks/gauntlet-hook.mjs" "$@"
