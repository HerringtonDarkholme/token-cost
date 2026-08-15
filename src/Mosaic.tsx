/* The primary view: one column per line item, width = share of the bill, stacked blocks inside =
   the item's own breakdown. */

import { memo, useMemo } from "react"
import { useReport } from "./context.ts"
import { isCode, labelOf, nodeName, useT } from "./copy.tsx"
import { branches, fold, kidsOf, pctOf, type CostNode } from "./model.ts"
import { hoverBind, useHover, useNarrow } from "./store.ts"

/** How much of its parent a block has to be worth before its name is written on it. Two numbers
 *  because the axis changes: 7% of a column is a readable band of a chart that is tall, while 7%
 *  of a transposed row is fifteen pixels of one that is not. */
const LABEL_MIN = { cols: 7, rows: 25 }

/** A column's blocks: its children, or one block standing for the column itself when it has no
 *  breakdown. */
function segmentsOf(node: CostNode): CostNode[] {
  const kids = kidsOf(node)
  return kids
    ? fold(kids, node.cost)
    : [{ name: node.name, cost: node.cost, children: null, self: true }]
}

/* Memoised, and given the hover as two primitives rather than the target itself: `hit` is the
   hovered key when it falls inside this column and null when it does not. */
const Column = memo(function Column({
  node,
  gname,
  cumFrom,
  cumTo,
  width,
  hit,
  anyHover,
  rows,
}: {
  node: CostNode
  gname: string
  cumFrom: number
  cumTo: number
  width: number
  hit: string | null
  anyHover: boolean
  /** The chart is transposed: this is a row, and its head is a gutter down the left. */
  rows: boolean
}): React.JSX.Element {
  const { pal, focus, amt, drill } = useReport()
  const t = useT()
  const h = pal.hue(gname)
  const key = gname + "›" + node.name
  const dim = anyHover && !hit

  const segs = segmentsOf(node)
  const segTotal = segs.reduce((s, x) => s + x.cost, 0) || 1

  /* The 80% mark is the one cumulative number worth calling out: it says how few columns carry
     most of the bill. */
  const crosses80 = cumFrom < 80 && cumTo >= 80
  const cum = crosses80 ? "◂80%" : width < 0.075 ? "" : cumTo.toFixed(0) + "%"
  /* At the root a column is a group, and a group has a short label for the narrow ones. */
  const short = focus.groupName ? undefined : pal.short(node.name)

  const bar = (
    <div className="colsegs">
      {segs.map((s, i) => {
        const share = s.cost / segTotal,
          pct = share * 100
        const segKey = key + "›" + s.name
        const active = hit === segKey || hit === key
        const named = pct > (rows ? LABEL_MIN.rows : LABEL_MIN.cols)
        /* Prose re-billed as input is the one block the page argues about, so it keeps full
           strength and a dashed edge while the rest of the column ramps down. */
        const carry = s.name.includes("re-billed")
        return (
          <button
            type="button"
            key={segKey}
            className="segb"
            title={`${nodeName(t, s)} · ${amt(s.cost)}`}
            onClick={() => drill(node.name)}
            {...hoverBind({
              key: segKey,
              name: s.name,
              cost: s.cost,
              under: node.name,
              group: gname,
            })}
            style={{
              flex: Math.max(share, 0.002),
              background: h,
              opacity: active || carry ? 1 : Math.max(0.42, 0.96 - i * 0.075),
              padding: named ? "4px 6px" : 0,
              filter: active ? "brightness(1.07)" : undefined,
              boxShadow: active ? "inset 0 0 0 2px var(--paper)" : undefined,
              outline: carry && !active ? "2px dashed var(--paper)" : undefined,
              outlineOffset: carry && !active ? "-4px" : undefined,
            }}
          >
            {named ? (
              <span className="sl" data-code={isCode(t, s.name, node.name, gname) ? 1 : 0}>
                {nodeName(t, s)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )

  const head = (
    <button
      type="button"
      className="colhead"
      onClick={() => drill(node.name)}
      {...hoverBind({ key, name: node.name, cost: node.cost, under: null, group: gname })}
    >
      <span
        className="cn"
        data-code={!short && isCode(t, node.name, null, gname) ? 1 : 0}
        style={{ fontSize: width < 0.08 ? "10.5px" : "11.5px" }}
      >
        {short ? labelOf(t, short) : nodeName(t, node)}
      </span>
      <span className="cc">{amt(node.cost)}</span>
      <span className="cp">
        <span>{(width * 100).toFixed(1)}%</span>
        <span className={crosses80 ? "cum80" : undefined}>{cum}</span>
      </span>
    </button>
  )

  return (
    <div
      className="col"
      data-dim={dim ? 1 : 0}
      data-flat={branches(node) ? 0 : 1}
      style={{ flex: Math.max(width, 0.012) }}
    >
      {/* Swapped in the markup rather than with `order`, because the gutter really is read
          before the row it names -- and `order` would have left it after in the tab order. */}
      {rows ? head : null}
      {bar}
      {rows ? null : head}
    </div>
  )
})

export function Mosaic(): React.JSX.Element {
  const { focus } = useReport()
  const hover = useHover()
  const hk = hover?.key ?? null
  const rootCost = focus.node.cost || 1
  /* Where the chart turns on its side -- see `[data-lay]` in the stylesheet for what that costs
     and what it buys. */
  const rows = useNarrow()

  /* Memoised so the folded nodes keep their identity when only the hover moved -- otherwise
     every column would get a fresh `node` prop and the memo above would never hit. */
  const cols = useMemo(
    () => fold(focus.node.items || [], rootCost, !focus.groupName),
    [focus, rootCost],
  )
  const colTotal = cols.reduce((s, n) => s + n.cost, 0) || 1

  let run = 0
  return (
    <div className="mosaicwrap" data-lay={rows ? "rows" : "cols"}>
      <div className="mosaic">
        {cols.map((n) => {
          const cumFrom = pctOf(run, rootCost)
          run += n.cost
          const key = (focus.groupName || n.name) + "›" + n.name
          return (
            <Column
              key={n.name}
              node={n}
              gname={focus.groupName || n.name}
              cumFrom={cumFrom}
              cumTo={pctOf(run, rootCost)}
              width={n.cost / colTotal}
              hit={hk && (hk === key || hk.startsWith(key + "›")) ? hk : null}
              anyHover={!!hk}
              rows={rows}
            />
          )
        })}
      </div>
    </div>
  )
}

/** The readout under the mosaic. */
export function HoverBar(): React.JSX.Element {
  const { state, pal, focus, amt, d } = useReport()
  const t = useT()
  const h = useHover()
  const rootCost = focus.node.cost || 1
  const share = h ? (rootCost > 0 ? h.cost / rootCost : 0) : 0
  const under = state.path.length ? labelOf(t, state.path[state.path.length - 1]) : t.strip.theBill

  return (
    <div className="hoverbar">
      <span className="sw" style={{ background: h ? pal.hue(h.group) : "transparent" }} />
      <span className="txt" data-on={h ? 1 : 0}>
        {h
          ? t.chart.hoverLine(
              (h.under ? labelOf(t, h.under) + " › " : "") + labelOf(t, h.name),
              amt(h.cost),
              (share * 100).toFixed(share < 0.01 ? 2 : 1) + "%",
              under,
            )
          : t.chart.hoverIdle(amt(d.insights.proseGen), amt(d.insights.proseCarry))}
      </span>
    </div>
  )
}
