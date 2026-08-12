#!/usr/bin/env python3
"""One unified cost table for Claude Code spend.

Usage: cost_table.py [<dir-or-file.jsonl> | --all] [--ttl 5m|1h] [--rows N]

Wraps cost_bash.py's attribution and collapses it into a single table:
  * Bash split per resolved command
  * every other tool's call-args + results merged into one row
  * output split into thinking / prose / tool-args
  * the fixed preamble as its own row
Rows sum to the exact billed total.
"""
import subprocess, sys, os, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))

def main():
    argv = sys.argv[1:]
    rows_n = 30
    if "--rows" in argv:
        i = argv.index("--rows"); rows_n = int(argv[i + 1]); del argv[i:i + 2]

    out = subprocess.run([sys.executable, os.path.join(HERE, "cost_bash.py")] + argv,
                         capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr or out.stdout)
    text = out.stdout

    agg = defaultdict(float)
    total = 0.0
    header = ""
    for line in text.splitlines():
        if "API requests" in line:
            header = line.strip()
        t = re.match(r"^TOTAL BILLED\s+\$\s*([\d,]+\.\d\d)", line)
        if t:
            total = float(t.group(1).replace(",", ""))
        m = re.match(r"^(.+?)\s+\$\s*([\d,]+\.\d\d)\s+([\d.]+)%", line)
        if not m:
            continue
        label, dollars = m.group(1).strip(), float(m.group(2).replace(",", ""))
        if label.startswith("TOTAL"):
            continue
        # Collapse call/result pairs into one row per source.
        if label.startswith(("tool call: ", "tool result: ")):
            label = label.split(": ", 1)[1]
        if label.startswith("Bash: "):
            label = "bash · " + label.split("Bash: ", 1)[1]
        elif label.startswith("mcp__"):
            parts = label.split("__")
            label = "mcp · " + (parts[1] if len(parts) > 2 else label)
        elif label.startswith("OUTPUT: "):
            label = "output · " + label.split("OUTPUT: ", 1)[1]
        agg[label] += dollars

    ranked = sorted(agg.items(), key=lambda kv: -kv[1])
    shown, cum = ranked[:rows_n], 0.0
    tail = sum(v for _, v in ranked[rows_n:])

    print(f"\n{header}")
    print(f"TOTAL BILLED  ${total:,.2f}\n")
    print(f"{'#':>3}  {'cost driver':<34}{'cost':>10}{'share':>8}{'cumul':>8}")
    print("-" * 65)
    for i, (k, v) in enumerate(shown, 1):
        cum += v
        print(f"{i:>3}  {k[:33]:<34}${v:>9,.2f}{v/total*100:>7.1f}%{cum/total*100:>7.1f}%")
    if tail:
        cum += tail
        print(f"{'':>3}  {f'+ {len(ranked)-rows_n} smaller rows':<34}"
              f"${tail:>9,.2f}{tail/total*100:>7.1f}%{cum/total*100:>7.1f}%")
    # Upstream suppresses rows under 0.05% of spend; surface the remainder so
    # the table reconciles to the billed total instead of quietly under-summing.
    residual = total - cum
    if residual > 0.005:
        cum += residual
        print(f"{'':>3}  {'rows below 0.05% threshold':<34}"
              f"${residual:>9,.2f}{residual/total*100:>7.1f}%{cum/total*100:>7.1f}%")
    print("-" * 65)
    print(f"{'':>3}  {'TOTAL':<34}${total:>9,.2f}{100.0:>7.1f}%")
    print("\nEach row = everything that source cost you: the tokens it put in")
    print("context, re-billed on every later request it survived in.\n")

if __name__ == "__main__":
    main()
