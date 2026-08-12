/* Exercise the real view code against a DOM shim, across every reachable state. */
import fs from "node:fs";
import path from "node:path";

const els = new Map();
const mkEl = id => {
  const e = { id, innerHTML: "", value: "", dataset: {}, children: [],
    classList: { add(){}, remove(){}, contains: () => false },
    addEventListener(){}, setAttribute(){}, removeAttribute(){}, getAttribute: () => null,
    closest: () => null, focus(){}, scrollIntoView(){} };
  return e;
};
const doc = {
  getElementById(id) { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); },
  documentElement: mkEl("html"),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener(){}, createElement: mkEl, body: mkEl("body"),
};
globalThis.document = doc;
globalThis.window = { scrollTo(){}, addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }),
  location: { hash: "", href: "http://x/", search: "" }, history: { replaceState(){} },
  navigator: { clipboard: { writeText: async () => {} } }, getComputedStyle: () => ({}) };
globalThis.location = window.location;
globalThis.history = window.history;
try { Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true }); } catch {}
globalThis.requestAnimationFrame = f => f();
globalThis.setTimeout = (f) => { f(); return 0; };

const E = await import("../engine.js");
const V = await import("../views.js");

/* A transcript directory may be passed as an argument; otherwise the suite builds its own
   synthetic dataset, so the render paths are covered without touching anyone's files. */
const dir = process.argv[2];
let files;
if (dir) {
  files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"))
    .map(f => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
} else {
  const L = [];
  const progs = [["git", ["diff", "log", "status", "commit"]], ["docker", ["build", "run", "ps"]]];
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
const view = () => doc.getElementById("reportView").innerHTML;
const check = (label) => {
  const h = view();
  const bad = [];
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
  console.log(`${bad.length ? "FAIL" : "ok  "} ${label}${bad.length ? "  -> " + bad.join(", ") : ` (${(h.length/1024).toFixed(0)} KB)`}`);
};

V.initReport(data);
check("root · panels · 1h");

const S = V.__state || null;
// Drive state through the exported setters if present, else re-init with hash.
const states = [
  ["table view",            { view: "table" }],
  ["amounts hidden",        { pctOnly: true }],
  ["5m TTL lens",           { ttl: "5m" }],
  ["query hit",             { query: "git" }],
  ["query miss",            { query: "zzzzzznope" }],
];
for (const [label, patch] of states) {
  V.setState ? V.setState(patch) : null;
  if (!V.setState) { console.log(`skip ${label} (no setState export)`); continue; }
  check(label);
  V.setState(Object.fromEntries(Object.keys(patch).map(k => [k,
    k === "view" ? "panels" : k === "ttl" ? "1h" : k === "query" ? "" : false])));
}
// drill down into each top-level group, then one level deeper
const d1 = data.datasets["1h"];
for (const g of d1.groups) {
  if (!V.setState) break;
  V.setState({ path: [g.name] });
  check(`drilled → ${g.name}`);
  const kid = (g.items || []).find(i => i.children && i.children.length > 1);
  if (kid) { V.setState({ path: [g.name, kid.name] }); check(`drilled → ${g.name} › ${kid.name}`); }
  V.setState({ path: [] });
}
console.log(fails ? `\n${fails} RENDER FAILURE(S)` : "\nall render states clean");
process.exit(fails ? 1 : 0);
