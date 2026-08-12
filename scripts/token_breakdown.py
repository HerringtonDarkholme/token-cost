#!/usr/bin/env python3
"""Break down Claude Code token consumption by source.

Usage:
  token_breakdown.py                       # current project's transcripts
  token_breakdown.py <dir-or-file.jsonl>   # a specific project dir or session
  token_breakdown.py --all                 # every project

Two reports:
  BILLED   - exact, from the `usage` field of each assistant message.
  CONTEXT  - approximate (chars/4), attributing every block of text that
             entered the conversation to its source: each tool's results,
             thinking, assistant prose, your messages.
"""
import json, os, sys, glob
from collections import defaultdict

IMAGE_TOKENS = 1500  # images bill by dimensions; this is a typical screenshot

def est(s):  # rough token estimate; ~4 chars/token for mixed code+prose
    return len(s) / 4

def classify_user_text(t):
    """User-role text is not all typed by the user; separate the injections."""
    if "<system-reminder>" in t:
        return "system-reminder / CLAUDE.md / hooks"
    if t.startswith("This session is being continued"):
        return "compaction summaries (context refills)"
    if "<task-notification>" in t:
        return "subagent task notifications"
    if "<command-name>" in t or "<local-command" in t:
        return "slash-command expansions"
    return "your typed messages"

def text_of(block):
    """Flatten any content block to text for size estimation."""
    if isinstance(block, str):
        return block
    if isinstance(block, list):
        return "".join(text_of(b) for b in block)
    if isinstance(block, dict):
        t = block.get("type")
        if t == "text":
            return block.get("text") or ""
        if t == "thinking":
            return block.get("thinking") or ""
        if t == "tool_use":
            return json.dumps(block.get("input") or {})
        if t == "tool_result":
            return text_of(block.get("content"))
        return json.dumps(block)
    return ""

def analyze(paths):
    billed = defaultdict(int)
    ctx = defaultdict(float)
    counts = defaultdict(int)
    tool_name = {}          # tool_use_id -> name
    models = set()
    n_msgs = 0

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
                role = msg.get("role")
                content = msg.get("content")
                if isinstance(content, str):
                    content = [{"type": "text", "text": content}]
                if not isinstance(content, list):
                    content = []
                n_msgs += 1

                if role == "assistant":
                    if msg.get("model"):
                        models.add(msg["model"])
                    u = msg.get("usage") or {}
                    for k in ("input_tokens", "output_tokens",
                              "cache_read_input_tokens",
                              "cache_creation_input_tokens"):
                        billed[k] += u.get(k) or 0
                    for b in content:
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "thinking":
                            ctx["thinking"] += est(b.get("thinking") or "")
                            counts["thinking"] += 1
                        elif b.get("type") == "text":
                            ctx["assistant prose"] += est(b.get("text") or "")
                        elif b.get("type") == "tool_use":
                            name = b.get("name") or "?"
                            tool_name[b.get("id")] = name
                            ctx[f"tool call: {name}"] += est(json.dumps(b.get("input") or {}))
                            counts[f"tool call: {name}"] += 1

                elif role == "user":
                    for b in content:
                        bt = b.get("type") if isinstance(b, dict) else "text"
                        if bt == "tool_result":
                            name = tool_name.get(b.get("tool_use_id"), "unknown tool")
                            ctx[f"tool result: {name}"] += est(text_of(b.get("content")))
                            counts[f"tool result: {name}"] += 1
                        elif bt == "image":
                            # Images bill by dimensions, NOT base64 length.
                            # ~1,500 tok is a typical full-window screenshot.
                            ctx["images / screenshots"] += IMAGE_TOKENS
                            counts["images / screenshots"] += 1
                        else:
                            t = text_of(b)
                            ctx[classify_user_text(t)] += est(t)
    return billed, ctx, counts, models, n_msgs

def bar(frac, width=24):
    filled = int(round(frac * width))
    return "█" * filled + "·" * (width - filled)

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

    billed, ctx, counts, models, n_msgs = analyze(paths)

    print(f"\n{len(paths)} session(s), {n_msgs} messages"
          + (f"\nmodels: {', '.join(sorted(models))}" if models else ""))

    print("\n=== BILLED (exact, summed over every API request) ===")
    total_in = (billed["input_tokens"] + billed["cache_read_input_tokens"]
                + billed["cache_creation_input_tokens"])
    for label, key in [("fresh input", "input_tokens"),
                       ("cache read", "cache_read_input_tokens"),
                       ("cache write", "cache_creation_input_tokens")]:
        v = billed[key]
        pct = v / total_in * 100 if total_in else 0
        print(f"  {label:<14}{v:>12,}  {pct:5.1f}%")
    print(f"  {'TOTAL input':<14}{total_in:>12,}")
    print(f"  {'output':<14}{billed['output_tokens']:>12,}   (thinking + prose + tool-call args)")

    # Thinking text is not persisted to the transcript (only its signature),
    # so derive it: output = thinking + prose + tool-call args.
    visible_out = ctx["assistant prose"] + sum(
        v for k, v in ctx.items() if k.startswith("tool call: "))
    derived_thinking = billed["output_tokens"] - visible_out
    if derived_thinking > 0:
        print(f"\n  output breakdown:")
        print(f"    {'prose':<20}{int(ctx['assistant prose']):>10,}")
        print(f"    {'tool-call args':<20}{int(visible_out - ctx['assistant prose']):>10,}")
        print(f"    {'thinking (derived)':<20}{int(derived_thinking):>10,}"
              f"  {derived_thinking / billed['output_tokens'] * 100:.0f}% of output"
              f"  ×{counts['thinking']} blocks")

    print("\n=== CONTEXT COMPOSITION (approx, chars/4) ===")
    total = sum(ctx.values()) or 1
    for k, v in sorted(ctx.items(), key=lambda kv: -kv[1]):
        c = counts.get(k)
        n = f"  ×{c}" if c else ""
        print(f"  {bar(v/total)} {v/total*100:5.1f}%  {int(v):>9,}  {k}{n}")
    print(f"  {'':24} {100.0:5.1f}%  {int(total):>9,}  TOTAL conversation content")
    print("\nNote: cache read >> fresh input is healthy — it means the growing")
    print("prefix is being reused, not re-billed at full price.\n")

if __name__ == "__main__":
    main()
