#!/usr/bin/env bash
# PreToolUse guard for MCP execute_sql: allow only read-only SQL.
# Exit 0 allows, exit 2 blocks (stderr shown to the agent). Fails closed.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "readonly-sql guard: python3 not found; refusing query" >&2
  exit 2
fi
python3 -I "$DIR/readonly_sql.py"
rc=$?
[ "$rc" -eq 0 ] && exit 0
exit 2
