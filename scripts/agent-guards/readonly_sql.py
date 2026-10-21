"""PreToolUse guard: allow only read-only SQL through MCP execute_sql.

Reads hook JSON on stdin, inspects tool_input.query. Comments, string
literals, dollar-quoted bodies and quoted identifiers are stripped first, so
keywords hidden in comments neither trigger nor evade the check.
Each statement must start with SELECT / WITH / VALUES / TABLE / SHOW /
EXPLAIN (EXPLAIN [ANALYZE] must wrap a read statement) and must not contain
any write, DDL, privilege, session or side-effect keyword anywhere (this
catches data-modifying CTEs such as WITH x AS (INSERT ...) SELECT ...).
Statement-level commands (CALL, CLUSTER, LOCK, DO, SET, LISTEN/NOTIFY, BEGIN,
ANALYZE, ...) are rejected by the start-keyword allowlist.
Exit 0 = allow, exit 2 = block. Fails closed on anything unexpected.
"""
import json
import re
import sys

ALLOWED_START = {"select", "with", "values", "table", "show", "explain", "("}
READ_START = {"select", "with", "values", "table", "("}

BLOCKED = [
    (r"\binsert\b", "INSERT"),
    (r"\bupdate\b", "UPDATE"),
    (r"\bdelete\b", "DELETE"),
    (r"\bmerge\b", "MERGE"),
    (r"\bupsert\b", "UPSERT"),
    (r"\btruncate\b", "TRUNCATE"),
    (r"\bdrop\b", "DROP"),
    (r"\balter\b", "ALTER"),
    (r"\bcreate\b", "CREATE"),
    (r"\bgrant\b", "GRANT"),
    (r"\brevoke\b", "REVOKE"),
    (r"\bcomment\s+on\b", "COMMENT ON"),
    (r"\bcopy\b", "COPY"),
    (r"\bvacuum\b", "VACUUM"),
    (r"\breindex\b", "REINDEX"),
    (r"\brefresh\s+materialized\s+view\b", "REFRESH MATERIALIZED VIEW"),
    (r"\bdo\s+(language\s+\w+\s+)?'", "DO block"),
    (r"\bset\s+(local\s+|session\s+)?role\b", "SET ROLE"),
    (r"\bsession\s+authorization\b", "SET SESSION AUTHORIZATION"),
    (r"\bsecurity\s+definer\b", "SECURITY DEFINER"),
    (r"\bpg_terminate_backend\b", "pg_terminate_backend"),
    (r"\bpg_cancel_backend\b", "pg_cancel_backend"),
    (r"\binto\b", "SELECT INTO / INTO"),
    (r"\bfor\s+(no\s+key\s+)?(update|share)\b|\bfor\s+key\s+share\b", "row lock (FOR UPDATE/SHARE)"),
    (r"\b(set_config|setval|nextval|pg_reload_conf|pg_rotate_logfile|pg_read_file|"
     r"pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|lo_unlink|dblink\w*|"
     r"pg_advisory_\w*lock\w*|pg_switch_wal|pg_create_\w+|pg_drop_replication_slot|"
     r"pg_logical_emit_message|pg_notify|http_\w+|net\.\w+)\s*\(", "side-effect function"),
]


def block(msg: str) -> None:
    print(f"readonly-sql guard: {msg} This agent may run read-only SQL only "
          "(SELECT/WITH/EXPLAIN). Writes and DDL go through a migration by "
          "db-engineer; return status: escalate if you need one.", file=sys.stderr)
    sys.exit(2)


def strip_sql(sql: str) -> str:
    """Remove comments; replace literals/quoted identifiers with placeholders."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j
            out.append(" ")
        elif sql.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if sql.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif sql.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
            if depth:
                raise ValueError("unterminated block comment")
            out.append(" ")
        elif c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z_0-9]*)?\$", sql[i:])
            if m and not (i > 0 and (sql[i - 1].isalnum() or sql[i - 1] == "_")):
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                if j < 0:
                    raise ValueError("unterminated dollar-quoted string")
                i = j + len(tag)
                out.append(" '' ")
            else:
                out.append(c)
                i += 1
        elif c == "'":
            backslash = i > 0 and sql[i - 1] in "eE" and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] == "_"))
            i += 1
            while True:
                if i >= n:
                    raise ValueError("unterminated string literal")
                if backslash and sql[i] == "\\":
                    i += 2
                    continue
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            out.append(" '' ")
        elif c == '"':
            j = i + 1
            while True:
                j = sql.find('"', j)
                if j < 0:
                    raise ValueError("unterminated quoted identifier")
                if j + 1 < n and sql[j + 1] == '"':
                    j += 2
                    continue
                break
            i = j + 1
            out.append(" qident ")
        else:
            out.append(c)
            i += 1
    return "".join(out)


def first_word(stmt: str) -> str:
    stmt = stmt.lstrip()
    if stmt.startswith("("):
        return "("
    m = re.match(r"[a-z_]+", stmt)
    return m.group(0) if m else ""


def check_statement(stmt: str) -> None:
    word = first_word(stmt)
    if word not in ALLOWED_START:
        block(f"statement starting with '{word or stmt[:20]}' is not allowed.")
    if word == "explain":
        rest = re.sub(r"^\s*explain\s*", "", stmt)
        rest = re.sub(r"^\([^)]*\)\s*", "", rest)
        rest = re.sub(r"^((analy[sz]e|verbose|costs|buffers|settings|wal|timing|summary|"
                      r"format\s+\w+)\s+)*", "", rest)
        inner = first_word(rest)
        if inner not in READ_START:
            block(f"EXPLAIN of a non-read statement ('{inner}') is not allowed.")
    for pattern, label in BLOCKED:
        if re.search(pattern, stmt):
            block(f"query contains {label}.")


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except (ValueError, OSError) as exc:
        block(f"could not parse hook input JSON ({exc}).")
    tool_input = data.get("tool_input") or {}
    query = tool_input.get("query", tool_input.get("sql"))
    if not isinstance(query, str) or not query.strip():
        block("no SQL query found in tool_input.query.")
    try:
        cleaned = strip_sql(query).lower()
    except ValueError as exc:
        block(f"could not parse SQL safely ({exc}).")
    statements = [s for s in cleaned.split(";") if s.strip()]
    if not statements:
        block("query is empty after removing comments.")
    for stmt in statements:
        check_statement(stmt)
    sys.exit(0)


if __name__ == "__main__":
    main()
