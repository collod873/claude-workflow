#!/usr/bin/env bash
# Create the next ADR from a title. Numbering is derived, never typed.
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "usage: bin/new-adr \"the ruling as a sentence\"" >&2
  echo "  e.g. bin/new-adr \"Event-driven triggers only, never a clock\"" >&2
  exit 1
fi

title="$*"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
adr_dir="$repo_root/docs/adr"
mkdir -p "$adr_dir"

# Highest existing number wins, so a gap never causes a collision.
next=$(find "$adr_dir" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.md' -printf '%f\n' 2>/dev/null \
  | cut -c1-4 | sort -n | tail -1)
next=$(printf '%04d' $((10#${next:-0} + 1)))

slug=$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
  | cut -c1-60 | sed -E 's/-+$//')

file="$adr_dir/$next-$slug.md"
[ -e "$file" ] && { echo "already exists: $file" >&2; exit 1; }

cat > "$file" <<EOF
# $title

Recorded $(date +%Y-%m-%d).

EOF

echo "$file"
if [ -n "${EDITOR:-}" ]; then exec "$EDITOR" "$file"; fi
