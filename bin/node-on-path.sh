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

node_on_path() {
  # The standard dirs first, unconditionally. node is not the only thing a scrubbed PATH costs —
  # `mktemp`, `date` and `dirname` all go with it, and a check runner that loses those fails in a
  # way that reads like a broken repo rather than a broken environment.
  PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
  export PATH

  command -v node >/dev/null 2>&1 && return 0

  local dir
  for dir in "$HOME/bin" /opt/homebrew/bin; do
    if [ -x "$dir/node" ]; then
      PATH="$dir:$PATH"
      export PATH
      return 0
    fi
  done

  return 1
}
