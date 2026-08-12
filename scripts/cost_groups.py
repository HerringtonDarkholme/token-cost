#!/usr/bin/env python3
"""Claude Code spend grouped by activity, not sorted by cost.

Usage:
  cost_groups.py [<dir-or-file.jsonl> | --all] [--ttl 5m|1h]
                 [--split "name=tokens,name=tokens,..."] [--detail]

--split expands the measured preamble into sub-rows. Token counts come from
disk (CLAUDE.md, MEMORY.md, skill frontmatter) plus the smallest first-request
context observed across projects; see the cross-check in cost_attribution.py.
--detail lists every row inside each group instead of the top few.
"""
import subprocess, sys, os, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))

# Ordered: each label is tested against these predicates in turn.
GROUPS = [
    ("Fixed overhead — billed on every request",
     lambda l: l.startswith(("system prompt", "MCP tool lists", "skill descriptions",
                             "project CLAUDE.md", "MEMORY.md", "user CLAUDE.md"))),
    ("Reading code",
     lambda l: l in ("Read", "Glob", "Grep", "NotebookRead")
     or _bash(l) in ("cat", "grep", "sed", "rg", "ag", "ls", "head", "tail",
                     "find", "wc", "awk", "cut", "sort", "uniq", "less",
                     "git grep", "git show", "jq", "tree")
     # subcommand-carrying readers: match on the program, not the full label.
     # Parens matter: a bare trailing if/else would capture the whole or-chain
     # and drop non-bash labels like "Read".
     or (_bash(l).split()[0] in ("ast-grep", "sg") if _bash(l) else False)),
    ("Writing code",
     lambda l: l in ("Edit", "Write", "NotebookEdit", "MultiEdit")
     or _bash(l) in ("mkdir", "mv", "cp", "rm", "touch", "chmod", "patch", "tee")),
    ("Version control",
     lambda l: _bash(l).startswith("git ") or _bash(l) in ("git", "gt", "jj", "hub")),
    ("GitHub / code review",
     lambda l: _bash(l).startswith("gh ") or _bash(l) == "gh"),
    ("Build, test, run",
     lambda l: _bash(l).split()[0] in ("pnpm", "npm", "yarn", "bun", "npx", "node",
                                       "python3", "python", "bash", "sh", "zsh",
                                       "make", "just", "cargo", "go", "deno",
                                       "tsc", "vitest", "jest", "pytest", "docker",
                                       "curl", "brew", "uv", "pip", "pip3")
     if _bash(l) else False),
    ("Model output",
     lambda l: l.startswith("output · ") or l == "assistant prose"),
    ("Orchestration & planning",
     lambda l: l in ("Agent", "Task", "TaskCreate", "TaskUpdate", "TaskList",
                     "TaskGet", "TaskOutput", "TaskStop", "ExitPlanMode",
                     "EnterPlanMode", "AskUserQuestion", "Skill", "Workflow",
                     "ToolSearch", "ReportFindings", "Monitor", "SendMessage",
                     "ListAgents", "subagent notifications")),
    ("Conversation & session plumbing",
     lambda l: l in ("your typed messages", "compaction summaries",
                     "images / screenshots", "system reminders / CLAUDE.md",
                     "slash-command expansions")),
    ("MCP & external services",
     lambda l: l.startswith("mcp · ") or l in ("WebFetch", "WebSearch", "Artifact")),
]

def _bash(label):
    return label.split("bash · ", 1)[1] if label.startswith("bash · ") else ""

# Grouped by mechanism -- which channel put the tokens there -- rather than by
# what the work was for. Note the system prompt and the built-in tool schemas
# are ONE inseparable block in the transcript data; it sits under SYSTEM with
# that called out, and TOOL SCHEMAS holds only the parts measurable on disk.
MECHANISM_GROUPS = [
    ("System prompt & instructions",
     lambda l: l.startswith(("system prompt", "project CLAUDE.md", "user CLAUDE.md",
                             "MEMORY.md", "system reminders"))),
    ("Tool schemas",
     lambda l: l.startswith(("MCP tool lists", "skill descriptions"))),
    ("Bash", lambda l: bool(_bash(l))),
    ("Read", lambda l: l in ("Read", "Glob", "Grep", "NotebookRead")),
    ("Write", lambda l: l in ("Write", "Edit", "MultiEdit", "NotebookEdit")),
    ("My typing", lambda l: l == "your typed messages"),
    ("Model output",
     lambda l: l.startswith("output · ") or l == "assistant prose"),
    ("Other tools & plumbing", lambda l: True),
]

def classify(label, groups=None):
    for name, pred in (groups or GROUPS):
        try:
            if pred(label):
                return name
        except Exception:
            pass
    return "Everything else"

def main():
    argv = sys.argv[1:]
    split, detail = {}, False
    groups = GROUPS
    if "--scheme" in argv:
        i = argv.index("--scheme")
        groups = MECHANISM_GROUPS if argv[i + 1] == "mechanism" else GROUPS
        del argv[i:i + 2]
    if "--detail" in argv:
        detail = True; argv.remove("--detail")
    if "--split" in argv:
        i = argv.index("--split")
        for part in argv[i + 1].split(","):
            k, v = part.rsplit("=", 1)
            split[k.strip()] = float(v)
        del argv[i:i + 2]

    r = subprocess.run([sys.executable, os.path.join(HERE, "cost_bash.py")] + argv,
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr or r.stdout)

    rows, total, header = defaultdict(float), 0.0, ""
    for line in r.stdout.splitlines():
        if "API requests" in line:
            header = line.strip()
        t = re.match(r"^TOTAL BILLED\s+\$\s*([\d,]+\.\d\d)", line)
        if t:
            total = float(t.group(1).replace(",", ""))
        m = re.match(r"^(.+?)\s+\$\s*([\d,]+\.\d\d)\s+([\d.]+)%", line)
        if not m or m.group(1).startswith("TOTAL"):
            continue
        label, d = m.group(1).strip(), float(m.group(2).replace(",", ""))
        if label.startswith(("tool call: ", "tool result: ")):
            label = label.split(": ", 1)[1]
        if label.startswith("Bash: "):
            label = "bash · " + label.split("Bash: ", 1)[1]
        elif label.startswith("mcp__"):
            p = label.split("__")
            label = "mcp · " + (p[1] if len(p) > 2 else label)
        elif label.startswith("OUTPUT: "):
            label = "output · " + label.split("OUTPUT: ", 1)[1]
        rows[label] += d

    # Expand the preamble into measured sub-components.
    pre_key = "system prompt + tool schemas"
    if split and pre_key in rows:
        pot = rows.pop(pre_key)
        tot_t = sum(split.values())
        for k, v in split.items():
            rows[k] += pot * v / tot_t

    grouped = defaultdict(list)
    for label, d in rows.items():
        grouped[classify(label, groups)].append((label, d))

    accounted = sum(rows.values())
    residual = total - accounted   # rows upstream suppressed as sub-0.05%

    print(f"\n{header}")
    print(f"TOTAL BILLED  ${total:,.2f}\n")
    order = [n for n, _ in groups] + ["Everything else"]
    bar_w = 26
    for name in order:
        items = sorted(grouped.get(name, []), key=lambda kv: -kv[1])
        if not items:
            continue
        sub = sum(d for _, d in items)
        pct = sub / total * 100
        bar = "█" * max(1, round(pct / 100 * bar_w)) + "·" * (bar_w - max(1, round(pct / 100 * bar_w)))
        print(f"{bar}  {pct:>5.1f}%  ${sub:>8,.2f}  {name.upper()}")
        show = items if detail else items[:5]
        for label, d in show:
            print(f"{'':28}{'':8}${d:>8,.2f}    {label[:38]}")
        if len(items) > len(show):
            rest = sum(d for _, d in items[len(show):])
            n = len(items) - len(show)
            print(f"{'':28}{'':8}${rest:>8,.2f}    other ({n} row{'s' if n > 1 else ''})")
        print()
    if residual > 0.005:
        print(f"{'·'*bar_w}  {residual/total*100:>5.1f}%  ${residual:>8,.2f}  "
              f"BELOW 0.05% REPORTING THRESHOLD\n")
    print(f"{'':28}{'':8}${total:>8,.2f}    TOTAL\n")

if __name__ == "__main__":
    main()
