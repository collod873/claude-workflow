# Put node on PATH, or say so. Sourced, never executed.
#
# Every venue below Actions runs in a shell nobody logged into — a Claude Code hook, a git hook —
# and those do not inherit a login PATH. On this machine node lives in ~/bin, so a check that
# works in a terminal can still be "command not found" here.
#
# That failure is kept distinct from a red check on purpose. DESIGN.md §06 makes a quarantined
# flake the precondition for every gate in this repo, and the reference case is a suite that
# failed for 14 of 26 runs on whether `jq` was on the runner's PATH. A gate that goes red for
# environment reasons is how a repo learns to ignore its gates.

# `NODE_ON_PATH_SEARCH_DIRS`, when set, REPLACES both lists below — it is the complete set of
# directories this function will consider, and the only seam a test has for making "node is
# genuinely absent" true. Without it the branch cannot be tested honestly: the standard dirs are
# added unconditionally, so scrubbing PATH proves nothing on a box where node happens to live in
# one of them. A test that passes or fails on the tester's geography is the flake this file
# exists to prevent, not an instance of it.
node_on_path() {
  local standard_dirs="/usr/local/bin:/usr/bin:/bin"
  local fallback_dirs="$HOME/bin:/opt/homebrew/bin"
  if [ -n "${NODE_ON_PATH_SEARCH_DIRS:-}" ]; then
    standard_dirs="$NODE_ON_PATH_SEARCH_DIRS"
    fallback_dirs="$NODE_ON_PATH_SEARCH_DIRS"
  fi

  # The standard dirs first, unconditionally. node is not the only thing a scrubbed PATH costs —
  # `mktemp`, `date` and `dirname` all go with it, and a check runner that loses those fails in a
  # way that reads like a broken repo rather than a broken environment.
  PATH="$PATH:$standard_dirs"
  export PATH

  command -v node >/dev/null 2>&1 && return 0

  # Walked by parameter expansion rather than by resetting IFS or reading into an array: this file
  # is sourced into whatever shell a hook happens to have, up to and including macOS's bash 3.2,
  # and neither of those survives that trip intact.
  local dir rest="$fallback_dirs"
  while [ -n "$rest" ]; do
    dir="${rest%%:*}"
    if [ "$rest" = "$dir" ]; then rest=""; else rest="${rest#*:}"; fi
    [ -n "$dir" ] || continue
    if [ -x "$dir/node" ]; then
      PATH="$dir:$PATH"
      export PATH
      return 0
    fi
  done

  return 1
}
