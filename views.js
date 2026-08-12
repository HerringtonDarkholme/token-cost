/* Report views — implementation of "Cost Report.dc.html" (claude.ai/design d41a68ba).
   The design was authored in the <x-dc> template format against a static cost-data.js;
   this is the same layout, palette and logic rendered natively against live uploaded
   data. Full re-render on state change, with event delegation so handler count stays
   flat regardless of how many rows exist. */

/* Colour follows the group's stable ID from the engine, in the engine's declared order --
   so a group keeps its hue when you drill in, switch view or change the TTL lens, and a
   dataset containing tools this file has never heard of still colours consistently. The
   palette caps at 8 hues; a 9th group takes a deliberate neutral rather than an invented
   colour. Display names and short labels come from the engine too, so nothing here needs
   a table of the tools or commands one particular person happens to use. */
let HUE = new Map(), SHORT = new Map();
function indexGroups() {
  HUE = new Map(); SHORT = new Map();
  const order = ((DATA && DATA.groupDefs) || []).map(g => g.id);
  ((ds() && ds().groups) || []).forEach(g => {
    const i = order.indexOf(g.id);
    HUE.set(g.name, (i >= 0 && i < 8) ? `var(--c${i+1})` : "var(--cn)");
    if (g.short) SHORT.set(g.name, g.short);
  });
}
const FOLD_MIN = 0.008, FOLD_MAX = 14;

let DATA = null;
let S = { ttl:"1h", path:[], open:{}, hover:null, hoverInfo:null, query:"",
          view:"panels", pctOnly:false, copied:false, linked:false };

/** Percentage of a maximum, guarded. Every row in a group can legitimately round to
 *  $0.00 on a small dataset, which makes the group maximum 0 and any bare v/max a NaN
 *  that lands straight in a style attribute. */
const pctOf = (v, max) => (max > 0 && v >= 0) ? v / max * 100 : 0;
const maxCost = list => (list && list.length) ? Math.max.apply(null, list.map(x => x.cost || 0)) : 0;

const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const money = n => "$" + n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const ds = () => DATA ? DATA.datasets[S.ttl] : null;
const reqs = () => { const d = ds(); return (d && d.requests) || 1; };
const hue = g => HUE.get(g) || "var(--cn)";
/** Dollars, or share-of-bill when the amount is hidden. */
const M = (c, base) => {
  if (!S.pctOnly) return money(c);
  const r = c / (base || ds().total) * 100;
  return (r < 1 ? r.toFixed(2) : r.toFixed(1)) + "%";
};

/** Keep the top items, fold the tail into one labelled row. Nothing is dropped. */
function fold(list, parentCost, noFold) {
  if (!list || !list.length) return [];
  const sorted = list.slice().sort((a,b) => b.cost - a.cost);
  if (noFold) return sorted;
  const keep = [], rest = [];
  sorted.forEach((n,i) => ((i < FOLD_MAX && n.cost >= parentCost * FOLD_MIN) ? keep : rest).push(n));
  if (rest.length) keep.push({ name:`other (${rest.length} items)`,
    cost:+rest.reduce((s,n) => s+n.cost, 0).toFixed(2), children:null, folded:true });
  return keep;
}

/** A node is only worth opening if it actually branches. Drilling into a
 *  single-child group renders one full-width 100% block, which reads as broken. */
function branches(node) {
  const k = (node && (node.items || node.children)) || [];
  return k.length > 1 || (k.length === 1 && ((k[0].items || k[0].children) || []).length > 1);
}

function nodeAt() {
  const d = ds(); if (!d) return null;
  let node = { name:"all", cost:d.total, items:d.groups }, group = null;
  if (S.path[0]) {
    const g = d.groups.find(x => x.name === S.path[0]);
    if (g) { group = g; node = { name:g.name, cost:g.cost, items:g.items }; }
    if (S.path[1] && group) {
      const it = group.items.find(x => x.name === S.path[1]);
      if (it) node = { name:it.name, cost:it.cost, items:it.children || [] };
    }
  }
  return { node, groupName: group ? group.name : null };
}

/** Ledger rows from the current root, honouring open state and the query. */
function ledger() {
  const at = nodeAt(); if (!at) return { rows:[], recon:0, rootCost:1 };
  const q = S.query.trim().toLowerCase();
  const rows = []; let recon = 0;
  const walk = (list, depth, inherit) => {
    fold(list, list.reduce((s,n) => s+n.cost, 0) || 1, depth === 0 && !at.groupName).forEach(n => {
      const g = (depth === 0 && !at.groupName) ? n.name : inherit;
      const kids = n.items || n.children || null;
      const key = g + "›" + n.name + "›" + depth;
      const match = !q || n.name.toLowerCase().includes(q);
      const kidMatch = kids ? kids.some(k => k.name.toLowerCase().includes(q)
        || (k.children || []).some(c => c.name.toLowerCase().includes(q))) : false;
      if (q && !match && !kidMatch) return;
      const open = q ? (kidMatch || (match && depth === 0))
                     : (S.open[key] !== undefined ? S.open[key] : depth === 0);
      if (q) { if (match && !(kids && kids.length && open)) recon += n.cost; }
      else if (depth === 0) recon += n.cost;
      rows.push({ node:n, depth, group:g, key, open, hasKids:!!(kids && kids.length) });
      if (kids && kids.length && open) walk(kids, depth+1, g);
    });
  };
  walk(at.node.items || [], 0, at.groupName);
  return { rows, recon:+recon.toFixed(2), rootCost:at.node.cost || 1 };
}

/* The read-vs-write figures used to come from two hand-written lists of shell commands.
   They now come from the engine, which measures each tool's own call-args/results balance
   -- so the number is right for tools and commands nobody has enumerated. */

/* ---------- URL state ---------- */
function readHash() {
  const h = (location.hash || "").replace(/^#/, ""); if (!h) return;
  const p = {}; h.split("&").forEach(kv => { const [a,b] = kv.split("="); if (a) p[a] = decodeURIComponent(b||""); });
  if (p.ttl === "5m" || p.ttl === "1h") S.ttl = p.ttl;
  if (p.p) S.path = p.p.split(">").filter(Boolean).slice(0,2);
  if (p.v === "table" || p.v === "panels") S.view = p.v;
  if (p.q) S.query = p.q;
  if (p.u === "pct") S.pctOnly = true;
  if (p.t === "dark" || p.t === "light") document.documentElement.setAttribute("data-theme", p.t);
}
function syncUrl() {
  const parts = [];
  if (S.ttl !== "1h") parts.push("ttl=" + S.ttl);
  if (S.path.length) parts.push("p=" + encodeURIComponent(S.path.join(">")));
  if (S.view !== "panels") parts.push("v=" + S.view);
  if (S.query) parts.push("q=" + encodeURIComponent(S.query));
  if (S.pctOnly) parts.push("u=pct");
  const t = document.documentElement.getAttribute("data-theme"); if (t) parts.push("t=" + t);
  try { history.replaceState(null, "", parts.length ? "#" + parts.join("&") : location.pathname + location.search); } catch(e){}
}

/* ---------- pieces ---------- */
function toolbar() {
  const cur = document.documentElement.getAttribute("data-theme");
  const sw = (on, act, arg, label) =>
    `<button type="button" aria-pressed="${on}" data-act="${act}" data-arg="${arg}">${label}</button>`;
  return `<div class="toolbar">
    <span class="tick"></span>
    <button type="button" class="linkish" data-on="${S.linked?1:0}" data-act="copylink">${
      S.linked ? "Link copied" : "Copy link to this view"}</button>
    <button type="button" class="linkish" data-on="${S.copied?1:0}" data-act="copysummary">${
      S.copied ? "Summary copied" : "Copy summary"}</button>
    <span class="seg">${sw(!S.pctOnly,"cur","dollars","$")}${sw(S.pctOnly,"cur","pct","%")}</span>
    <span class="seg">${sw(S.ttl==="1h","ttl","1h","1h TTL")}${sw(S.ttl==="5m","ttl","5m","5m TTL")}</span>
    <span class="seg">${sw(cur==="light","theme","light","Light")}${sw(!cur,"theme","system","System")}${
      sw(cur==="dark","theme","dark","Dark")}</span>
    <span class="seg"><button type="button" data-act="reset">New file</button></span>
  </div>`;
}

function mosaic(at) {
  const d = ds(), rootCost = at.node.cost || 1;
  const colsSrc = fold(at.node.items || [], rootCost, !at.groupName);
  const colTotal = colsSrc.reduce((s,n) => s+n.cost, 0) || 1;
  let run = 0;
  const html = colsSrc.map(n => {
    const cumFrom = pctOf(run, rootCost); run += n.cost; const cumTo = pctOf(run, rootCost);
    const gname = at.groupName || n.name, h = hue(gname), key0 = gname + "›" + n.name;
    const dim = S.hover && S.hover.indexOf(key0) !== 0;
    const kids = n.items || n.children;
    const segsSrc = (kids && kids.length) ? fold(kids, n.cost)
                                          : [{ name:n.name, cost:n.cost, children:null, self:true }];
    const segTotal = segsSrc.reduce((s,x) => s+x.cost, 0) || 1;
    const width = n.cost / colTotal;
    const segs = segsSrc.map((s,si) => {
      const share = s.cost / segTotal, pct = share * 100;
      const k = key0 + "›" + s.name;
      const active = S.hover === k || S.hover === key0;
      const carry = s.name.indexOf("re-billed") >= 0;
      const ramp = Math.max(0.42, 0.96 - si * 0.075);
      const st = [`flex:${Math.max(share,0.002)}`, `background:${h}`,
        `opacity:${active ? 1 : (carry ? 1 : ramp)}`,
        `padding:${pct > 7 ? "4px 6px" : "0"}`,
        active ? "filter:brightness(1.07)" : "",
        active ? "box-shadow:inset 0 0 0 2px var(--paper)" : "",
        (carry && !active) ? "outline:2px dashed var(--paper);outline-offset:-4px" : ""
      ].filter(Boolean).join(";");
      return `<button type="button" class="segb" style="${st}" title="${esc(s.name)} · ${esc(M(s.cost))}"
        data-act="seg" data-col="${esc(n.name)}" data-hkey="${esc(k)}" data-hname="${esc(s.name)}"
        data-hcost="${s.cost}" data-hunder="${esc(n.name)}" data-hgroup="${esc(gname)}"
        >${pct > 7 ? `<span class="sl">${esc(s.name)}</span>` : ""}</button>`;
    }).join("");
    const cum = (cumFrom < 80 && cumTo >= 80) ? "◂80%" : (width < 0.075 ? "" : cumTo.toFixed(0) + "%");
    return `<div class="col" data-dim="${dim?1:0}" data-flat="${branches(n)?0:1}" style="flex:${Math.max(width,0.012)}">
      <div class="colsegs">${segs}</div>
      <button type="button" class="colhead" style="border-top:2px solid ${h}"
        data-act="col" data-arg="${esc(n.name)}" data-hkey="${esc(key0)}" data-hname="${esc(n.name)}"
        data-hcost="${n.cost}" data-hgroup="${esc(gname)}">
        <span class="cn" style="font-size:${width<0.08?"10.5px":"11.5px"}">${
          esc((!at.groupName && SHORT.get(n.name)) || n.name)}</span>
        <span class="cc">${esc(M(n.cost))}</span>
        <span class="cp"><span>${(width*100).toFixed(1)}%</span><span class="${
          (cumFrom<80&&cumTo>=80)?"cum80":""}">${cum}</span></span>
      </button></div>`;
  }).join("");
  return `<div class="mosaicwrap"><div class="mosaic">${html}</div></div>`;
}

function panels(at) {
  const d = ds(), q = S.query.trim().toLowerCase(), rootCost = at.node.cost || 1;
  const src = at.groupName ? fold(at.node.items || [], rootCost)
                           : d.groups.slice().sort((a,b) => b.cost - a.cost);
  const maxPanel = maxCost(src);
  const out = src.map(p => {
    const gname = at.groupName || p.name, h = hue(gname), key = gname + "›" + p.name;
    const kidsAll = p.items || p.children || [];
    const kids = fold(kidsAll, p.cost).filter(k => !q || k.name.toLowerCase().includes(q)
      || p.name.toLowerCase().includes(q));
    if (q && !kids.length) return "";
    const maxKid = maxCost(kids);
    const dim = S.hover && S.hover.indexOf(key) !== 0;
    const shown = kids.reduce((a,k) => a+k.cost, 0);
    const foot = !kidsAll.length ? "single line item · no further breakdown"
      : (Math.abs(shown - p.cost) < 0.01 ? "" : `shown: ${M(shown)} of ${M(p.cost)}`);
    return `<div class="pan">
      <div class="pantop">
        <button type="button" style="border-bottom:2px solid ${h};opacity:${dim?0.55:1}"
          data-act="panel" data-arg="${esc(p.name)}" data-hkey="${esc(key)}" data-hname="${esc(p.name)}"
          data-hcost="${p.cost}" data-hgroup="${esc(gname)}">${esc(p.name)}</button>
        <span class="pc">${esc(M(p.cost))}</span>
      </div>
      <div class="panbar">
        <span class="track"><span style="width:${Math.max(pctOf(p.cost, maxPanel), 0.8)}%;background:${h};opacity:${dim?0.5:1}"></span></span>
        <span class="pr">${S.pctOnly ? M(p.cost)+" of bill" : "$"+(p.cost/reqs()).toFixed(4)+"/req"}</span>
      </div>
      <div class="panitems">${kids.map(k => {
        const kk = key + "›" + k.name, act = S.hover === kk;
        return `<div class="pi" data-on="${act?1:0}" data-hkey="${esc(kk)}" data-hname="${esc(k.name)}"
          data-hcost="${k.cost}" data-hunder="${esc(p.name)}" data-hgroup="${esc(gname)}">
          <button type="button" data-folded="${k.folded?1:0}" data-act="panel" data-arg="${esc(p.name)}">${esc(k.name)}</button>
          <span class="tk"><span style="width:${Math.max(pctOf(k.cost, maxKid), 1)}%;background:${h};opacity:${act?1:0.6}"></span></span>
          <span class="pv">${esc(M(k.cost))}</span></div>`;
      }).join("")}</div>
      ${foot ? `<div class="panfoot">${esc(foot)}</div>` : ""}</div>`;
  }).join("");
  return `<div class="panels">${out}</div>`;
}

function ledgerTable(L) {
  const maxRow = L.rows.length
    ? maxCost(L.rows.filter(r => r.depth === 0).map(r => r.node)) : 0;
  const body = L.rows.map(r => {
    const h = hue(r.group), key = r.group + "›" + r.node.name;
    const active = S.hover === key || (S.hover || "").indexOf(key + "›") === 0;
    const pct = r.node.cost / L.rootCost * 100;
    const chip = `<span class="chip" style="width:${r.depth?6:10}px;height:${r.depth?6:10}px;background:${h};
      margin-left:${r.depth*16}px;border-radius:${r.depth?"50%":"0"}"></span>`;
    const nm = `<span class="nm" data-folded="${r.node.folded?1:0}">${esc(r.node.name)}</span>`;
    return `<tr class="d${r.depth}" data-on="${active?1:0}" data-hkey="${esc(key)}"
        data-hname="${esc(r.node.name)}" data-hcost="${r.node.cost}" data-hgroup="${esc(r.group)}">
      <td class="name"><span class="namecell">${chip}${r.hasKids
        ? `<button type="button" class="tog" aria-expanded="${r.open}" data-act="toggle" data-arg="${esc(r.key)}">
             <span class="caret">${r.open?"–":"+"}</span>${nm}</button>`
        : `<span class="tog"><span class="caret"></span>${nm}</span>`}</span></td>
      <td class="num">${esc(M(r.node.cost))}</td>
      <td class="pct">${pct.toFixed(pct<1?2:1)}%</td>
      <td><span class="magbar" style="height:${r.depth?5:9}px;width:${
        Math.max(pctOf(r.node.cost, maxRow), 0.6)}%;background:${h};opacity:${active?1:0.55}"></span></td>
      <td class="per">${S.pctOnly ? esc(M(r.node.cost)) : "$"+(r.node.cost/reqs()).toFixed(4)}</td></tr>`;
  }).join("");
  return `<div class="tblwrap"><table>
    <thead><tr><th scope="col" class="l">Line item</th><th scope="col" class="r" style="width:110px">Cost</th>
      <th scope="col" class="r" style="width:78px">Share</th>
      <th scope="col" class="l" style="width:230px">Magnitude</th>
      <th scope="col" class="last" style="width:110px">${S.pctOnly?"Share of bill":"Per request"}</th></tr></thead>
    <tbody>${body || `<tr><td colspan="5" style="padding:14px 0;color:var(--ink3)">No line item matches “${esc(S.query)}”.</td></tr>`}</tbody>
    <tfoot><tr><td class="lbl">${S.query?"Matched":"Reconciled"}</td>
      <td class="v">${esc(M(L.recon))}</td>
      <td class="p">${(L.recon/L.rootCost*100).toFixed(L.recon/L.rootCost<0.1?2:1)}%</td>
      <td colspan="2" class="n">${esc(reconNote(L))}</td></tr></tfoot></table></div>`;
}

function reconNote(L) {
  const d = ds();
  if (S.query) return `Filtered view · ${M(L.recon)} across matching line items, shown in their parents' context; parent rows keep their own full totals.`;
  let s = "Children sum to parent at every level; folded rows keep their full value.";
  if (!S.path.length && Math.abs(d.total - L.recon) > 0.005)
    s += " " + (S.pctOnly ? ((d.total-L.recon)/d.total*100).toFixed(2)+"%" : "$"+(d.total-L.recon).toFixed(2))
      + " of the billed total is unattributed rounding.";
  return s;
}

/* ---------- main render ---------- */
export function initReport(data) {
  DATA = data;
  S = { ttl:"1h", path:[], open:{}, hover:null, hoverInfo:null, query:"",
        view:"panels", pctOnly:false, copied:false, linked:false };
  readHash();
  wire();
  render();
}

export function render() {
  const d = ds(); if (!d) return;
  indexGroups();
  const at = nodeAt(), L = ledger();
  const I = d.insights;
  const think = I.thinking, emit = I.proseGen, carry = I.proseCarry;
  const fixed = I.fixed, reading = I.ingest, writing = I.emit, typing = I.typed;
  const alt = DATA.datasets[S.ttl === "1h" ? "5m" : "1h"];
  const P = S.pctOnly;
  const scope = [`${d.sessions} sessions`, d.days ? `${d.days} days` : null,
                 `${d.requests.toLocaleString("en-US")} requests`].filter(Boolean).join(" · ");

  document.getElementById("reportView").innerHTML = `
  ${toolbar()}
  <section class="card">
    <span class="br br1"></span><span class="br br2"></span><span class="br br3"></span><span class="br br4"></span>
    <header class="chead">
      <div>
        <div class="eyebrow">Cost attribution · Claude Code · ${esc(scope)}</div>
        <h1>Where the money went</h1>
      </div>
      <div style="text-align:right">
        <div class="billed">Billed · ${P?"amount hidden · ":""}${S.ttl} cache TTL</div>
        <div class="total" data-hidden="${P?1:0}">${P ? "$█,███.██" : money(d.total)}</div>
      </div>
    </header>
    <div class="strip">
      <div><div class="thesis">A <em>carry</em> bill, not a usage bill — every request re-bills the whole context.</div></div>
      <div>
        <div class="carryrow"><span class="from">${esc(M(emit))}</span><span class="arrow">→</span>
          <span class="to">${esc(M(carry))}</span></div>
        <div class="cap">Written once, carried ${emit>0?(carry/emit).toFixed(1)+"×":"—"}</div>
      </div>
      <div>
        <div class="big">${(d.input/d.total*100).toFixed(1)}% <span class="sm">/</span>
          <span class="dim">${(d.output/d.total*100).toFixed(1)}%</span></div>
        <div class="cap">Input vs output · thinking ${(think/d.total*100).toFixed(1)}%</div>
      </div>
      <div>
        <div class="big">${P?((fixed/d.total*100).toFixed(1)+"%"):"$"+(fixed/reqs()).toFixed(3)}
          <span class="sm">of</span> <span class="dim">${P?"the bill":"$"+(d.total/reqs()).toFixed(3)}</span></div>
        <div class="cap">${P?`Fixed, paid on all ${d.requests.toLocaleString("en-US")} requests`
          :`Fixed, every request · ${money(fixed)}`}</div>
      </div>
    </div>
    <div class="mosaichead">
      <span class="lbl">Every line item · column width = share of bill · block height = share of column</span>
      <nav class="crumbs" aria-label="Breadcrumb">
        <button type="button" data-act="root" data-cur="${S.path.length?0:1}">all</button>
        ${S.path.map((p,i) => `<span class="sep">/</span><button type="button" data-act="crumb"
          data-arg="${i}" data-cur="${i===S.path.length-1?1:0}">${esc(p)}</button>`).join("")}
      </nav>
    </div>
    ${mosaic(at)}
    <div class="hoverbar">
      <span class="sw" style="background:${S.hoverInfo?hue(S.hoverInfo.group):"transparent"}"></span>
      <span class="txt" data-on="${S.hoverInfo?1:0}">${S.hoverInfo
        ? esc((S.hoverInfo.under?S.hoverInfo.under+" › ":"") + S.hoverInfo.name + "   " + M(S.hoverInfo.cost)
            + "   " + (S.hoverInfo.share*100).toFixed(S.hoverInfo.share<0.01?2:1) + "% of "
            + (S.path.length?S.path[S.path.length-1]:"the bill"))
        : `Accented block = prose the model wrote once for ${esc(M(emit))}, re-billed as input for ${esc(M(carry))} more. Carry cost tracks survival, not size. Hover any block for its line item.`}</span>
    </div>
  </section>

  <section class="bsec">
    <div class="bhead">
      <h2>Breakdown</h2>
      <div class="bctl">
        <label for="q">Find</label>
        <input id="q" type="search" value="${esc(S.query)}" placeholder="git diff, thinking, schema…">
        <span class="seg">
          <button type="button" aria-pressed="${S.view==="panels"}" data-act="view" data-arg="panels">Panels</button>
          <button type="button" aria-pressed="${S.view==="table"}" data-act="view" data-arg="table">Table</button>
        </span>
      </div>
    </div>
    ${S.view === "panels" ? panels(at) : ledgerTable(L)}
    <div class="reconline"><span>${esc(reconNote(L))}</span>
      <span>Reconciled: <strong>${esc(M(L.recon))}</strong></span></div>
  </section>

  <section class="foot">
    <div>
      <h3>What to change on Monday</h3>
      <ul>
        <li><strong>Cut the intake, not the output.</strong> ${esc(M(reading))} of the bill is content tools pulled <em>into</em> context, against ${esc(M(writing))} of arguments sent out and ${esc(M(typing))} for everything you typed${typing>0?` (${(reading/typing).toFixed(0)}× less)`:""}. Tool output lands in the prefix whole and is re-billed until it falls out — ask for narrower slices.</li>
        <li><strong>Trim the preamble.</strong> ${esc(M(fixed))} of fixed overhead is the only line you can delete once and stop paying ${d.requests.toLocaleString("en-US")} times.</li>
        <li><strong>Compact sooner.</strong> Carry cost is linear in how long a result survives, not in how big it looked.</li>
      </ul>
    </div>
    <div>
      <h3>Caveats</h3>
      <ul class="cav">
        <li>Cache writes bill at 2× input on a 1h TTL and 1.25× on 5m. Where the transcript
          records which applied, that is used verbatim; the switch only reprices what it
          omitted, which is why the two lenses differ by just ${esc(money(Math.abs(DATA.datasets["1h"].total - DATA.datasets["5m"].total)))} here.</li>
        <li>“Model output” exceeds output-token spend because prose written once is re-billed as input on every later request.</li>
        <li>Blocks under ${(FOLD_MIN*100).toFixed(1)}% of their parent are folded into a labelled “other”; nothing is dropped. Identity is carried by the table as well as by hue.</li>
        <li>Totals are exact; the split across line items is estimated from character
          counts at ${DATA.density ? esc(DATA.density.code.toFixed(2)) + " chars/token for machine text and "
            + esc(DATA.density.text.toFixed(2)) + " for prose, " + (DATA.densityCalibrated
              ? "both measured from this dataset" : "defaults, too few samples to measure") : "~4 chars/token"}.</li>
        <li>Cache-write TTL was recorded for ${DATA.ttlMeasuredShare != null
          ? esc((DATA.ttlMeasuredShare*100).toFixed(1)) + "%" : "an unknown share"} of written
          tokens, so the lens below only reprices the remainder.${DATA.models && DATA.models.length
            ? " Models: " + esc(DATA.models.map(m => m.id).join(", ")) + "." : ""}</li>
      </ul>
    </div>
  </section>`;
  syncUrl();
}

/* ---------- events (delegated once) ---------- */
let wired = false;
function set(patch) { Object.assign(S, patch); render(); }
/** Same state transition the UI performs, exposed so the render paths can be driven
 *  and asserted on outside a browser. */
export function setState(patch) { set(patch); }
function wire() {
  if (wired) return; wired = true;
  const host = document.getElementById("reportView");

  host.addEventListener("click", e => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    const at = nodeAt();
    if (act === "ttl") set({ ttl:arg });
    else if (act === "cur") set({ pctOnly: arg === "pct" });
    else if (act === "view") set({ view:arg });
    else if (act === "root") set({ path:[], hover:null, hoverInfo:null });
    else if (act === "crumb") set({ path:S.path.slice(0, Number(arg)+1), hover:null, hoverInfo:null });
    else if (act === "theme") {
      const r = document.documentElement;
      if (arg === "system") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", arg);
      render();
    }
    else if (act === "toggle") {
      // Depth-0 rows default to open, so read the current state the same way the
      // renderer does before inverting it.
      const cur = S.open[arg] !== undefined ? S.open[arg] : arg.endsWith("\u203a0");
      set({ open: Object.assign({}, S.open, { [arg]: !cur }) });
    }
    else if (act === "col" || act === "panel" || act === "seg") {
      const target = (act === "seg") ? el.dataset.col : arg;
      const it = (at.node.items || []).find(x => x.name === target);
      if (!branches(it)) return;                     // nothing to show one level down
      if (!at.groupName) set({ path:[target], hover:null, hoverInfo:null });
      else if (S.path.length === 1) set({ path:[at.groupName, target], hover:null, hoverInfo:null });
    }
    else if (act === "copylink") {
      syncUrl();
      if (navigator.clipboard) navigator.clipboard.writeText(location.href);
      set({ linked:true }); setTimeout(() => set({ linked:false }), 1800);
    }
    else if (act === "copysummary") {
      const d = ds(), g = n => d.groups.find(x => x.name === n) || {cost:0,items:[]};
      const I = d.insights;
      const think = I.thinking, fixed = I.fixed, typing = I.typed;
      const top = d.groups[0] || { name:"\u2014", cost:0 };
      const txt = (S.pctOnly ? `${d.days||"?"} days of Claude Code, itemised:` 
                  : `${money(d.total)} of Claude Code in ${d.days||"?"} days, itemised:`) + "\n"
        + `· ${top.name} ${M(top.cost)} — the largest single driver\n`
        + `· thinking ${M(think)} — ${(think/d.output*100).toFixed(0)}% of output tokens, ${(think/d.total*100).toFixed(1)}% of the bill\n`
        + `· prompt + schemas ${M(fixed)} fixed, paid on all ${d.requests.toLocaleString("en-US")} requests\n`
        + `· my typing ${M(typing)} (${(typing/d.total*100).toFixed(1)}%)\n\n`
        + "Cost is carry cost: every token is re-billed on every request it survives.";
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      set({ copied:true }); setTimeout(() => set({ copied:false }), 1800);
    }
    else if (act === "reset") {
      document.getElementById("reportView").classList.add("hidden");
      document.getElementById("uploadView").classList.remove("hidden");
    }
  });

  host.addEventListener("input", e => {
    if (e.target.id !== "q") return;
    const pos = e.target.selectionStart;
    S.query = e.target.value; render();
    const q = document.getElementById("q");
    if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch(err){} }
  });

  const enter = e => {
    const el = e.target.closest("[data-hkey]"); if (!el) return;
    const rootCost = (nodeAt().node.cost) || 1;
    S.hover = el.dataset.hkey;
    S.hoverInfo = { name:el.dataset.hname, cost:Number(el.dataset.hcost),
      under:el.dataset.hunder || null, group:el.dataset.hgroup,
      share:rootCost > 0 ? Number(el.dataset.hcost) / rootCost : 0 };
    render();
  };
  host.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-hkey]");
    if (!el) { if (S.hover) { S.hover = null; S.hoverInfo = null; render(); } return; }
    if (S.hover !== el.dataset.hkey) enter(e);
  });
  host.addEventListener("mouseleave", () => {
    if (S.hover) { S.hover = null; S.hoverInfo = null; render(); }
  });
  window.addEventListener("hashchange", () => { readHash(); render(); });
}
