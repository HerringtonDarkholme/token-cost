/* The report's view model: everything that turns an `Analysis` into the rows, columns and
   numbers the components draw, with no React and no DOM in sight.

   It lives apart from the components on purpose. Folding, drill-down and the ledger walk
   are where the arithmetic that has to reconcile actually happens, and keeping them as
   plain functions means they can be asserted directly -- `node test/model.test.ts` runs
   this file with no renderer, no DOM and no test runner between the assertion and the
   code. */

import type { Analysis, Dataset, GroupId } from "./engine.ts";

/* Every level of the tree -- group, item, child, and the synthetic "other" row folding
   produces -- is drawn by the same components, so they share one shape. The engine's
   TreeGroup / TreeItem / TreeChild all satisfy it structurally; `folded` and `self` mark
   the two nodes this file synthesises. */
export interface CostNode {
  name: string;
  cost: number;
  items?: CostNode[];
  children?: CostNode[] | null;
  folded?: boolean;
  self?: boolean;
  id?: GroupId;
  short?: string;
}

/** Rows below this share of their parent, or past this rank, fold into one labelled
 *  "other". The threshold is relative so it holds for a $3 session and a $3,000 quarter. */
export const FOLD_MIN = 0.008;
export const FOLD_MAX = 14;

/** Percentage of a maximum, guarded. Every row in a group can legitimately round to $0.00
 *  on a small dataset, which makes the group maximum 0 and any bare v/max a NaN that lands
 *  straight in a style attribute. */
export const pctOf = (v: number, max: number): number => (max > 0 && v >= 0) ? v / max * 100 : 0;

export const maxCost = (list: CostNode[] | null | undefined): number =>
  (list && list.length) ? Math.max(...list.map(x => x.cost || 0)) : 0;

export const money = (n: number): string =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const count = (n: number): string => n.toLocaleString("en-US");

/** Keep the top items, fold the tail into one labelled row. Nothing is dropped. */
export function fold(list: CostNode[] | null | undefined, parentCost: number, noFold?: boolean): CostNode[] {
  if (!list || !list.length) return [];
  const sorted = list.slice().sort((a, b) => b.cost - a.cost);
  if (noFold) return sorted;
  const keep: CostNode[] = [], rest: CostNode[] = [];
  sorted.forEach((n, i) => ((i < FOLD_MAX && n.cost >= parentCost * FOLD_MIN) ? keep : rest).push(n));
  if (rest.length) keep.push({
    name: `other (${rest.length} items)`,
    cost: +rest.reduce((s, n) => s + n.cost, 0).toFixed(2), children: null, folded: true,
  });
  return keep;
}

/** A node is only worth opening if it actually branches. Drilling into a single-child
 *  group renders one full-width 100% block, which reads as broken. */
export function branches(node: CostNode | null | undefined): boolean {
  const k = (node && (node.items || node.children)) || [];
  return k.length > 1 || (k.length === 1 && ((k[0].items || k[0].children) || []).length > 1);
}

/* ---------- palette ---------- */

/** Colour follows the group's stable ID from the engine, in the engine's declared order --
 *  so a group keeps its hue when you drill in, switch view or change the TTL lens, and a
 *  dataset containing tools this file has never heard of still colours consistently. The
 *  palette caps at 8 hues; a 9th group takes a deliberate neutral rather than an invented
 *  colour. Display names and short labels come from the engine too, so nothing here needs
 *  a table of the tools or commands one particular person happens to use. */
export interface Palette {
  hue(group: string | null | undefined): string;
  short(name: string): string | undefined;
}

export function palette(data: Analysis, d: Dataset): Palette {
  const hues = new Map<string, string>(), shorts = new Map<string, string>();
  const order = (data.groupDefs || []).map(g => g.id);
  (d.groups || []).forEach(g => {
    const i = order.indexOf(g.id);
    hues.set(g.name, (i >= 0 && i < 8) ? `var(--c${i + 1})` : "var(--cn)");
    if (g.short) shorts.set(g.name, g.short);
  });
  return {
    hue: g => (g && hues.get(g)) || "var(--cn)",
    short: name => shorts.get(name),
  };
}

/* ---------- drill-down ---------- */

export interface Focus {
  node: CostNode;
  groupName: string | null;
}

/** The subtree the page is currently focused on, from a breadcrumb path of at most two
 *  levels. An unknown name in the path falls back to the level above rather than throwing,
 *  because the path can arrive from a URL hash someone edited or a stale bookmark. */
export function focusOf(d: Dataset, path: string[]): Focus {
  let node: CostNode = { name: "all", cost: d.total, items: d.groups };
  let group: CostNode | null = null;
  if (path[0]) {
    const g = d.groups.find(x => x.name === path[0]);
    if (g) { group = g; node = { name: g.name, cost: g.cost, items: g.items }; }
    if (path[1] && group) {
      const it = (group.items || []).find(x => x.name === path[1]);
      if (it) node = { name: it.name, cost: it.cost, items: it.children || [] };
    }
  }
  return { node, groupName: group ? group.name : null };
}

/* ---------- sunburst ---------- */

/** One node's slice of the circle. Angles are degrees clockwise from twelve o'clock, so a
 *  component has only to turn them into a path -- where the rings sit and how thick they are
 *  is a layout decision and stays out of here. */
export interface SunArc {
  key: string;
  name: string;
  cost: number;
  /** 0 is the innermost ring. */
  ring: number;
  a0: number;
  a1: number;
  under: string | null;
}

/** An innermost sector and everything beneath it. Grouped this way because a branch is also
 *  the unit of re-render: hovering an arc changes the highlight of its own branch and no
 *  other, which is the same bargain the mosaic's columns make. */
export interface SunBranch {
  key: string;
  name: string;
  group: string;
  cost: number;
  /** Line items under this sector *before* folding, so the legend can say how many there
   *  really are rather than how many survived the fold. */
  items: number;
  /** True for the synthetic tail row: it stands for many line items, and saying it has none
   *  underneath would read as "this is one thing" when it is the opposite. */
  folded: boolean;
  arcs: SunArc[];
}

export const SUN_RINGS = 3;

/** A sector thinner than this many degrees is not subdivided. Its children would be
 *  sub-pixel hairlines: impossible to see, worse to point at. Nothing is dropped -- the
 *  sector still carries their cost, and the table still lists them. */
export const SUN_MIN_SPLIT = 4;

/** Each node's share of the sweep it sits in. Every row can legitimately round to $0.00 on
 *  a small dataset, and dividing by that sum would draw an empty circle where there are
 *  real line items -- so a level that costs nothing measurable is split evenly instead. It
 *  is the same bargain as the mosaic's floor on column width: a $0.00 line item is still a
 *  line item, and the reader has to be able to see it to click into it. */
function shareIn(list: CostNode[]): (cost: number) => number {
  const total = list.reduce((s, n) => s + n.cost, 0);
  return total > 0 ? (c => c / total) : (() => 1 / (list.length || 1));
}

/** Lay the focused subtree out as nested rings. Each ring exactly tiles the one inside it,
 *  which is the property that makes the picture readable as shares: an arc's sweep is its
 *  share of the whole circle, at every depth. */
export function sunburst(focus: Focus, rings: number = SUN_RINGS): SunBranch[] {
  const top = fold(focus.node.items || [], focus.node.cost || 1, !focus.groupName);
  const share = shareIn(top);
  const out: SunBranch[] = [];
  let at = 0;

  for (const n of top) {
    /* Colour is the group's, at every depth -- the whole branch is one hue getting lighter
       outward, so a ring reads as "more detail about this" and not as new information. */
    const group = focus.groupName || n.name;
    const arcs: SunArc[] = [];

    const walk = (node: CostNode, ring: number, a0: number, span: number,
                  key: string, under: string | null): void => {
      arcs.push({ key, name: node.name, cost: node.cost, ring, a0, a1: a0 + span, under });
      if (ring + 1 >= rings || span < SUN_MIN_SPLIT) return;
      const kids = fold(node.items || node.children || [], node.cost);
      if (!kids.length) return;
      /* Scaled by what the children actually sum to, so the ring fills its parent's sweep
         even where rounding leaves the two a cent apart. */
      const kidShare = shareIn(kids);
      let a = a0;
      for (const k of kids) {
        const s = kidShare(k.cost) * span;
        walk(k, ring + 1, a, s, key + "›" + k.name, node.name);
        a += s;
      }
    };

    const span = share(n.cost) * 360;
    walk(n, 0, at, span, group + "›" + n.name, null);
    at += span;
    out.push({
      key: group + "›" + n.name, name: n.name, group, cost: n.cost,
      items: (n.items || n.children || []).length, folded: !!n.folded, arcs,
    });
  }
  return out;
}

/* ---------- ledger ---------- */

export interface LedgerRow {
  node: CostNode;
  depth: number;
  group: string | null;
  key: string;
  open: boolean;
  hasKids: boolean;
}

export interface Ledger {
  rows: LedgerRow[];
  recon: number;
  rootCost: number;
}

/** Whether a ledger row is open, given the reader's toggles. Depth-0 rows default to open
 *  so the breakdown is visible without a click; the toggle handler asks the same question
 *  before inverting, which is why it is a function and not an inline ternary. */
export const rowIsOpen = (open: Record<string, boolean>, key: string, depth: number): boolean =>
  open[key] !== undefined ? open[key] : depth === 0;

/** Flatten the focused subtree into ledger rows, honouring open state and the query.
 *  `recon` is what the footer reconciles: the sum of the top-level rows, or of the matched
 *  rows when a query is active. */
export function ledger(d: Dataset, path: string[], open: Record<string, boolean>, query: string): Ledger {
  const at = focusOf(d, path);
  const q = query.trim().toLowerCase();
  const rows: LedgerRow[] = [];
  let recon = 0;

  const walk = (list: CostNode[], depth: number, inherit: string | null): void => {
    const parentCost = list.reduce((s, n) => s + n.cost, 0) || 1;
    fold(list, parentCost, depth === 0 && !at.groupName).forEach(n => {
      const g = (depth === 0 && !at.groupName) ? n.name : inherit;
      const kids = n.items || n.children || null;
      const key = g + "›" + n.name + "›" + depth;
      const match = !q || n.name.toLowerCase().includes(q);
      const kidMatch = kids ? kids.some(k => k.name.toLowerCase().includes(q)
        || (k.children || []).some(c => c.name.toLowerCase().includes(q))) : false;
      if (q && !match && !kidMatch) return;
      const isOpen = q ? (kidMatch || (match && depth === 0)) : rowIsOpen(open, key, depth);
      if (q) { if (match && !(kids && kids.length && isOpen)) recon += n.cost; }
      else if (depth === 0) recon += n.cost;
      rows.push({ node: n, depth, group: g, key, open: isOpen, hasKids: !!(kids && kids.length) });
      if (kids && kids.length && isOpen) walk(kids, depth + 1, g);
    });
  };

  walk(at.node.items || [], 0, at.groupName);
  return { rows, recon: +recon.toFixed(2), rootCost: at.node.cost || 1 };
}

/* ---------- summary text ---------- */

/** The clipboard summary. Text, not markup, so it belongs to the model rather than to the
 *  button that copies it. */
export function summaryText(d: Dataset, pctOnly: boolean, amt: (c: number) => string): string {
  const I = d.insights;
  const top = d.groups[0] || { name: "—", cost: 0 };
  const head = pctOnly
    ? `${d.days || "?"} days of Claude Code, itemised:`
    : `${money(d.total)} of Claude Code in ${d.days || "?"} days, itemised:`;
  return [
    head,
    `· ${top.name} ${amt(top.cost)} — the largest single driver`,
    `· thinking ${amt(I.thinking)} — ${(I.thinking / (d.output || 1) * 100).toFixed(0)}% of output tokens, `
      + `${(I.thinking / (d.total || 1) * 100).toFixed(1)}% of the bill`,
    `· prompt + schemas ${amt(I.fixed)} fixed, paid on all ${count(d.requests)} requests`,
    `· my typing ${amt(I.typed)} (${(I.typed / (d.total || 1) * 100).toFixed(1)}%)`,
    "",
    "Cost is carry cost: every token is re-billed on every request it survives.",
  ].join("\n");
}
