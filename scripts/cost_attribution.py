#!/usr/bin/env python3
"""Attribute Claude Code dollar spend to what caused it.

Usage:
  cost_attribution.py [<dir-or-file.jsonl> | --all] [--ttl 5m|1h]

Method
------
Billing is per-request: each request bills the ENTIRE input prefix (as fresh
input, cache read, or cache write) plus its own output. So the cost of a piece
of content is not its face value -- it is its token share of every subsequent
request it survives in ("carry cost").

For each request we compute the exact billed cost from the `usage` field, then
allocate it across the content already in context, proportional to token share.
Summing over requests gives per-category dollars that add up to the real bill.

Input-side allocation is exact in total, approximate in split (content sizes
are chars/4 estimates). Output-side uses exact output_tokens.
"""
import json, os, sys, glob
from collections import defaultdict

# $ per 1M tokens: model -> (input, output). Cache read = input * 0.1.
# Cache write = input * 1.25 (5m TTL) or * 2.0 (1h TTL).
PRICES = {
    "claude-fable-5":   (10.0, 50.0),
    "claude-mythos-5":  (10.0, 50.0),
    "claude-opus-5":    (5.0,  25.0),
    "claude-opus-4-8":  (5.0,  25.0),
    "claude-opus-4-7":  (5.0,  25.0),
    "claude-opus-4-6":  (5.0,  25.0),
    "claude-opus-4-5":  (5.0,  25.0),
    "claude-sonnet-5":  (3.0,  15.0),
    "claude-sonnet-4-6":(3.0,  15.0),
    "claude-sonnet-4-5":(3.0,  15.0),
    "claude-haiku-4-5": (1.0,   5.0),
}
CACHE_READ_MULT = 0.1
IMAGE_TOKENS = 1500  # images bill by dimensions, not base64 length

def price(model):
    """Resolve a transcript model string to (input, output) $/1M."""
    if not model or model == "<synthetic>":
        return None
    m = model.split("[")[0]                      # strip "[1m]" context suffix
    if m in PRICES:
        return PRICES[m]
    for k, v in PRICES.items():                  # dated snapshots
        if m.startswith(k):
            return v
    return None

def est(s):
    return len(s) / 4

def text_of(block):
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
        if t == "image":
            return ""                            # never char-count base64
        return json.dumps(block)
    return ""

def classify_user_text(t):
    if "<system-reminder>" in t:
        return "system reminders / CLAUDE.md"
    if t.startswith("This session is being continued"):
        return "compaction summaries"
    if "<task-notification>" in t:
        return "subagent notifications"
    return "your typed messages"

def attribute(paths, write_mult):
    cost = defaultdict(float)       # category -> dollars
    toks = defaultdict(float)       # category -> tokens-in-context (peak share)
    billed = defaultdict(float)
    unpriced = defaultdict(int)
    n_req = 0

    for p in paths:
        # Per-session state: context composition as it accumulates.
        ctx = defaultdict(float)
        tool_name = {}
        preamble = None   # measured once, from this session's first request
        for line in open(p, errors="replace"):
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
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            if not isinstance(content, list):
                content = []

            if msg.get("role") == "assistant":
                pr = price(msg.get("model"))
                u = msg.get("usage") or {}
                inp = u.get("input_tokens") or 0
                cr = u.get("cache_read_input_tokens") or 0
                cw = u.get("cache_creation_input_tokens") or 0
                out = u.get("output_tokens") or 0
                ctx_tokens = inp + cr + cw

                if pr and ctx_tokens:
                    n_req += 1
                    p_in, p_out = pr
                    in_cost = (inp * p_in
                               + cr * p_in * CACHE_READ_MULT
                               + cw * p_in * write_mult) / 1e6
                    out_cost = out * p_out / 1e6
                    billed["input"] += in_cost
                    billed["output"] += out_cost

                    # --- allocate this request's INPUT cost ---
                    # The fixed preamble (system prompt + tool schemas + memory
                    # files) is measured ONCE, from the first request, where
                    # almost no conversation exists yet. Holding it fixed
                    # afterwards matters: chars/4 undercounts real content, and
                    # if the preamble absorbed that whole shortfall it would
                    # grow without bound and swallow the report.
                    mine = sum(ctx.values())
                    if preamble is None:
                        preamble = max(0.0, ctx_tokens - mine)
                    shares = dict(ctx)
                    body = max(0.0, ctx_tokens - preamble)
                    if mine > 0:
                        # Scale tracked content to fill the real context size,
                        # so estimation error lands on content proportionally.
                        f = body / mine
                        shares = {k: v * f for k, v in shares.items()}
                    pre = min(preamble, ctx_tokens)
                    if pre > 0:
                        shares["system prompt + tool schemas"] = pre
                    total = sum(shares.values()) or 1.0
                    for k, v in shares.items():
                        cost[k] += in_cost * (v / total)
                        toks[k] = max(toks[k], v)

                    # --- allocate this request's OUTPUT cost ---
                    prose = est("".join(b.get("text") or ""
                                        for b in content
                                        if isinstance(b, dict) and b.get("type") == "text"))
                    args = est("".join(json.dumps(b.get("input") or {})
                                       for b in content
                                       if isinstance(b, dict) and b.get("type") == "tool_use"))
                    # Thinking text isn't persisted; derive it as the remainder.
                    think = max(0.0, out - prose - args)
                    denom = prose + args + think
                    if denom > 0:
                        cost["OUTPUT: thinking"] += out_cost * think / denom
                        cost["OUTPUT: assistant prose"] += out_cost * prose / denom
                        cost["OUTPUT: tool-call args"] += out_cost * args / denom
                elif ctx_tokens:
                    unpriced[msg.get("model") or "?"] += 1

                # This message now becomes part of the context.
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "text":
                        ctx["assistant prose"] += est(b.get("text") or "")
                    elif b.get("type") == "tool_use":
                        name = b.get("name") or "?"
                        tool_name[b.get("id")] = name
                        ctx[f"tool call: {name}"] += est(json.dumps(b.get("input") or {}))

            elif msg.get("role") == "user":
                for b in content:
                    bt = b.get("type") if isinstance(b, dict) else "text"
                    if bt == "tool_result":
                        name = tool_name.get(b.get("tool_use_id"), "unknown tool")
                        ctx[f"tool result: {name}"] += est(text_of(b.get("content")))
                    elif bt == "image":
                        ctx["images / screenshots"] += IMAGE_TOKENS
                    else:
                        ctx[classify_user_text(text_of(b))] += est(text_of(b))
    return cost, toks, billed, unpriced, n_req

def main():
    argv = sys.argv[1:]
    ttl = "1h"
    if "--ttl" in argv:
        i = argv.index("--ttl")
        ttl = argv[i + 1]
        del argv[i:i + 2]
    write_mult = 2.0 if ttl == "1h" else 1.25

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

    cost, toks, billed, unpriced, n_req = attribute(paths, write_mult)
    total = billed["input"] + billed["output"]
    if not total:
        sys.exit("no priced requests found")

    print(f"\n{len(paths)} session(s), {n_req:,} API requests"
          f"   (cache-write multiplier {write_mult}x, {ttl} TTL)")
    print(f"\nTOTAL BILLED  ${total:,.2f}"
          f"    input ${billed['input']:,.2f}"
          f"  ·  output ${billed['output']:,.2f}")
    if unpriced:
        skipped = ", ".join(f"{m} x{n}" for m, n in unpriced.items())
        print(f"  (unpriced models skipped: {skipped})")

    print(f"\n{'what you paid for':<46}{'cost':>10}{'share':>8}{'peak ctx tok':>14}")
    print("-" * 78)
    for k, v in sorted(cost.items(), key=lambda kv: -kv[1]):
        if v < total * float(os.environ.get("MIN_SHARE", "0.0005")):
            continue
        t = f"{int(toks[k]):,}" if toks.get(k) else "-"
        print(f"{k[:45]:<46}${v:>9,.2f}{v / total * 100:>7.1f}%{t:>14}")
    print("-" * 78)
    print(f"{'TOTAL':<46}${total:>9,.2f}")
    print("\nInput dollars are allocated per request by token share, so a big")
    print("tool result costs more the longer it stays in context. Totals are")
    print("exact; the split across categories is approximate (chars/4).\n")

if __name__ == "__main__":
    main()
