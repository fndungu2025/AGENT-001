#!/usr/bin/env python3
"""Extract agent files from research/agents.md §4.x "6. System prompt" blocks.

Usage: python3 scripts/agent-guards/extract-agents.py [--check]
Writes .claude/agents/<name>.md verbatim (frontmatter + body). With --check,
only reports whether the installed files match the spec (exit 1 on drift).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "research" / "agents.md"
OUT = ROOT / ".claude" / "agents"


def extract(text: str) -> dict[str, str]:
    lines = text.splitlines(keepends=True)
    agents: dict[str, str] = {}
    i = 0
    while i < len(lines):
        if lines[i].startswith("**6. System prompt:**"):
            j = i + 1
            while not lines[j].startswith("```markdown"):
                j += 1
            k = j + 1
            while not lines[k].rstrip("\n") == "```":
                k += 1
            body = "".join(lines[j + 1 : k])
            m = re.search(r"^name:\s*(\S+)\s*$", body, re.M)
            if not m:
                raise SystemExit(f"no name in block at line {j + 1}")
            name = m.group(1).strip("\"'")
            if name in agents:
                raise SystemExit(f"duplicate agent name {name}")
            agents[name] = body
            i = k
        i += 1
    return agents


def main() -> int:
    agents = extract(SPEC.read_text(encoding="utf-8"))
    check = "--check" in sys.argv
    drift = 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name, body in agents.items():
        path = OUT / f"{name}.md"
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != body:
                print(f"DRIFT {path.relative_to(ROOT)}")
                drift += 1
        else:
            path.write_text(body, encoding="utf-8")
            print(f"wrote {path.relative_to(ROOT)}")
    print(f"{len(agents)} agents")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
