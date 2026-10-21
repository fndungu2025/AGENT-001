#!/usr/bin/env bash
# Self-tests for the agent guard hooks. Usage: scripts/agent-guards/test.sh
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/docs/agents" "$ROOT/apps/web/src/a/b" "$ROOT/outside_link_target"
export CLAUDE_PROJECT_DIR="$ROOT"
pass=0; fail=0

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

expect() { # expect <0|2> <name> <cmd...>  (stdin from $INPUT)
  local want="$1" name="$2"; shift 2
  printf '%s' "$INPUT" | "$@" >/dev/null 2>"$ROOT/.err"; local got=$?
  if [ "$got" -eq "$want" ]; then pass=$((pass+1)); else
    fail=$((fail+1)); echo "FAIL: $name (want $want, got $got)"; sed 's/^/   /' "$ROOT/.err"; fi
  if [ "$want" -eq 2 ] && [ ! -s "$ROOT/.err" ]; then
    fail=$((fail+1)); echo "FAIL: $name blocked without a stderr message"; fi
}

path_case() { # path_case <want> <tool> <key> <path> <globs> [cwd]
  local cwd="${6:-$ROOT}"
  INPUT="{\"tool_name\":\"$2\",\"cwd\":$(json_str "$cwd"),\"tool_input\":{\"$3\":$(json_str "$4")}}"
  expect "$1" "allow-paths $2 $4 [$5]" "$DIR/allow-paths.sh" "$5"
}

sql_case() { # sql_case <want> <query>
  INPUT="{\"tool_name\":\"mcp__supabase-dev__execute_sql\",\"tool_input\":{\"query\":$(json_str "$2")}}"
  expect "$1" "readonly-sql: $2" "$DIR/readonly-sql.sh"
}

# ---------- allow-paths ----------
G='docs/agents/** .claude/CLAUDE.md research/**'
path_case 0 Write file_path "docs/agents/ledger.md" "$G"
path_case 0 Write file_path "$ROOT/docs/agents/plans/TASK-0001.md" "$G"
path_case 0 Edit  file_path "$ROOT/.claude/CLAUDE.md" "$G"
path_case 0 Edit  file_path "research/web/deep/x.md" "$G"
path_case 2 Edit  file_path "$ROOT/.claude/settings.json" "$G"
path_case 2 Write file_path "docs/adr/0001.md" "$G"
path_case 2 Write file_path "docs/agents" "docs/agents/*"                    # dir itself not matched by /*
path_case 2 Write file_path "../escape.md" "**"                              # .. escape, even with **
path_case 2 Write file_path "docs/agents/../../../etc/passwd" "docs/agents/**"
path_case 2 Write file_path "/etc/passwd" "**"
path_case 0 Write file_path "docs/agents/../agents/x.md" "docs/agents/**"   # normalises inside project
path_case 0 Write file_path "a/b/x.md" "apps/web/src/**" "$ROOT/apps/web/src" # relative to cwd
path_case 2 Write file_path "x.md" "apps/web/src/**" "$ROOT/apps/web"
# ** semantics
path_case 0 Write file_path "packages/ml/tests/test_x.py" "**/tests/**"
path_case 0 Write file_path "tests/test_x.py" "**/tests/**"
path_case 2 Write file_path "packages/ml/testsuite/x.py" "**/tests/**"
path_case 0 Write file_path "apps/web/src/Foo.test.tsx" "apps/web/**/*.test.tsx"
path_case 0 Write file_path "apps/web/Foo.test.tsx" "apps/web/**/*.test.tsx"
path_case 2 Write file_path "apps/web/src/Foo.tsx" "apps/web/**/*.test.tsx"
# * stays within one segment
path_case 0 Write file_path "docs/reviews/architecture-2026.md" "docs/reviews/architecture-*.md"
path_case 2 Write file_path "docs/reviews/architecture-x/y.md" "docs/reviews/architecture-*.md"
path_case 0 Write file_path "apps/api/app/routers/orgs_v1.py" "apps/api/app/routers/orgs*"
path_case 2 Write file_path "apps/api/app/routers/orgs/x.py" "apps/api/app/routers/orgs*"
path_case 0 Write file_path "apps/web/.env.example" "**/.env.example"
path_case 0 Write file_path ".env.example" "**/.env.example"
path_case 2 Write file_path "apps/web/.env" "**/.env.example"
# NotebookEdit uses notebook_path
path_case 0 NotebookEdit notebook_path "notebooks/eda.ipynb" "notebooks/**"
path_case 2 NotebookEdit notebook_path "apps/eda.ipynb" "notebooks/**"
# symlink escaping the project
ln -s /tmp "$ROOT/docs/agents/link"
path_case 2 Write file_path "docs/agents/link/evil.md" "docs/agents/**"
# malformed input / missing config fail closed
INPUT='not json'; expect 2 "allow-paths bad json" "$DIR/allow-paths.sh" "**"
INPUT='{"tool_name":"Write","tool_input":{}}'; expect 2 "allow-paths no path" "$DIR/allow-paths.sh" "**"
INPUT='{"tool_name":"Write","tool_input":{"file_path":"x.md"}}'; expect 2 "allow-paths no globs" "$DIR/allow-paths.sh" ""

# ---------- readonly-sql ----------
sql_case 0 "select * from orgs where id = 1"
sql_case 0 "SELECT count(*) FROM public.v_customer_features;"
sql_case 0 "with x as (select 1 as a) select * from x"
sql_case 0 "explain select * from orgs"
sql_case 0 "explain analyze select * from orgs"
sql_case 0 "explain (analyze, buffers) select 1"
sql_case 0 "select 'delete from orgs' as txt"                      # keyword inside a string
sql_case 0 "select 1 -- drop table orgs"                            # keyword inside a comment
sql_case 0 "select created_at, updated_at, deleted_at from orgs"   # identifiers containing keywords
sql_case 0 "select \"update\" from t"                                # quoted identifier
sql_case 0 "select \$\$ insert into x \$\$"                          # dollar-quoted literal
sql_case 0 "select cluster from customer_clusters"
sql_case 0 "show search_path"
sql_case 2 "insert into orgs(name) values ('x')"
sql_case 2 "UPDATE orgs SET name='x'"
sql_case 2 "delete from orgs"
sql_case 2 "merge into t using s on true when matched then delete"
sql_case 2 "truncate orgs"
sql_case 2 "drop table orgs"
sql_case 2 "alter table orgs disable row level security"
sql_case 2 "create table x(a int)"
sql_case 2 "grant all on orgs to anon"
sql_case 2 "revoke select on orgs from authenticated"
sql_case 2 "comment on table orgs is 'x'"
sql_case 2 "copy orgs from '/tmp/x.csv'"
sql_case 2 "copy (select 1) to program 'id'"
sql_case 2 "vacuum full orgs"
sql_case 2 "reindex table orgs"
sql_case 2 "cluster orgs using orgs_pkey"
sql_case 2 "refresh materialized view mv_rfm"
sql_case 2 "call app.do_thing()"
sql_case 2 "do \$\$ begin delete from orgs; end \$\$"
sql_case 2 "do language plpgsql \$body\$ begin null; end \$body\$"
sql_case 2 "set role service_role"
sql_case 2 "set local role postgres"
sql_case 2 "select pg_terminate_backend(123)"
sql_case 2 "select pg_cancel_backend(123)"
sql_case 2 "select set_config('request.jwt.claims', '{}', true)"
sql_case 2 "select pg_read_file('/etc/passwd')"
sql_case 2 "select * into backup_orgs from orgs"
sql_case 2 "select * from orgs for update"
sql_case 2 "begin"
sql_case 2 "lock table orgs"
sql_case 2 "analyze orgs"
# tricky
sql_case 2 "select 1; delete from orgs"                              # stacked statement
sql_case 2 "/* harmless */ delete from orgs"                         # comment before write
sql_case 2 "select 1 /* ; */ ; drop table orgs"
sql_case 2 "sel/**/ect 1; insert into t values (1)"
sql_case 2 "with d as (delete from orgs returning *) select * from d" # data-modifying CTE
sql_case 2 "with i as (insert into t values (1) returning *) select 1"
sql_case 2 "explain analyze delete from orgs"
sql_case 2 "explain analyze insert into t values (1)"
sql_case 2 "explain (analyze) update orgs set name = 'x'"
sql_case 2 "select 'it''s' ; drop table x"                            # escaped quote then write
sql_case 0 "select E'\\' ; drop table x --'"                         # E-string: \' escapes, all literal
sql_case 2 "select '\\' ; drop table x --'"                          # plain string: backslash is literal, write follows
sql_case 2 "create or replace function f() returns int language sql security definer as 'select 1'"
sql_case 2 "select 'unterminated"
sql_case 2 "/* unterminated comment select 1"
sql_case 2 "   "
INPUT='{"tool_name":"mcp__supabase-dev__execute_sql","tool_input":{}}'; expect 2 "readonly-sql no query" "$DIR/readonly-sql.sh"
INPUT='garbage'; expect 2 "readonly-sql bad json" "$DIR/readonly-sql.sh"

echo "agent-guards tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
