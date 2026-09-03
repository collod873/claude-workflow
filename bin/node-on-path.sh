# Put node on PATH, or say so. Sourced, never executed.

node_on_path() {
  local standard_dirs="/usr/local/bin:/usr/bin:/bin"
  local fallback_dirs="${HOME:-}/bin:/opt/homebrew/bin"
  if [ -n "${NODE_ON_PATH_SEARCH_DIRS:-}" ]; then
    standard_dirs="$NODE_ON_PATH_SEARCH_DIRS"
    fallback_dirs="$NODE_ON_PATH_SEARCH_DIRS"
  fi

  PATH="$PATH:$standard_dirs"
  export PATH

  command -v node >/dev/null 2>&1 && return 0

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
