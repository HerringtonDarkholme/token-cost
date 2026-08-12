/* Cost attribution engine for Claude Code transcripts. Runs entirely client-side.
 *
 * METHOD -- "carry cost". Billing is per request, and each request bills the ENTIRE
 * input prefix (fresh input + cache read + cache write) plus its own output. So a piece
 * of content does not cost its face value; it costs its token share of every subsequent
 * request it survives in. For each request we take the exact billed cost from `usage`,
 * then allocate it across the content already in context, proportional to token share.
 * Totals are exact; the split across rows is an estimate.
 *
 * DESIGN RULES -- this file must work for transcripts it has never seen:
 *   1. Nothing is silently dropped. An unknown model, tool, tag or command is counted
 *      and surfaced, never skipped.
 *   2. Buckets are structured records ({role, tool, dir, sub}), never strings that get
 *      re-parsed by character offset.
 *   3. Classification is derived from the data (measured ratios, learned vocabulary,
 *      calibrated constants) or from a documented, published spec (POSIX shell
 *      builtins, the Anthropic rate card, the transcript schema). It is never a list
 *      of the things one particular author happens to use.
 *
 * PASSES
 *   scan()      -- cheap: calibrate chars-per-token, learn which programs dispatch
 *                  subcommands, dedupe sessions.
 *   allocate()  -- full walk: build the per-key cost accumulators.
 *   price()     -- O(keys), so any TTL assumption or rate card is free to re-apply.
 *   buildTree() -- decides direction splits and grouping from the measured costs.
 */

/* ------------------------------------------------------------------ pricing --
 * A rate card, not a model whitelist. Keys are matched exactly, then by longest
 * prefix, then by tier keyword; anything still unresolved is reported as unpriced
 * rather than dropped. Rates are $ per 1M tokens, [input, output].
 * Override or extend at runtime with setRates() -- no source edit required.
 */
export const RATES = {
  "claude-fable-5":    [10, 50],
  "claude-mythos-5":   [10, 50],
  "claude-opus-5":     [5, 25],
  "claude-opus-4":     [5, 25],     // 4, 4-5, 4-6, 4-7, 4-8 all share this rate
  "claude-sonnet-5":   [3, 15],
  "claude-sonnet-4":   [3, 15],
  "claude-haiku-4":    [1, 5],
  "claude-3-opus":     [15, 75],    // legacy 3.x cards differ from their tier default
  "claude-3-5-sonnet": [3, 15],
  "claude-3-7-sonnet": [3, 15],
  "claude-3-5-haiku":  [0.8, 4],
  "claude-3-haiku":    [0.25, 1.25],
  "claude-2":          [8, 24],
};
/* Last resort before giving up: the tier word implies the current rate for that tier. */
const TIERS = [[/\bopus\b|opus/, [5, 25]], [/sonnet/, [3, 15]], [/haiku/, [1, 5]],
               [/fable|mythos/, [10, 50]]];

export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_MULT = { "1h": 2.0, "5m": 1.25 };

export function setRates(partial) { Object.assign(RATES, partial); }

/** Strip the decorations cloud vendors and release dates add, so one card serves all. */
export function normalizeModel(id) {
  let m = String(id || "").toLowerCase().trim();
  m = m.replace(/\[[^\]]*\]/g, "");                 // context-window suffix: [1m]
  m = m.replace(/^publishers\/anthropic\/models\//, "");  // Vertex AI
  // Bedrock stacks these: "us.anthropic.claude-…" is a region prefix on a vendor prefix.
  for (let prev = null; prev !== m; ) {
    prev = m;
    m = m.replace(/^(anthropic|us|eu|apac|global|gov)\./, "");
  }
  m = m.replace(/[:@]\d+(\.\d+)?$/, "");            // :0, @1
  m = m.replace(/-v\d+$/, "");                      // -v1
  m = m.replace(/[-@](\d{8}|\d{6})$/, "");          // -20250219 / @250219
  m = m.replace(/-latest$/, "");
  return m.replace(/-+$/, "");
}

/** @returns {{rate:[number,number]|null, basis:string, id:string}} -- never throws,
 *  never returns undefined. `basis` explains the match so the UI can show its work. */
export function resolveRate(model) {
  const raw = String(model || "");
  if (!raw) return { rate: null, basis: "missing", id: raw };
  // Claude Code writes <synthetic> for records it produced locally with no API call.
  if (raw.startsWith("<")) return { rate: null, basis: "synthetic", id: raw };
  const id = normalizeModel(raw);
  if (RATES[id]) return { rate: RATES[id], basis: "exact", id };
  let best = null;
  for (const k of Object.keys(RATES)) {
    if (id.startsWith(k) && (!best || k.length > best.length)) best = k;
  }
  if (best) return { rate: RATES[best], basis: "prefix:" + best, id };
  for (const [re, rate] of TIERS) if (re.test(id)) return { rate, basis: "tier", id };
  return { rate: null, basis: "unpriced", id };
}

/* ------------------------------------------------------- shell interpretation --
 * The sets below are the shell language, not a taste list: POSIX special builtins
 * and reserved words. Everything program-specific (which commands take subcommands,
 * which ones matter) is learned from the corpus in scan().
 */
const KEYWORDS = new Set(["for","while","until","if","elif","case","esac","select",
  "function","do","done","then","else","fi","in","{","}","[[","]]","time"]);
/** Builtins that only change shell state -- they are never "the command that ran". */
const STATE_ONLY = new Set(["cd","export","set","unset","shopt","alias","unalias","pushd",
  "popd","dirs","umask","local","readonly","declare","typeset","source",".","eval","trap",
  "hash","ulimit","shift","getopts","let"]);
/** Builtins that exec another command in place -- transparent, skip to the real one. */
const EXEC_WRAPPERS = new Set(["sudo","doas","env","nohup","command","builtin","exec",
  "time","timeout","stdbuf","nice","ionice","setsid","unbuffer","script","xargs","watch"]);
/** Builtins that emit but do no work -- outranked by any external command present. */
const NO_WORK = new Set(["echo","printf","true","false",":","test","[","read","wait",
  "times","sleep","pwd","type","jobs","kill","trap"]);

/** Split a shell string on top-level | || && ; and newlines, honouring quotes,
 *  parens/brackets/braces, and skipping heredoc bodies entirely. */
export function splitSegments(cmd) {
  const segs = []; let buf = "", i = 0, quote = null, depth = 0, pending = null;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i];
    if (quote) {
      if (c === "\\" && quote === '"') { buf += cmd.slice(i, i + 2); i += 2; continue; }
      if (c === quote) quote = null;
      buf += c; i++; continue;
    }
    if (c === "'" || c === '"') { quote = c; buf += c; i++; continue; }
    // `<<TAG` only *arms* a heredoc: the rest of THIS line is still part of the pipeline
    // (`cat <<EOF | grep x`), and the body starts at the next newline. Recording it as
    // pending keeps both halves right; consuming the line immediately loses the pipe, and
    // resuming into the same buffer afterwards silently welds the next command onto this
    // one (which is how `python3 - <<PY … PY` + `grep foo` became "python3 grep").
    if (cmd.startsWith("<<", i) && cmd[i + 2] !== "<") {
      let j = i + 2; if (cmd[j] === "-") j++;
      while (j < n && /\s/.test(cmd[j])) j++;
      let q = null; if (cmd[j] === "'" || cmd[j] === '"') { q = cmd[j]; j++; }
      let tag = "";
      while (j < n && (/[\w-]/.test(cmd[j]) || (q && cmd[j] !== q))) { tag += cmd[j]; j++; }
      if (q && cmd[j] === q) j++;
      if (tag) { pending = tag; i = j; continue; }
    }
    if (c === "(" || c === "[" || c === "{") { depth++; buf += c; i++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth = Math.max(0, depth - 1); buf += c; i++; continue; }
    if (depth === 0) {
      if (cmd.startsWith("&&", i) || cmd.startsWith("||", i)) { segs.push(buf); buf = ""; i += 2; continue; }
      if (c === "|" || c === ";") { segs.push(buf); buf = ""; i++; continue; }
      if (c === "\n") {
        segs.push(buf); buf = ""; i++;
        if (pending !== null) {                   // skip the heredoc body, then carry on
          while (i < n) {
            const nl = cmd.indexOf("\n", i);
            const line = cmd.slice(i, nl === -1 ? n : nl).trim();
            i = nl === -1 ? n : nl + 1;
            if (line === pending) break;
          }
          pending = null;
        }
        continue;
      }
    }
    buf += c; i++;
  }
  segs.push(buf);
  return segs.map(s => s.trim()).filter(Boolean);
}

/** Could this word be a subcommand verb? A bare lowercase-ish token -- not a flag,
 *  path, filename, number, URL or variable. Whether it IS one is decided by scan(). */
function isVerbShaped(w) {
  return !!w && w.length <= 24 && /^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$/.test(w)
      && !/^\d/.test(w) && !KEYWORDS.has(w);
}

/** Resolve one pipeline segment.
 *  @returns {{prog:string, verb:string|null, rank:number}|null}
 *  rank orders candidates for labelling a whole invocation: 0 = external command
 *  (real work), 1 = builtin that emits but does no work, 2 = state-only builtin. */
export function resolveSegment(seg) {
  const words = seg.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words[0].startsWith("#")) return null;   // comment line
  let idx = 0, wrapped = false;
  while (idx < words.length) {
    const w = words[idx];
    if (/^[A-Za-z_]\w*=/.test(w)) { idx++; continue; }        // VAR=value prefix
    if (EXEC_WRAPPERS.has(w)) { idx++; wrapped = true; continue; }   // sudo/env/timeout/...
    if (KEYWORDS.has(w)) return null;                         // control flow, not a command
    // A wrapper takes its own options before the command it execs: `timeout 5 kubectl`,
    // `xargs -n1 grep`, `nice -n10 cargo`. Skip flags and duration/count values.
    // (A flag whose value is a bare word -- `sudo -u alice cmd` -- still resolves to the
    // value; that needs per-wrapper arity, so it is reported as-is rather than guessed.)
    if (wrapped && (w.startsWith("-") || /^\d+(\.\d+)?[smhd]?$/.test(w))) { idx++; continue; }
    break;
  }
  if (idx >= words.length) return null;
  let prog = words[idx].split("/").pop().replace(/^[$(]+/, "").replace(/^["']|["']$/g, "");
  if (!prog || prog.startsWith("-") || prog.startsWith("$")) return null;
  const rank = STATE_ONLY.has(prog) ? 2 : NO_WORK.has(prog) ? 1 : 0;
  let verb = null;
  for (const w of words.slice(idx + 1)) {
    if (w.startsWith("-")) continue;                          // flags are not verbs
    if (isVerbShaped(w)) verb = w;
    break;                                                    // only the first operand
  }
  return { prog, verb, rank };
}

/** Every (program, candidate-verb) pair a Bash invocation contains -- the raw material
 *  scan() aggregates to learn which programs actually dispatch subcommands. */
export function shellCandidates(cmd) {
  return splitSegments(cmd).map(resolveSegment).filter(Boolean);
}

/** Label an invocation: pick the segment doing real work, then apply the learned
 *  vocabulary to decide whether its second token is a subcommand.
 *  @param {Set<string>} dispatchers programs scan() observed dispatching subcommands */
export function labelShell(cmd, dispatchers) {
  const cands = shellCandidates(cmd);
  if (!cands.length) return { prog: "(no command)", verb: null };
  let pick = cands[0];
  for (const c of cands) if (c.rank < pick.rank) pick = c;    // lowest rank wins
  const verb = (pick.verb && dispatchers && dispatchers.has(pick.prog)) ? pick.verb : null;
  return { prog: pick.prog, verb };
}

/* ------------------------------------------------------------- content sizing --
 * Token counts are estimated from character length. The divisor is CALIBRATED per
 * dataset rather than assumed, using an identity that holds exactly:
 *
 *   Δ(context tokens) between consecutive requests
 *     = the previous turn's output_tokens  +  the user-side content added since
 *
 * The first term is reported exactly by `usage`, so subtracting it isolates content
 * that IS fully persisted in the transcript (tool results and typed text) from content
 * that is not (thinking text, which is replaced by a signature). Regressing against the
 * raw delta instead charges invisible thinking tokens to visible characters and lands
 * near 2.2 chars/token -- below anything real text can be.
 *
 * TWO densities, not one. Machine text (tool output, JSON arguments, source) tokenises
 * far denser than prose, so a single constant is wrong for one of them no matter which
 * value it takes. Each interval contributes one equation
 *
 *   userTokens = codeChars * a  +  textChars * b        (a = 1/density, per class)
 *
 * and the whole dataset is solved for [a, b] by least squares. Falls back to a pooled
 * single density when there is not enough of one class to identify both.
 */
const CPT_FALLBACK = 4.0, CPT_MIN = 1.5, CPT_MAX = 12.0;
const clampCpt = v => Math.min(CPT_MAX, Math.max(CPT_MIN, v));

/** Least squares for userTokens = code*a + text*b, returned as densities (chars/token).
 *
 *  Whether the two classes can be told apart is decided by the STANDARD ERROR of each
 *  fitted coefficient, not by a threshold on how much of each class happens to be
 *  present. If one class is too sparse or too collinear with the other to pin down, its
 *  error bar blows up and the fit is rejected in favour of a single pooled density --
 *  automatically, and for the actual reason. A share-of-corpus floor would instead reject
 *  perfectly identifiable fits (this was measured: a corpus with only 3% prose still
 *  yields collinearity of 0.0004, i.e. cleanly separable).
 *
 *  Note there is no assumption about which class is denser. Harness-injected "text" is
 *  often markdown and config rather than prose, and does measure denser than tool output
 *  in some corpora; encoding a prior about that would just be another hardcoded opinion.
 */
const MAX_REL_SE = 0.25;
function solveDensities(S) {
  const { cc, ct, tt, cy, ty, yy, n, code, text, tok } = S;
  if (n < 20 || tok <= 0) return null;
  const pooled = clampCpt((code + text) / tok);
  const fallback = { code: pooled, text: pooled, basis: "pooled", pooled, relSE: null };
  const det = cc * tt - ct * ct;
  if (!(det > 0)) return fallback;

  const a = (cy * tt - ty * ct) / det, b = (ty * cc - cy * ct) / det;
  if (!(a > 0) || !(b > 0)) return fallback;
  // Residual sum of squares, then the usual (X'X)^-1 * sigma^2 coefficient variances.
  const rss = yy - 2 * a * cy - 2 * b * ty + a * a * cc + 2 * a * b * ct + b * b * tt;
  if (!(rss >= 0) || n <= 2) return fallback;
  const s2 = rss / (n - 2);
  const seA = Math.sqrt(s2 * tt / det), seB = Math.sqrt(s2 * cc / det);
  const relSE = [seA / a, seB / b];
  if (relSE[0] > MAX_REL_SE || relSE[1] > MAX_REL_SE) return fallback;
  return { code: clampCpt(1 / a), text: clampCpt(1 / b),
           basis: "least-squares", pooled, relSE };
}

/** Characters of billable text in a content block. Images are excluded here and
 *  sized separately -- they bill by pixel dimensions, so their base64 length is
 *  meaningless (counting it once inflated a run by 40%). */
export function charsOf(block) {
  if (typeof block === "string") return block.length;
  if (Array.isArray(block)) return block.reduce((n, b) => n + charsOf(b), 0);
  if (!block || typeof block !== "object") return 0;
  switch (block.type) {
    case "text":        return (block.text || "").length;
    case "thinking":    return (block.thinking || "").length;
    case "redacted_thinking": return (block.data || "").length;
    case "tool_use":    return JSON.stringify(block.input || {}).length;
    case "tool_result": return charsOf(block.content);
    case "image":       return 0;
    case "document":    return 0;
    default:            return JSON.stringify(block).length;
  }
}
function textOf(block) {
  if (typeof block === "string") return block;
  if (Array.isArray(block)) return block.map(textOf).join("");
  if (!block || typeof block !== "object") return "";
  if (block.type === "text") return block.text || "";
  if (block.type === "tool_result") return textOf(block.content);
  return "";
}

/* Image tokens from real dimensions. Anthropic bills roughly (w*h)/750 tokens and caps
 * long edges at 1568px, so a decoded header beats any flat constant. Only the first few
 * KB are decoded; unparseable or absent data falls back to a mid-size estimate. */
const IMAGE_FALLBACK = 1500, IMAGE_CAP = 1600;
function b64Bytes(data, limit) {
  try {
    const clean = String(data).replace(/^data:[^,]*,/, "").replace(/[^A-Za-z0-9+/=]/g, "");
    const slice = clean.slice(0, Math.ceil(limit / 3) * 4);
    const bin = (typeof atob === "function") ? atob(slice.replace(/=+$/, ""))
      : Buffer.from(slice, "base64").toString("binary");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
export function imageDims(b) {
  const src = (b && b.source) || {};
  if (src.type === "url" || !src.data) return null;
  const B = b64Bytes(src.data, 65536);
  if (!B || B.length < 24) return null;
  const be16 = i => (B[i] << 8) | B[i + 1], be32 = i => (B[i] << 24 | B[i + 1] << 16 | B[i + 2] << 8 | B[i + 3]) >>> 0;
  if (B[0] === 0x89 && B[1] === 0x50) return { w: be32(16), h: be32(20) };            // PNG IHDR
  if (B[0] === 0x47 && B[1] === 0x49) return { w: B[6] | B[7] << 8, h: B[8] | B[9] << 8 }; // GIF
  if (B[0] === 0xFF && B[1] === 0xD8) {                                               // JPEG: find SOFn
    let i = 2;
    while (i + 9 < B.length) {
      if (B[i] !== 0xFF) { i++; continue; }
      const mk = B[i + 1];
      if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC)
        return { h: be16(i + 5), w: be16(i + 7) };
      if (mk === 0xD8 || (mk >= 0xD0 && mk <= 0xD9)) { i += 2; continue; }
      i += 2 + be16(i + 2);
    }
    return null;
  }
  if (B[8] === 0x57 && B[9] === 0x45 && B[10] === 0x42 && B[11] === 0x50) {            // WEBP
    const le16 = i => B[i] | B[i + 1] << 8;
    if (B[15] === 0x58) return { w: (B[24] | B[25] << 8 | B[26] << 16) + 1, h: (B[27] | B[28] << 8 | B[29] << 16) + 1 };
    if (B[15] === 0x20) return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    return null;
  }
  return null;
}
function imageTokens(b) {
  const d = imageDims(b);
  if (!d || !d.w || !d.h || d.w > 20000 || d.h > 20000) return IMAGE_FALLBACK;
  const scale = Math.min(1, 1568 / Math.max(d.w, d.h));       // long edge is clamped
  return Math.max(1, Math.min(IMAGE_CAP, Math.round(d.w * scale * d.h * scale / 750)));
}

/* -------------------------------------------------------------------- records --
 * A bucket is a record, and its key is derived from the record. Nothing downstream
 * parses a label by character offset.
 *   role: preamble | harness | typed | assistant | tool | image
 *   dir : call | result   (tools only)
 */
const keyOf = r => [r.role, r.tool || "", r.dir || "", r.sub || "", r.kind || ""].join(" ");

/** Harness-injected user content, identified structurally where the schema allows and
 *  by its own wrapper tag otherwise -- so an unfamiliar tag becomes its own row instead
 *  of being misfiled as something the human typed. */
const TAG_SPAN = /<([a-z][a-z0-9_-]*)>([\s\S]*?)<\/\1>/gi;
const TAG_OPEN = /^\s*<([a-z][a-z0-9_-]*)>/i;

/** Split one user block into harness-injected spans and whatever is left, which is what
 *  the human actually typed. Returns [{role, sub, chars}].
 *
 *  Injected content is not always the whole block: a harness routinely appends reminders
 *  after a typed message, so matching only a tag at position 0 charges those characters to
 *  the human. Tag names are read out of the text rather than compared against a list, so a
 *  wrapper this build has never seen still gets its own row. */
export function classifyUserBlock(text, rec) {
  if (rec && rec.isCompactSummary === true)
    return [{ role: "harness", sub: "compaction summary", chars: text.length }];
  const out = [];
  let covered = 0;
  TAG_SPAN.lastIndex = 0;
  for (let m; (m = TAG_SPAN.exec(text)); ) {
    out.push({ role: "harness", sub: "<" + m[1].toLowerCase() + ">", chars: m[0].length });
    covered += m[0].length;
  }
  const rest = text.length - covered;
  if (rest > 0) {
    // An unterminated wrapper still identifies the block it opens.
    const open = out.length ? null : TAG_OPEN.exec(text);
    if (open) out.push({ role: "harness", sub: "<" + open[1].toLowerCase() + ">", chars: rest });
    else if (rec && rec.isMeta === true) out.push({ role: "harness", sub: "harness metadata", chars: rest });
    else out.push({ role: "typed", sub: null, chars: rest });
  }
  return out;
}

/** A tool's input often carries a natural sub-key. Detected by FIELD SHAPE, not by
 *  tool name, so it works for a shell tool or file tool nobody has registered:
 *    - a `command`-ish string  -> the program (and subcommand) it runs
 *    - a path-ish string       -> the file extension
 *  Returns {sub, shell} where shell marks command-running tools. */
const PATH_FIELDS = ["file_path", "filePath", "path", "notebook_path", "notebookPath", "file"];
function subKeyOf(input, dispatchers) {
  if (!input || typeof input !== "object") return { sub: null, shell: false };
  for (const f of ["command", "cmd", "script", "shell_command"]) {
    if (typeof input[f] === "string" && input[f].trim()) {
      const { prog, verb } = labelShell(input[f], dispatchers);
      return { sub: verb ? prog + " " + verb : prog, shell: true };
    }
  }
  for (const f of PATH_FIELDS) {
    if (typeof input[f] === "string" && input[f].trim()) {
      const base = input[f].split(/[\\/]/).pop() || "";
      const dot = base.lastIndexOf(".");
      const ext = dot > 0 ? base.slice(dot).toLowerCase() : "(no extension)";
      return { sub: ext.length <= 12 ? "*" + ext : "(other)", shell: false };
    }
  }
  return { sub: null, shell: false };
}

/** Display name for a tool. MCP's `mcp__<server>__<tool>` is a protocol convention,
 *  so it is parsed generically -- no gateway-specific prefix is stripped by name. */
export function toolDisplay(tool) {
  if (!tool.startsWith("mcp__")) return tool;
  const p = tool.split("__").filter(Boolean);
  return p.length >= 3 ? `${p[1]} · ${p.slice(2).join("__")}` : tool;
}

/* --------------------------------------------------------------------- pass 1 --
 * Cheap scan: dedupe sessions, calibrate chars-per-token, learn which programs
 * dispatch subcommands.
 */
const SESSION_RE = /"sessionId"\s*:\s*"([^"]+)"/;

/* Which programs dispatch subcommands is LEARNED, because any list of them is a list of
 * one author's toolchain. Three properties separate a real multiplexer from a program
 * that merely takes an argument, and all three are needed:
 *
 *   coverage  -- `git`/`docker`/`poetry` are called with a verb-shaped first operand
 *                nearly every time. `ls`, `rm`, `find`, `grep` are usually given a path,
 *                glob, quoted string or flag instead, so their coverage is low.
 *   repetition-- a verb vocabulary is closed and reused: distinct/observed is tiny for
 *                `git` (~10 verbs over hundreds of calls) and near 1.0 for `grep`, whose
 *                operand is a different search pattern almost every time.
 * State-only and no-work builtins (`cd`, `echo`) are excluded outright: their operand is
 * a path or a string, never a subcommand.
 *
 * Both thresholds are scale-free ratios on purpose. An absolute cap on vocabulary size
 * would be one more arbitrary constant, and it misfires immediately: `git` is used with 42
 * distinct subcommands in the corpus this was tested on, so a "max 40 verbs" rule would
 * reject the most obvious dispatcher there is.
 */
const DISPATCH_MIN_CALLS = 5, DISPATCH_MIN_COVERAGE = 0.6, DISPATCH_MAX_RATIO = 0.5;

export function scan(files) {
  const seen = new Set(), kept = [];
  let duplicatesDropped = 0;
  for (const f of files) {
    const m = SESSION_RE.exec(f.text || "");
    const id = (m ? m[1] : f.name) + "::" + (f.text || "").length;
    if (seen.has(id)) { duplicatesDropped++; continue; }
    seen.add(id); kept.push(f);
  }

  const verbs = new Map();      // prog -> {calls, withVerb, set:Set<verb>}
  // Accumulators for the two-class least-squares fit described above.
  const S = { cc: 0, ct: 0, tt: 0, cy: 0, ty: 0, yy: 0, n: 0, code: 0, text: 0, tok: 0 };
  let badLines = 0;

  for (const f of kept) {
    let prevTokens = null, prevOut = 0, codeChars = 0, textChars = 0, dirty = false;
    for (const line of f.text.split("\n")) {
      const s = line.trim(); if (!s) continue;
      let rec; try { rec = JSON.parse(s); } catch { badLines++; continue; }
      const msg = rec && rec.message;
      if (!msg || typeof msg !== "object") continue;
      let content = msg.content;
      if (typeof content === "string") content = [{ type: "text", text: content }];
      if (!Array.isArray(content)) content = [];

      if (msg.role === "assistant") {
        const u = msg.usage || {};
        const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0)
                     + (u.cache_creation_input_tokens || 0);
        if (tokens) {
          // Δcontext − previous output_tokens == tokens for the user-side content we
          // can actually measure. Anything invisible is accounted for by the first term.
          const chars = codeChars + textChars;
          if (prevTokens !== null && !dirty && chars > 400) {
            const y = tokens - prevTokens - prevOut;
            // Keep only physically plausible observations; a delta outside this band
            // means the prefix was rewritten, not appended to.
            if (y > 50 && chars / y >= CPT_MIN / 2 && chars / y <= CPT_MAX * 2) {
              const c = codeChars, t = textChars;
              S.cc += c * c; S.ct += c * t; S.tt += t * t;
              S.cy += c * y; S.ty += t * y; S.yy += y * y;
              S.code += c; S.text += t; S.tok += y; S.n++;
            }
          }
          prevTokens = tokens; prevOut = u.output_tokens || 0;
          codeChars = 0; textChars = 0; dirty = false;
        }
        for (const b of content) {
          if (!b || typeof b !== "object") continue;
          if (b.type === "tool_use") {
            const inp = b.input || {};
            for (const fld of ["command", "cmd", "script", "shell_command"]) {
              if (typeof inp[fld] !== "string") continue;
              for (const c of shellCandidates(inp[fld])) {
                if (c.rank !== 0) continue;              // builtins never dispatch
                if (!verbs.has(c.prog)) verbs.set(c.prog, { calls: 0, withVerb: 0, set: new Set() });
                const e = verbs.get(c.prog);
                e.calls++;
                if (c.verb) { e.withVerb++; e.set.add(c.verb); }
              }
              break;
            }
          }
        }
      } else if (msg.role === "user") {
        // Compaction rewrites the prefix, so deltas across it are not calibration data.
        if (rec.isCompactSummary === true) dirty = true;
        for (const b of content) {
          if (!b || typeof b !== "object") { textChars += charsOf(b); continue; }
          if (b.type === "image") { dirty = true; continue; }
          // Tool output is machine text; what a person (or the harness) writes is prose.
          if (b.type === "tool_result") codeChars += charsOf(b);
          else textChars += charsOf(b);
        }
      }
    }
  }

  const dispatchers = new Set();
  for (const [prog, e] of verbs) {
    if (e.calls < DISPATCH_MIN_CALLS || e.set.size < 2) continue;
    if (e.withVerb / e.calls < DISPATCH_MIN_COVERAGE) continue;
    if (e.set.size / e.withVerb > DISPATCH_MAX_RATIO) continue;
    dispatchers.add(prog);
  }
  const fit = solveDensities(S);
  return { files: kept, duplicatesDropped, badLines, dispatchers,
           density: fit || { code: CPT_FALLBACK, text: CPT_FALLBACK,
                             basis: "default", pooled: CPT_FALLBACK },
           densitySamples: S.n, densityCalibrated: !!fit };
}

/* --------------------------------------------------------------------- pass 2 --
 * Allocate every request's exact billed cost across the content in its context.
 * Two accumulators per key: `f` is TTL-invariant, `v` scales with whatever multiplier
 * is assumed for cache writes whose TTL the transcript did not record. So re-pricing
 * costs O(keys), not another walk.
 */
export function allocate(scanned) {
  const { files, dispatchers, density } = scanned;
  const CODE = density.code, TEXT = density.text;   // chars per token, by content class
  const acc = new Map();                 // key -> {rec, f, v, out}
  const recOf = new Map([[PRE_KEY, PRE_REC]]);   // key -> its record, so nothing re-parses keys
  const addCtx = (ctx, rec, tokens) => {
    if (!(tokens > 0)) return;
    const k = keyOf(rec);
    if (!recOf.has(k)) recOf.set(k, rec);
    ctx.set(k, (ctx.get(k) || 0) + tokens);
  };
  const bump = (rec, f, v, out) => {
    const k = keyOf(rec);
    let e = acc.get(k);
    if (!e) { e = { rec, f: 0, v: 0, out: 0 }; acc.set(k, e); }
    e.f += f; e.v += v; e.out += out;
  };

  const billed = { f: 0, v: 0, out: 0 };
  const models = new Map();              // raw id -> {n, basis, rate}
  const unpriced = new Map();            // raw id -> requests skipped from pricing
  const ttl = { "1h": 0, "5m": 0, unknown: 0 };
  let requests = 0, sessions = 0, sidechainRequests = 0;
  let tMin = null, tMax = null;
  const firstCtx = [];

  for (const file of files) {
    const ctx = new Map();               // key -> estimated tokens in context
    const toolOf = new Map();            // tool_use id -> {tool, sub}
    let preamble = null, sawRequest = false;

    for (const line of file.text.split("\n")) {
      const s = line.trim(); if (!s) continue;
      let rec; try { rec = JSON.parse(s); } catch { continue; }
      if (typeof rec.timestamp === "string") {
        const t = Date.parse(rec.timestamp);
        if (!isNaN(t)) { if (tMin === null || t < tMin) tMin = t; if (tMax === null || t > tMax) tMax = t; }
      }
      const msg = rec.message;
      if (!msg || typeof msg !== "object") continue;
      let content = msg.content;
      if (typeof content === "string") content = [{ type: "text", text: content }];
      if (!Array.isArray(content)) content = [];

      if (msg.role === "assistant") {
        const u = msg.usage || {};
        const inp = u.input_tokens || 0;
        const cr = u.cache_read_input_tokens || 0;
        const cw = u.cache_creation_input_tokens || 0;
        const out = u.output_tokens || 0;
        const ctxTokens = inp + cr + cw;
        const { rate, basis } = resolveRate(msg.model);

        if (msg.model) {
          const e = models.get(msg.model) || { n: 0, basis, rate };
          e.n++; models.set(msg.model, e);
        }

        if (rate && ctxTokens) {
          requests++;
          if (rec.isSidechain === true) sidechainRequests++;
          if (!sawRequest) { sessions++; sawRequest = true; firstCtx.push(ctxTokens); }
          const [pIn, pOut] = rate;

          // The transcript records the cache-write TTL split per request. Use it, and
          // only fall back to an assumed multiplier for the residual it omits.
          const cc = u.cache_creation && typeof u.cache_creation === "object" ? u.cache_creation : null;
          let w1 = 0, w5 = 0;
          if (cc) {
            w1 = cc.ephemeral_1h_input_tokens || 0;
            w5 = cc.ephemeral_5m_input_tokens || 0;
            if (w1 + w5 > cw) { const k = cw / (w1 + w5); w1 *= k; w5 *= k; }  // trust the total
          }
          const wUnknown = Math.max(0, cw - w1 - w5);
          ttl["1h"] += w1; ttl["5m"] += w5; ttl.unknown += wUnknown;

          const fixedIn = (inp * pIn + cr * pIn * CACHE_READ_MULT
                          + w1 * pIn * CACHE_WRITE_MULT["1h"] + w5 * pIn * CACHE_WRITE_MULT["5m"]) / 1e6;
          const varIn = (wUnknown * pIn) / 1e6;
          const outCost = (out * pOut) / 1e6;
          billed.f += fixedIn; billed.v += varIn; billed.out += outCost;

          // Preamble (system prompt + tool schemas) is measured ONCE per session, at the
          // first request, where almost no conversation exists yet. Holding it fixed
          // matters: char-based sizing undercounts, and a preamble recomputed every turn
          // would absorb the entire shortfall and grow without bound.
          let mine = 0; for (const v of ctx.values()) mine += v;
          if (preamble === null) preamble = Math.max(0, ctxTokens - mine);
          const body = Math.max(0, ctxTokens - preamble);
          const shares = [];
          let denom = 0;
          if (mine > 0) {
            const k = body / mine;
            for (const [key, v] of ctx) { const t = v * k; shares.push([key, t]); denom += t; }
          }
          const pre = Math.min(preamble, ctxTokens);
          if (pre > 0) { shares.push([PRE_KEY, pre]); denom += pre; }
          for (const [key, t] of (denom > 0 ? shares : [])) {
            const r = recOf.get(key);
            if (r) bump(r, fixedIn * (t / denom), varIn * (t / denom), 0);
          }

          // Output. Thinking text is not persisted (only a signature), so it is the
          // remainder after the prose and tool arguments we can actually see.
          let prose = 0, args = 0;
          for (const b of content) {
            if (!b || typeof b !== "object") continue;
            if (b.type === "text") prose += (b.text || "").length / TEXT;
            else if (b.type === "tool_use") args += JSON.stringify(b.input || {}).length / CODE;
          }
          const think = Math.max(0, out - prose - args);
          const d2 = prose + args + think;
          if (d2 > 0) {
            bump({ role: "assistant", kind: "thinking" },   0, 0, outCost * think / d2);
            bump({ role: "assistant", kind: "prose" },      0, 0, outCost * prose / d2);
            bump({ role: "assistant", kind: "tool-args" },  0, 0, outCost * args / d2);
          }
        } else if (ctxTokens && basis !== "synthetic") {
          unpriced.set(msg.model || "(no model field)", (unpriced.get(msg.model || "(no model field)") || 0) + 1);
        }

        // This assistant message now becomes part of the context for later requests.
        for (const b of content) {
          if (!b || typeof b !== "object") continue;
          if (b.type === "text") {
            addCtx(ctx, { role: "assistant", kind: "prose-carried" }, (b.text || "").length / TEXT);
          } else if (b.type === "thinking" || b.type === "redacted_thinking") {
            addCtx(ctx, { role: "assistant", kind: "thinking-carried" }, charsOf(b) / TEXT);
          } else if (b.type === "tool_use") {
            const tool = b.name || "(unnamed tool)";
            const { sub, shell } = subKeyOf(b.input, dispatchers);
            if (b.id) toolOf.set(b.id, { tool, sub, shell });
            addCtx(ctx, { role: "tool", tool, dir: "call", sub, shell },
                   JSON.stringify(b.input || {}).length / CODE);
          }
        }
      } else if (msg.role === "user") {
        for (const b of content) {
          const bt = (b && typeof b === "object") ? b.type : "text";
          if (bt === "tool_result") {
            const t = toolOf.get(b.tool_use_id) || { tool: "(unmatched tool result)", sub: null, shell: false };
            addCtx(ctx, { role: "tool", tool: t.tool, dir: "result", sub: t.sub, shell: t.shell },
                   charsOf(b) / CODE);
          } else if (bt === "image") {
            addCtx(ctx, { role: "image", kind: "image" }, imageTokens(b));
          } else if (bt === "document") {
            addCtx(ctx, { role: "image", kind: "document" }, charsOf(b) / CODE);
          } else {
            for (const part of classifyUserBlock(textOf(b), rec))
              addCtx(ctx, { role: part.role, sub: part.sub }, part.chars / TEXT);
          }
        }
      }
    }
  }

  const days = (tMin !== null && tMax !== null)
    ? Math.max(1, Math.round((tMax - tMin) / 86400000)) : null;
  return { acc, billed, requests, sessions, sidechainRequests, models, unpriced, ttl,
           days, spanFrom: tMin, spanTo: tMax, firstCtx };
}

const PRE_REC = { role: "preamble" };
const PRE_KEY = keyOf(PRE_REC);

/* ---------------------------------------------------------------------- price --
 * Apply a rate for the cache writes whose TTL was not recorded. O(keys).
 */
export function price(alloc, ttlAssumption = "1h") {
  const mult = CACHE_WRITE_MULT[ttlAssumption] ?? CACHE_WRITE_MULT["1h"];
  const rows = [];
  for (const e of alloc.acc.values()) {
    const c = e.f + e.v * mult + e.out;
    if (c > 0) rows.push({ rec: e.rec, cost: c, isOutput: e.out > 0 && e.f === 0 && e.v === 0 });
  }
  return { rows,
           input: alloc.billed.f + alloc.billed.v * mult,
           output: alloc.billed.out,
           total: alloc.billed.f + alloc.billed.v * mult + alloc.billed.out };
}

/* ----------------------------------------------------------------- the report --
 * Groups are defined by ROLE IN THE REQUEST CYCLE -- a structural property every
 * transcript has. Membership is then derived from measured cost, so a tool, command,
 * harness tag or MCP server this file has never heard of still lands correctly.
 */
export const GROUPS = [
  { id: "shell",    name: "Shell commands",              short: "Shell" },
  { id: "ingest",   name: "Tools · content read in",     short: "Read in" },
  { id: "emit",     name: "Tools · content written out", short: "Written out" },
  { id: "twoway",   name: "Tools · two-way",             short: "Two-way" },
  { id: "output",   name: "Model output",                short: "Output" },
  { id: "preamble", name: "System prompt & tool schemas", short: "System prompt" },
  { id: "harness",  name: "Harness & reminders",         short: "Harness" },
  { id: "media",    name: "Images & attachments",        short: "Media" },
  { id: "typed",    name: "My typing",                   short: "My typing" },
];

/** A tool is shown as one row, or split into call/result rows, depending on whether
 *  BOTH directions carry real money. Measured per tool -- no list of tool names. */
const SPLIT_MIN_SHARE = 0.12;
/** Above this share of a tool's cost in one direction, that direction defines its role. */
const DOMINANT = 0.7;

const round = v => Math.round(v * 100) / 100;
const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

export function buildTree(alloc, ttlAssumption = "1h") {
  const priced = price(alloc, ttlAssumption);

  /* A two-level accumulator: group -> item -> optional child. Every branch below feeds
   * the same structure, so no group needs bespoke assembly code. */
  const bucket = new Map();
  const put = (gid, item, child, cost) => {
    if (!(cost > 0)) return;
    if (!bucket.has(gid)) bucket.set(gid, new Map());
    const items = bucket.get(gid);
    let e = items.get(item);
    if (!e) { e = { cost: 0, kids: new Map() }; items.set(item, e); }
    e.cost += cost;
    if (child) e.kids.set(child, (e.kids.get(child) || 0) + cost);
  };

  // 1. Fold tool rows into per-tool direction and sub-key totals; place the rest by role.
  const tools = new Map();     // tool -> {call, result, shell, subs:Map(sub -> cost)}
  for (const { rec, cost } of priced.rows) {
    switch (rec.role) {
      case "tool": {
        let t = tools.get(rec.tool);
        if (!t) { t = { call: 0, result: 0, shell: false, subs: new Map() }; tools.set(rec.tool, t); }
        if (rec.shell) t.shell = true;
        t[rec.dir === "call" ? "call" : "result"] += cost;
        if (rec.sub) t.subs.set(rec.sub, (t.subs.get(rec.sub) || 0) + cost);
        break;
      }
      case "preamble":  put("preamble", "system prompt + tool schemas", null, cost); break;
      case "harness":   put("harness", rec.sub || "harness", null, cost); break;
      case "typed":     put("typed", "your typed messages", null, cost); break;
      case "image":     put("media", rec.kind === "document" ? "attached documents"
                                                            : "images / screenshots", null, cost); break;
      case "assistant": put("output", OUT_NAMES[rec.kind] || rec.kind, null, cost); break;
      default:          put("twoway", "(unclassified)", null, cost);
    }
  }

  // 2. Place each tool by its own measured direction balance, and give it a second level
  //    from whatever sub-keys its inputs yielded. Both are derived, not looked up.
  for (const [tool, t] of tools) {
    const total = t.call + t.result;
    if (total <= 0) continue;
    const resultShare = t.result / total;
    const gid = t.shell ? "shell"
              : resultShare >= DOMINANT ? "ingest"
              : resultShare <= 1 - DOMINANT ? "emit" : "twoway";
    const disp = toolDisplay(tool);
    const subTotal = sumBy([...t.subs.values()], c => c);

    if (t.shell) {
      // Shell: the sub-key is "prog" or "prog verb", so the program is the item and the
      // full command the child. One row per program regardless of which tool ran it.
      for (const [sub, c] of t.subs) {
        const prog = sub.split(" ")[0];
        put(gid, prog, sub, c);
      }
      put(gid, "(no command parsed)", null, total - subTotal);
    } else if (t.subs.size > 1 && subTotal / total >= 0.8) {
      // Enough of this tool's cost carries a sub-key to make a meaningful second level.
      for (const [sub, c] of t.subs) put(gid, disp, sub, c);
      put(gid, disp, "(no path parsed)", total - subTotal);
    } else if (Math.min(t.call, t.result) / total >= SPLIT_MIN_SHARE) {
      // Both directions carry real money, so one merged row would hide the story --
      // and drilling a single-child row renders a degenerate 100% block.
      put(gid, disp + " · results", null, t.result);
      put(gid, disp + " · call args", null, t.call);
    } else {
      put(gid, disp, null, total);
    }
  }

  // 3. Emit the tree in the declared group order, largest first within each level.
  const groups = [];
  for (const def of GROUPS) {
    const items = bucket.get(def.id);
    if (!items || !items.size) continue;
    const list = [...items].map(([name, e]) => {
      const kids = [...e.kids].map(([n, c]) => ({ name: n, cost: round(c) }))
        .sort((a, b) => b.cost - a.cost);
      return { name, cost: round(e.cost), children: kids.length > 1 ? kids : null };
    }).sort((a, b) => b.cost - a.cost);
    groups.push({ id: def.id, name: def.name, short: def.short,
                  cost: round(sumBy(list, i => i.cost)), items: list });
  }
  groups.sort((a, b) => b.cost - a.cost);

  // 4. Insights, measured -- so the views layer never needs a hand-written list of
  //    "commands that read" versus "commands that write".
  const gcost = id => (groups.find(g => g.id === id) || { cost: 0 }).cost;
  const outItems = (groups.find(g => g.id === "output") || { items: [] }).items;
  const oc = n => (outItems.find(i => i.name === n) || { cost: 0 }).cost;
  const all = [...tools.values()];
  const ingest = sumBy(all, t => t.result);
  const emit = sumBy(all, t => t.call);
  const mcp = sumBy(priced.rows.filter(r => r.rec.role === "tool"
                    && String(r.rec.tool).startsWith("mcp__")), r => r.cost);

  return {
    total: priced.total, input: priced.input, output: priced.output,
    requests: alloc.requests, sessions: alloc.sessions, days: alloc.days,
    groups, accounted: round(sumBy(groups, g => g.cost)),
    insights: {
      fixed: gcost("preamble"), harness: gcost("harness"),
      thinking: oc(OUT_NAMES.thinking), proseGen: oc(OUT_NAMES.prose),
      proseCarry: oc(OUT_NAMES["prose-carried"]),
      ingest: round(ingest), emit: round(emit), mcp: round(mcp),
      typed: gcost("typed"),
    },
  };
}

const OUT_NAMES = {
  thinking: "thinking",
  prose: "assistant prose (generated)",
  "tool-args": "tool-call arguments",
  "prose-carried": "assistant prose (re-billed as input)",
  "thinking-carried": "thinking blocks (re-billed as input)",
};

/* ------------------------------------------------------------------ top level --
 * One scan, one allocation, then a priced tree per TTL assumption -- and the
 * assumption only affects the cache writes whose TTL the transcript omitted.
 */
export function analyze(rawFiles, opts = {}) {
  const scanned = scan(rawFiles);
  if (!scanned.files.length) throw new Error("no readable transcript files");
  const alloc = allocate(scanned);

  const datasets = {};
  for (const t of ["1h", "5m"]) datasets[t] = buildTree(alloc, t);

  const wTotal = alloc.ttl["1h"] + alloc.ttl["5m"] + alloc.ttl.unknown;
  const warnings = [];
  if (alloc.unpriced.size) {
    const n = [...alloc.unpriced.values()].reduce((a, b) => a + b, 0);
    warnings.push(`${n.toLocaleString("en-US")} request(s) used a model with no known rate `
      + `(${[...alloc.unpriced.keys()].join(", ")}) and are excluded from the total.`);
  }
  if (!scanned.densityCalibrated) {
    warnings.push(`Not enough clean samples to calibrate token sizing, so the `
      + `${CPT_FALLBACK} chars/token default is in use and row splits are rougher `
      + `than usual. Totals are unaffected.`);
  } else if (scanned.density.basis === "pooled") {
    warnings.push(`Token sizing calibrated to a single pooled density `
      + `(${scanned.density.code.toFixed(2)} chars/token); there was not enough of one `
      + `content class to separate prose from machine text.`);
  }
  if (scanned.badLines) warnings.push(`${scanned.badLines} unparseable line(s) skipped.`);
  if (alloc.sidechainRequests) {
    warnings.push(`${alloc.sidechainRequests.toLocaleString("en-US")} subagent request(s) `
      + `included (isSidechain).`);
  }

  return {
    datasets,
    requests: alloc.requests, sessions: alloc.sessions, days: alloc.days,
    spanFrom: alloc.spanFrom, spanTo: alloc.spanTo,
    filesUsed: scanned.files.length, duplicatesDropped: scanned.duplicatesDropped,
    badLines: scanned.badLines,
    models: [...alloc.models].map(([id, e]) => ({ id, requests: e.n, basis: e.basis, rate: e.rate }))
      .sort((a, b) => b.requests - a.requests),
    unpriced: Object.fromEntries(alloc.unpriced),
    density: scanned.density, densityCalibrated: scanned.densityCalibrated,
    densitySamples: scanned.densitySamples,
    dispatchers: [...scanned.dispatchers].sort(),
    ttlTokens: alloc.ttl,
    ttlMeasuredShare: wTotal > 0 ? 1 - alloc.ttl.unknown / wTotal : 1,
    preambleRange: alloc.firstCtx.length
      ? [Math.min(...alloc.firstCtx), Math.max(...alloc.firstCtx)] : null,
    warnings,
    groupDefs: GROUPS,
  };
}
