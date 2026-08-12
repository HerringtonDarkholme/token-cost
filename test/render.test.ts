/* Exercise the real view code against a DOM shim, across every reachable state. */
import fs from "node:fs";
import path from "node:path";
import type { RawFile } from "../engine.ts";
import type { ViewState } from "../views.ts";

interface ShimEl {
  id: string;
  innerHTML: string;
  value: string;
  dataset: Record<string, string>;
  children: ShimEl[];
  classList: { add(): void; remove(): void; contains(): boolean };
  addEventListener(): void;
  setAttribute(): void;
  removeAttribute(): void;
  getAttribute(): string | null;
  closest(): ShimEl | null;
  focus(): void;
  scrollIntoView(): void;
}

const els = new Map<string, ShimEl>();
const mkEl = (id: string): ShimEl => ({
  id, innerHTML: "", value: "", dataset: {}, children: [],
  classList: { add() {}, remove() {}, contains: () => false },
  addEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
  closest: () => null, focus() {}, scrollIntoView() {},
});
const doc = {
  getElementById(id: string): ShimEl { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id)!; },
  documentElement: mkEl("html"),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: mkEl, body: mkEl("body"),
};
const win = {
  scrollTo() {}, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { hash: "", href: "http://x/", search: "" }, history: { replaceState() {} },
  navigator: { clipboard: { writeText: async () => {} } }, getComputedStyle: () => ({}),
};

/* The shim is deliberately a stand-in, not a Document -- these casts are the seam. */
const g = globalThis as unknown as Record<string, unknown>;
g.document = doc;
g.window = win;
g.location = win.location;
g.history = win.history;
try { Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true }); } catch { /* already locked */ }
g.requestAnimationFrame = (f: () => void) => { f(); return 0; };
g.setTimeout = (f: () => void) => { f(); return 0; };

const E = await import("../engine.ts");
const V = await import("../views.ts");

/* A transcript directory may be passed as an argument; otherwise the suite builds its own
   synthetic dataset, so the render paths are covered without touching anyone's files. */
const dir = process.argv[2];
let files: RawFile[];
if (dir) {
  files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"))
    .map(f => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
} else {
  const L: string[] = [];
  const progs: Array<[string, string[]]> = [["git", ["diff", "log", "status", "commit"]], ["docker", ["build", "run", "ps"]]];
  for (let k = 0; k < 30; k++) {
    const [prog, verbs] = progs[k % progs.length];
    L.push(JSON.stringify({ sessionId: "s", timestamp: "2026-05-01T00:00:00Z", message: {
      role: "assistant", model: "claude-opus-5", usage: { input_tokens: 4,
        cache_read_input_tokens: 9000 + k * 800, cache_creation_input_tokens: 300, output_tokens: 260,
        cache_creation: { ephemeral_1h_input_tokens: 300, ephemeral_5m_input_tokens: 0 } },
      content: [{ type: "text", text: "considering the change ".repeat(12) },
                { type: "tool_use", id: "b" + k, name: "Bash",
                  input: { command: `${prog} ${verbs[k % verbs.length]} --flag` } }] } }));
    L.push(JSON.stringify({ sessionId: "s", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "b" + k, content: "output line ".repeat(400) }] } }));
    L.push(JSON.stringify({ sessionId: "s", timestamp: "2026-05-01T00:00:00Z", message: {
      role: "assistant", model: "claude-opus-5", usage: { input_tokens: 4,
        cache_read_input_tokens: 12000 + k * 800, cache_creation_input_tokens: 300, output_tokens: 200,
        cache_creation: { ephemeral_1h_input_tokens: 300, ephemeral_5m_input_tokens: 0 } },
      content: [{ type: "tool_use", id: "r" + k, name: "Read",
                  input: { file_path: `/a/b${k}.${["ts", "py", "md"][k % 3]}` } }] } }));
    L.push(JSON.stringify({ sessionId: "s", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "r" + k, content: "source ".repeat(600) }] } }));
    L.push(JSON.stringify({ sessionId: "s", message: { role: "user", content: [
      { type: "text", text: "<system-reminder>reminder body ".repeat(20) + "</system-reminder>" },
      { type: "text", text: "carry on please" }] } }));
  }
  files = [{ name: "synthetic.jsonl", text: L.join("\n") }];
}

const data = E.analyze(files);
let fails = 0;
const view = (): string => doc.getElementById("reportView").innerHTML;
const check = (label: string): void => {
  const h = view();
  const bad: string[] = [];
  if (!h || h.length < 500) bad.push("empty render");
  for (const t of ["undefined", "NaN", "var(undefined)", "[object Object]", "$NaN"])
    if (h.includes(t)) bad.push(`contains ${t}`);
  // no nested interactive elements
  const btn = h.split("<button");
  for (let i = 1; i < btn.length; i++) {
    const seg = btn[i].slice(0, btn[i].indexOf("</button>") + 1);
    if (seg.includes("<button")) bad.push("nested <button>");
  }
  // tags balance for the elements that matter structurally
  for (const tag of ["div", "section", "button", "table", "tr", "td", "span", "svg", "ul", "li"]) {
    const o = (h.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
    const c = (h.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (o !== c) bad.push(`<${tag}> ${o}/${c}`);
  }
  if (bad.length) fails++;
  if (process.env.SHOW_NAN && h.includes("NaN")) {
    let i = -1;
    while ((i = h.indexOf("NaN", i + 1)) !== -1)
      console.log("      NaN CONTEXT: …" + h.slice(Math.max(0, i - 160), i + 40).replace(/\s+/g, " ") + "…");
  }
  console.log(`${bad.length ? "FAIL" : "ok  "} ${label}${bad.length ? "  -> " + bad.join(", ") : ` (${(h.length / 1024).toFixed(0)} KB)`}`);
};

V.initReport(data);
check("root · panels · 1h");

/* Each state is driven in, checked, then explicitly reverted -- the revert is spelled out
   rather than derived from the patch, so the type checker sees a real ViewState both ways. */
const states: Array<[string, Partial<ViewState>, Partial<ViewState>]> = [
  ["table view",     { view: "table" },        { view: "panels" }],
  ["amounts hidden", { pctOnly: true },        { pctOnly: false }],
  ["5m TTL lens",    { ttl: "5m" },            { ttl: "1h" }],
  ["query hit",      { query: "git" },         { query: "" }],
  ["query miss",     { query: "zzzzzznope" },  { query: "" }],
];
for (const [label, patch, revert] of states) {
  V.setState(patch);
  check(label);
  V.setState(revert);
}
// drill down into each top-level group, then one level deeper
const d1 = data.datasets["1h"];
for (const g2 of d1.groups) {
  V.setState({ path: [g2.name] });
  check(`drilled → ${g2.name}`);
  const kid = (g2.items || []).find(i => i.children && i.children.length > 1);
  if (kid) { V.setState({ path: [g2.name, kid.name] }); check(`drilled → ${g2.name} › ${kid.name}`); }
  V.setState({ path: [] });
}
console.log(fails ? `\n${fails} RENDER FAILURE(S)` : "\nall render states clean");
process.exit(fails ? 1 : 0);
