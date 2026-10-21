"""PreToolUse guard: allow Edit/Write/NotebookEdit only inside allowed globs.

Usage (via allow-paths.sh): allow-paths.sh '<glob> <glob> ...'  < hook-json
Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
Glob syntax: `**` matches across directories (zero or more segments),
`*` and `?` match within one path segment. Globs are relative to the
project root (CLAUDE_PROJECT_DIR, else `git rev-parse --show-toplevel`).
Fails closed: any error blocks the call.
"""
import json
import os
import re
import subprocess
import sys

PATH_KEYS = ("file_path", "notebook_path", "path")


def block(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"allow-paths guard: {msg}", file=sys.stderr)
    sys.exit(2)


def glob_to_regex(glob: str) -> "re.Pattern[str]":
    i, out = 0, []
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:[^/]+/)*")
            i += 3
        elif glob.startswith("/**", i) and i + 3 == len(glob):
            out.append("(?:/.*)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


def project_root(cwd: str) -> str:
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return env
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd or None, capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        block("cannot determine project root (set CLAUDE_PROJECT_DIR or run inside git)")


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].split():
        block("no allowed globs configured; refusing all writes")
    globs = sys.argv[1].split()
    try:
        data = json.load(sys.stdin)
    except (ValueError, OSError) as exc:
        block(f"could not parse hook input JSON ({exc})")
    tool = data.get("tool_name", "?")
    tool_input = data.get("tool_input") or {}
    target = next((tool_input[k] for k in PATH_KEYS if isinstance(tool_input.get(k), str)), None)
    if not target:
        block(f"{tool}: no file path in tool_input; refusing")
    cwd = data.get("cwd") or os.getcwd()
    root = os.path.realpath(project_root(cwd))
    abs_target = target if os.path.isabs(target) else os.path.join(cwd, target)
    # realpath resolves `..` and symlinks (of existing path prefixes).
    resolved = os.path.realpath(abs_target)
    rel = os.path.relpath(resolved, root)
    if rel == os.curdir or rel == os.pardir or rel.startswith(os.pardir + os.sep) or os.path.isabs(rel):
        block(f"{tool} target '{target}' is outside the project root '{root}'. "
              f"Allowed globs: {' '.join(globs)}")
    rel = rel.replace(os.sep, "/")
    if any(glob_to_regex(g[2:] if g.startswith("./") else g).match(rel) for g in globs):
        sys.exit(0)
    block(f"{tool} on '{rel}' is outside this agent's write scope. "
          f"Allowed globs: {' '.join(globs)}. If the change is needed, return "
          f"status: escalate (or hand it to the owning agent) instead of retrying.")


if __name__ == "__main__":
    main()
