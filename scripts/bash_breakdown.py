#!/usr/bin/env python3
"""Break down Bash token consumption by command.

Usage:
  bash_breakdown.py [<dir-or-file.jsonl> | --all]   (default: cwd's project)

Splits every Bash invocation into pipeline segments, resolves the primary
command, and attributes both the command text and its result to that command.
"""
import json, os, sys, glob
from collections import defaultdict

# wrappers that prefix the real command in the SAME segment -- skip the word
WRAPPERS = {"sudo", "time", "env", "nohup", "command", "exec",
            "builtin", "then", "do", "else", "!"}
# whole-segment noise: the real command lives in a LATER segment (cd x && ...)
SKIP_SEGMENT = {"cd", "export", "set", "unset", "shopt", "alias", "pushd", "popd"}
# real commands, but never the *point* of a call when something else is present
# (loop bodies like `for n in ...; do echo "## $n"; gh pr view $n; done`)
TRIVIAL = {"echo", "printf", "true", ":", "sleep", "done", "fi", "wc"}
# commands whose second word is the meaningful part
SUBCOMMAND = {"git", "npm", "pnpm", "yarn", "bun", "cargo", "docker", "gh",
              "kubectl", "ast-grep", "sg", "go", "deno", "brew", "uv", "pip",
              "pip3", "terraform", "aws", "gcloud", "make", "just", "rustup"}

def est(s):
    return len(s) / 4

def split_segments(cmd):
    """Split a shell string on top-level | || && ; and newlines, respecting
    quotes, and skipping heredoc bodies."""
    segs, buf = [], []
    i, n = 0, len(cmd)
    quote = None
    depth = 0
    heredoc = None
    while i < n:
        c = cmd[i]
        if heredoc is not None:
            # consume until a line equal to the heredoc tag
            nl = cmd.find("\n", i)
            line = cmd[i:nl if nl != -1 else n].strip()
            if line == heredoc:
                heredoc = None
            if nl == -1:
                break
            i = nl + 1
            continue
        if quote:
            if c == "\\" and quote == '"':
                buf.append(cmd[i:i+2]); i += 2; continue
            if c == quote:
                quote = None
            buf.append(c); i += 1; continue
        if c in "'\"":
            quote = c; buf.append(c); i += 1; continue
        if cmd.startswith("<<", i):
            j = i + 2
            if j < n and cmd[j] == "-":
                j += 1
            k = j
            while k < n and (cmd[k].isspace()):
                k += 1
            tag = []
            q = None
            if k < n and cmd[k] in "'\"":
                q = cmd[k]; k += 1
            while k < n and (cmd[k].isalnum() or cmd[k] in "_-" or (q and cmd[k] != q)):
                tag.append(cmd[k]); k += 1
            if q and k < n:
                k += 1
            heredoc = "".join(tag)
            nl = cmd.find("\n", k)
            if nl == -1:
                break
            i = nl + 1
            continue
        if c in "([{":
            depth += 1; buf.append(c); i += 1; continue
        if c in ")]}":
            depth = max(0, depth - 1); buf.append(c); i += 1; continue
        if depth == 0:
            if cmd.startswith("&&", i) or cmd.startswith("||", i):
                segs.append("".join(buf)); buf = []; i += 2; continue
            if c in "|;\n":
                segs.append("".join(buf)); buf = []; i += 1; continue
        buf.append(c); i += 1
    segs.append("".join(buf))
    return [s.strip() for s in segs if s.strip()]

def resolve(seg):
    """Return a command label for one pipeline segment, or None."""
    words = seg.replace("(", " ").split()
    idx = 0
    while idx < len(words):
        w = words[idx]
        if "=" in w and not w.startswith("-") and w.split("=")[0].isidentifier():
            idx += 1; continue          # VAR=value prefix
        if w in WRAPPERS:
            idx += 1; continue
        if w in ("for", "while", "if", "case", "function"):
            return None
        break
    if idx >= len(words):
        return None
    if words[idx] in SKIP_SEGMENT:
        return None
    name = os.path.basename(words[idx]).lstrip("$(").strip("\"'")
    if not name or name.startswith("-"):
        return None
    if name == "xargs":                  # real command follows
        rest = " ".join(words[idx+1:])
        return resolve(rest) if rest else "xargs"
    if name in SUBCOMMAND:
        for w in words[idx+1:]:
            if not w.startswith("-"):
                return f"{name} {os.path.basename(w)}"
        return name
    return name

def analyze(paths):
    call = defaultdict(float)      # tokens spent writing the command
    res = defaultdict(float)       # tokens returned
    cnt = defaultdict(int)
    seg_cnt = defaultdict(int)     # appearances anywhere in a pipeline
    biggest = []                   # (result_tokens, label, snippet)
    pending = {}                   # tool_use_id -> (label, cmd)

    for p in paths:
        with open(p, errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg = rec.get("message")
                if not isinstance(msg, dict):
                    continue
                content = msg.get("content")
                if not isinstance(content, list):
                    continue

                if msg.get("role") == "assistant":
                    for b in content:
                        if not isinstance(b, dict) or b.get("type") != "tool_use":
                            continue
                        if b.get("name") != "Bash":
                            continue
                        cmd = (b.get("input") or {}).get("command") or ""
                        segs = split_segments(cmd)
                        labels = [l for l in (resolve(s) for s in segs) if l]
                        meaty = [l for l in labels
                                 if l.split()[0] not in TRIVIAL]
                        label = (meaty or labels or ["(cd / no-op)"])[0]
                        for l in dict.fromkeys(labels):
                            seg_cnt[l] += 1
                        call[label] += est(cmd)
                        cnt[label] += 1
                        pending[b.get("id")] = (label, cmd)

                elif msg.get("role") == "user":
                    for b in content:
                        if not isinstance(b, dict) or b.get("type") != "tool_result":
                            continue
                        hit = pending.pop(b.get("tool_use_id"), None)
                        if not hit:
                            continue
                        label, cmd = hit
                        c = b.get("content")
                        if isinstance(c, list):
                            txt = "".join(x.get("text", "") if isinstance(x, dict) else str(x)
                                          for x in c)
                        else:
                            txt = c if isinstance(c, str) else json.dumps(c)
                        t = est(txt)
                        res[label] += t
                        biggest.append((t, label, " ".join(cmd.split())[:88]))
    biggest.sort(reverse=True)
    return call, res, cnt, seg_cnt, biggest

def main():
    argv = sys.argv[1:]
    if argv and argv[0] == "--all":
        paths = glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl"))
    elif argv:
        t = os.path.expanduser(argv[0])
        paths = [t] if t.endswith(".jsonl") else glob.glob(os.path.join(t, "*.jsonl"))
    else:
        slug = os.getcwd().replace("/", "-")
        paths = glob.glob(os.path.expanduser(f"~/.claude/projects/{slug}/*.jsonl"))
    if not paths:
        sys.exit("no transcripts found")

    call, res, cnt, seg_cnt, biggest = analyze(paths)
    total = sum(call.values()) + sum(res.values())
    if not total:
        sys.exit("no Bash calls found")

    rows = sorted(cnt, key=lambda k: -(call[k] + res[k]))
    print(f"\n{sum(cnt.values()):,} Bash calls, ~{int(total):,} tokens total"
          f" (command text + results)\n")
    print(f"{'command':<22}{'calls':>7}{'cmd tok':>10}{'result tok':>12}"
          f"{'total':>11}{'  share':>8}{'avg/call':>10}")
    print("-" * 80)
    shown = 0
    for k in rows[:28]:
        tot = call[k] + res[k]
        shown += tot
        print(f"{k[:21]:<22}{cnt[k]:>7,}{int(call[k]):>10,}{int(res[k]):>12,}"
              f"{int(tot):>11,}{tot/total*100:>7.1f}%{int(tot/cnt[k]):>10,}")
    if len(rows) > 28:
        rest = total - shown
        print(f"{f'... {len(rows)-28} more':<22}{'':>7}{'':>10}{'':>12}"
              f"{int(rest):>11,}{rest/total*100:>7.1f}%")

    fam = defaultdict(float)
    fam_cnt = defaultdict(int)
    for k in cnt:
        f = k.split()[0]
        fam[f] += call[k] + res[k]
        fam_cnt[f] += cnt[k]
    print("\n--- rolled up by family ---")
    for f in sorted(fam, key=lambda x: -fam[x])[:12]:
        print(f"  {f:<14}{fam_cnt[f]:>7,} calls {int(fam[f]):>10,} tok "
              f"{fam[f]/total*100:>6.1f}%")

    print("\n--- worst single results ---")
    for t, label, snip in biggest[:10]:
        print(f"  {int(t):>7,} tok  [{label}]  {snip}")

    print("\n--- output filters (how often results were trimmed) ---")
    for f in ("head", "tail", "grep", "wc", "jq", "awk", "sed", "cut", "sort", "uniq"):
        if seg_cnt.get(f):
            print(f"  {f:<8} appears in {seg_cnt[f]:,} pipelines")
    print()

if __name__ == "__main__":
    main()
