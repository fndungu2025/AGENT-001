#!/usr/bin/env bash
# PreToolUse guard for Edit|Write|NotebookEdit. Usage: allow-paths.sh '<glob> <glob> ...'
# Exit 0 allows, exit 2 blocks (stderr shown to the agent). Fails closed.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "allow-paths guard: python3 not found; refusing write" >&2
  exit 2
fi
python3 -I "$DIR/allow_paths.py" "$@"
rc=$?
[ "$rc" -eq 0 ] && exit 0
exit 2
