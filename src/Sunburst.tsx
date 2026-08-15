/* The sunburst: the same tree as the mosaic, wrapped into a circle. */

import { memo, useMemo } from "react"
import { useReport } from "./context.ts"
import { isCode, labelOf, useT } from "./copy.tsx"
import { Figure, TextCross } from "./Motion.tsx"
import { pctOf, sunburst, type SunBranch } from "./model.ts"
import { disarmHover, hoverBind, setState, useHover } from "./store.ts"

/* Ring geometry, in the viewBox's own units: the box is 200 across and centred on the origin, so
   100 is the outer edge. */
const RINGS: Array<[number, number]> = [
  [37, 59],
  [59, 79],
  [79, 96],
]

/** Stem of the mask names, one per sector, suffixed with the sector's place in the ranking. */
const FAN = "sunfan"

const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180
const pt = (deg: number, r: number): string =>
  `${(Math.cos(rad(deg)) * r).toFixed(3)},${(Math.sin(rad(deg)) * r).toFixed(3)}`

/** An annular wedge. */
function arcPath(a0: number, a1: number, r0: number, r1: number): string {
  const end = a1 - a0 >= 360 ? a0 + 359.9 : a1
  const big = end - a0 > 180 ? 1 : 0
  return (
    `M${pt(a0, r1)}A${r1},${r1} 0 ${big} 1 ${pt(end, r1)}` +
    `L${pt(end, r0)}A${r0},${r0} 0 ${big} 0 ${pt(a0, r0)}Z`
  )
}

/* Memoised on the same two primitives as the mosaic's columns, plus the query: `hit` is the
   hovered key when it lands in this branch and null when it does not. */
const Sector = memo(function Sector({
  branch,
  at,
  hit,
  anyHover,
  q,
}: {
  branch: SunBranch
  at: number
  hit: string | null
  anyHover: boolean
  q: string
}): React.JSX.Element {
  const { pal, amt, drill } = useReport()
  const t = useT()
  const h = pal.hue(branch.group)
  /* The sector's own sweep, which is the first arc it laid down: `sunburst` walks a branch from
     its root outward, so `arcs[0]` is the ring-0 wedge every other arc here sits under. */
  const root = branch.arcs[0]
  const fan = `${FAN}${at}`

  return (
    <g>
      {/* This sector's fan, opening across its own width -- see `.sunfan` in the stylesheet.
          A circle at half the radius stroked at the full width of it, so what the mask paints
          is a wedge of the disc rather than a ring; `pathLength` restates its length as 360,
          which puts the dash the stylesheet grows in degrees, the units the arcs are laid out
          in. Turned to start where this sector starts, and a quarter turn back on top of that,
          because a circle's own path begins at three o'clock and the ranking begins at twelve.

          `userSpaceOnUse` rather than the default: the mask's region would otherwise be the
          bounding box of the sector, and a thin sector's box is not the circle this is drawn
          in. */}
      <defs>
        <mask id={fan} maskUnits="userSpaceOnUse" x={-100} y={-100} width={200} height={200}>
          <circle
            className="sunfan"
            r={50}
            pathLength={360}
            fill="none"
            stroke="#fff"
            strokeWidth={100}
            transform={`rotate(${(root.a0 - 90).toFixed(3)})`}
            style={{ "--span": (root.a1 - root.a0).toFixed(3) } as React.CSSProperties}
          />
        </mask>
      </defs>
      <g mask={`url(#${fan})`}>
        {branch.arcs.map((a) => {
          const [r0, r1] = RINGS[a.ring]
          /* Prose re-billed as input is the one arc the page argues about, so it keeps full
             strength and a dashed edge — the same mark the mosaic gives the same block. */
          const carry = a.name.includes("re-billed")
          /* An arc lights up with its own descendants, so hovering a leaf traces the path back
             to the centre instead of stranding it in a dimmed ring. */
          const on = hit === a.key || (!!hit && hit.startsWith(a.key + "›"))
          /* The query dims rather than filters: dropping arcs would leave a circle whose sweeps
             no longer read as shares of anything. */
          const miss = !!q && !a.key.toLowerCase().includes(q)
          const dim = (anyHover && !on) || miss
          return (
            /* The wedge and its dashed edge travel together on the arrival -- see `.sunwedge` in
               the stylesheet, which grows each ring out of the hole a beat after the one inside
               it. */
            <g key={a.key} className="sunwedge" data-ring={a.ring}>
              <path
                className="sunarc"
                data-on={on ? 1 : 0}
                d={arcPath(a.a0, a.a1, r0, r1)}
                fill={h}
                opacity={dim ? 0.24 : on || carry ? 1 : 1 - a.ring * 0.14}
                onClick={() => drill(branch.name)}
                {...hoverBind({
                  key: a.key,
                  name: a.name,
                  cost: a.cost,
                  under: a.under,
                  group: branch.group,
                })}
              >
                <title>{`${labelOf(t, a.name)} · ${amt(a.cost)}`}</title>
              </path>
              {carry && !on && !dim ? (
                <path
                  className="suncarry"
                  d={arcPath(a.a0 + 0.6, a.a1 - 0.6, r0 + 1.6, r1 - 1.6)}
                />
              ) : null}
            </g>
          )
        })}
      </g>
    </g>
  )
})

/** The hole. */
function Core({
  rootCost,
  label,
  kids,
}: {
  rootCost: number
  label: string
  kids: number
}): React.JSX.Element {
  const { state, focus, amt } = useReport()
  const t = useT()
  const h = useHover()
  const up = state.path.length > 0
  const pct = pctOf(h?.cost ?? 0, rootCost)

  /* What each line stands for, as an identifier rather than as the words -- a token built out of
     translated copy would fade on a language change. */
  const kAt = h ? "h›" + (h.under ? h.under : h.group) : "r›" + focus.node.name
  const sAt = h ? "h›" + h.key : "r›" + focus.node.name
  /* The amount twice over: a number for the rolling digits, text for the state that is not one. */
  const cost = h ? h.cost : rootCost
  const pctText = pct.toFixed(pct < 1 ? 2 : 1) + "%"

  const inner = (
    <>
      <span className="k">
        <TextCross token={kAt}>{h ? labelOf(t, h.under ? h.under : h.group) : label}</TextCross>
      </span>
      <Figure className="v" value={state.pctOnly ? null : cost} text={amt(cost)} />
      <span className="s">
        <TextCross token={sAt}>
          {h ? (
            <span data-code={isCode(t, h.name, h.under, h.group) ? 1 : 0}>
              {labelOf(t, h.name)}
            </span>
          ) : (
            t.sun.lineItems(kids)
          )}
        </TextCross>
        {/* Only the share crosses. The next arc's line is the same sentence with a different
            number in it, and fading four identical words out and back in says nothing -- so
            the words stay put and travel to wherever the arriving figure leaves them. */}
        <span className="dim">
          {h
            ? t.sun.ofLabel(
                <TextCross inline token={"p›" + pctText}>
                  {pctText}
                </TextCross>,
                label,
              )
            : up
              ? t.sun.goBack
              : t.sun.drillIn}
        </span>
      </span>
    </>
  )

  return (
    <div className="suncore">
      {up ? (
        <button
          type="button"
          title={t.sun.back}
          onClick={() => {
            disarmHover()
            setState({ path: state.path.slice(0, -1) })
          }}
        >
          {inner}
        </button>
      ) : (
        <div>{inner}</div>
      )}
    </div>
  )
}

/* One row per innermost sector: the names the arcs have no room to carry. */
const LegRow = memo(function LegRow({
  branch,
  hue,
  on,
  dim,
}: {
  branch: SunBranch
  hue: string
  on: boolean
  dim: boolean
}): React.JSX.Element {
  const { amt, drill } = useReport()
  const t = useT()
  const kids = branch.arcs.filter((a) => a.ring === 1)
  const note = branch.folded
    ? t.sun.foldedNote
    : branch.items
      ? t.sun.itemsNote(branch.items) +
        (kids.length
          ? " · " +
            kids
              .slice(0, 2)
              .map((k) => `${labelOf(t, k.name)} ${amt(k.cost)}`)
              .join(" · ")
          : "")
      : t.sun.leafNote

  return (
    <div
      className="legrow"
      data-on={on ? 1 : 0}
      data-dim={dim ? 1 : 0}
      {...hoverBind({
        key: branch.key,
        name: branch.name,
        cost: branch.cost,
        under: null,
        group: branch.group,
      })}
    >
      <span className="sw" style={{ background: hue }} />
      <button
        type="button"
        data-folded={branch.folded ? 1 : 0}
        data-code={isCode(t, branch.name, null, branch.group) ? 1 : 0}
        onClick={() => drill(branch.name)}
      >
        {labelOf(t, branch.name)}
      </button>
      <span className="note">{note}</span>
      <span className="val">{amt(branch.cost)}</span>
    </div>
  )
})

export function Sunburst(): React.JSX.Element {
  const { focus, state, pal, amt } = useReport()
  const t = useT()
  const hover = useHover()
  const hk = hover?.key ?? null
  const q = state.query.trim().toLowerCase()
  const rootCost = focus.node.cost || 1

  /* Memoised for node identity, so a hover leaves the memoised sectors' props untouched. */
  const branches = useMemo(() => sunburst(focus), [focus])

  /* "all" is the synthetic root the drill-down starts from, and it is said as "the bill" rather
     than by its own name -- which is the one place the tree's identifier would read as a label
     if it were printed. */
  const label = focus.node.name === "all" ? t.strip.theBill : labelOf(t, focus.node.name)
  if (!branches.length) return <div className="sunempty">{t.sun.empty(label)}</div>

  return (
    <div className="sun">
      <div className="sunchart">
        <svg
          viewBox="-100 -100 200 200"
          role="img"
          aria-label={t.sun.aria(branches.length, amt(rootCost))}
        >
          {/* Sits under the arcs and catches everything they do not cover -- the margin
              outside the outer ring, the corners of the box -- so sliding off an arc into
              empty space is a pointer arriving somewhere unmarked, which is what drops the
              highlight. `pointer-events` is spelled out because an unfilled shape is not
              hit-tested, and an arrival nothing can see is an arrival nobody reports. */}
          <rect x={-100} y={-100} width={200} height={200} fill="none" pointerEvents="all" />
          {branches.map((b, i) => (
            <Sector
              key={b.name}
              branch={b}
              at={i}
              q={q}
              anyHover={!!hk}
              hit={hk && (hk === b.key || hk.startsWith(b.key + "›")) ? hk : null}
            />
          ))}
        </svg>
        <Core rootCost={rootCost} label={label} kids={branches.length} />
      </div>
      <div className="sunlegend">
        {branches.map((b) => {
          const on = hk === b.key || (!!hk && hk.startsWith(b.key + "›"))
          return (
            <LegRow
              key={b.name}
              branch={b}
              hue={pal.hue(b.group)}
              on={on}
              dim={
                (!!hk && !on) ||
                (!!q &&
                  !b.key.toLowerCase().includes(q) &&
                  !b.arcs.some((a) => a.key.toLowerCase().includes(q)))
              }
            />
          )
        })}
      </div>
    </div>
  )
}
