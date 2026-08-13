/* The primary view: one column per line item, width = share of the bill, stacked blocks
   inside = the item's own breakdown. It is the dense, scannable thing the page leads with,
   rather than a wide stacked bar carrying nine numbers. */

import { memo, useMemo } from "react";
import { useReport } from "./context.ts";
import { branches, fold, kidsOf, pctOf, type CostNode } from "./model.ts";
import { setHover, useHover, type HoverTarget } from "./store.ts";

/** Hover *and* keyboard focus report the same target, so tabbing through the mosaic gives
   the same readout the pointer does. */
export function hoverBind(t: HoverTarget): { onMouseEnter: () => void; onFocus: () => void } {
  const on = (): void => setHover(t);
  return { onMouseEnter: on, onFocus: on };
}

/** A column's blocks: its children, or one block standing for the column itself when it
 *  has no breakdown. */
function segmentsOf(node: CostNode): CostNode[] {
  const kids = kidsOf(node);
  return kids
    ? fold(kids, node.cost)
    : [{ name: node.name, cost: node.cost, children: null, self: true }];
}

/* Memoised, and given the hover as two primitives rather than the target itself: `hit` is
   the hovered key when it falls inside this column and null when it does not. Hovering one
   block therefore changes props for only the column entered and the column left -- the rest
   compare equal and never re-render, which is the difference between touching two columns
   and touching every block on the page. */
const Column = memo(function Column({ node, gname, cumFrom, cumTo, width, hit, anyHover }: {
  node: CostNode; gname: string; cumFrom: number; cumTo: number; width: number;
  hit: string | null; anyHover: boolean;
}): React.JSX.Element {
  const { pal, focus, amt, drill } = useReport();
  const h = pal.hue(gname);
  const key = gname + "›" + node.name;
  const dim = anyHover && !hit;

  const segs = segmentsOf(node);
  const segTotal = segs.reduce((s, x) => s + x.cost, 0) || 1;

  /* The 80% mark is the one cumulative number worth calling out: it says how few columns
     carry most of the bill. Narrow columns show nothing rather than an unreadable stub. */
  const crosses80 = cumFrom < 80 && cumTo >= 80;
  const cum = crosses80 ? "◂80%" : (width < 0.075 ? "" : cumTo.toFixed(0) + "%");

  return (
    <div className="col" data-dim={dim ? 1 : 0} data-flat={branches(node) ? 0 : 1}
         style={{ flex: Math.max(width, 0.012) }}>
      <div className="colsegs">
        {segs.map((s, i) => {
          const share = s.cost / segTotal, pct = share * 100;
          const segKey = key + "›" + s.name;
          const active = hit === segKey || hit === key;
          /* Prose re-billed as input is the one block the page argues about, so it keeps
             full strength and a dashed edge while the rest of the column ramps down. */
          const carry = s.name.includes("re-billed");
          return (
            <button type="button" key={segKey} className="segb"
              title={`${s.name} · ${amt(s.cost)}`}
              onClick={() => drill(node.name)}
              {...hoverBind({ key: segKey, name: s.name, cost: s.cost, under: node.name, group: gname })}
              style={{
                flex: Math.max(share, 0.002),
                background: h,
                opacity: active || carry ? 1 : Math.max(0.42, 0.96 - i * 0.075),
                padding: pct > 7 ? "4px 6px" : 0,
                filter: active ? "brightness(1.07)" : undefined,
                boxShadow: active ? "inset 0 0 0 2px var(--paper)" : undefined,
                outline: carry && !active ? "2px dashed var(--paper)" : undefined,
                outlineOffset: carry && !active ? "-4px" : undefined,
              }}>
              {pct > 7 ? <span className="sl">{s.name}</span> : null}
            </button>
          );
        })}
      </div>
      <button type="button" className="colhead"
        onClick={() => drill(node.name)}
        {...hoverBind({ key, name: node.name, cost: node.cost, under: null, group: gname })}>
        <span className="cn" style={{ fontSize: width < 0.08 ? "10.5px" : "11.5px" }}>
          {(!focus.groupName && pal.short(node.name)) || node.name}
        </span>
        <span className="cc">{amt(node.cost)}</span>
        <span className="cp">
          <span>{(width * 100).toFixed(1)}%</span>
          <span className={crosses80 ? "cum80" : undefined}>{cum}</span>
        </span>
      </button>
    </div>
  );
});

export function Mosaic(): React.JSX.Element {
  const { focus } = useReport();
  const hover = useHover();
  const hk = hover?.key ?? null;
  const rootCost = focus.node.cost || 1;

  /* Memoised so the folded nodes keep their identity when only the hover moved -- otherwise
     every column would get a fresh `node` prop and the memo above would never hit. */
  const cols = useMemo(
    () => fold(focus.node.items || [], rootCost, !focus.groupName), [focus, rootCost]);
  const colTotal = cols.reduce((s, n) => s + n.cost, 0) || 1;

  let run = 0;
  return (
    <div className="mosaicwrap">
      <div className="mosaic">
        {cols.map(n => {
          const cumFrom = pctOf(run, rootCost);
          run += n.cost;
          const key = (focus.groupName || n.name) + "›" + n.name;
          return (
            <Column key={n.name} node={n} gname={focus.groupName || n.name}
              cumFrom={cumFrom} cumTo={pctOf(run, rootCost)} width={n.cost / colTotal}
              hit={hk && hk.startsWith(key) ? hk : null} anyHover={!!hk} />
          );
        })}
      </div>
    </div>
  );
}

/** The readout under the mosaic. With nothing hovered it carries the thesis rather than
 *  sitting empty, because that is the sentence the page exists to teach. */
export function HoverBar(): React.JSX.Element {
  const { state, pal, focus, amt, d } = useReport();
  const h = useHover();
  const rootCost = focus.node.cost || 1;
  const share = h ? (rootCost > 0 ? h.cost / rootCost : 0) : 0;
  const under = state.path.length ? state.path[state.path.length - 1] : "the bill";

  return (
    <div className="hoverbar">
      <span className="sw" style={{ background: h ? pal.hue(h.group) : "transparent" }} />
      <span className="txt" data-on={h ? 1 : 0}>
        {h
          ? `${h.under ? h.under + " › " : ""}${h.name}   ${amt(h.cost)}   `
            + `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}% of ${under}`
          : `Accented block = prose the model wrote once for ${amt(d.insights.proseGen)}, `
            + `re-billed as input for ${amt(d.insights.proseCarry)} more. Carry cost tracks `
            + "survival, not size. Hover any block for its line item."}
      </span>
    </div>
  );
}
