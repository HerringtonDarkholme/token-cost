/* Panels: one card per line item, with its own children ranked inside. */

import { memo, useMemo } from "react"
import { useReport } from "./context.ts"
import { isCode, nodeName, useT } from "./copy.tsx"
import { fold, kidsOf, maxCost, moneyFine, pctOf, type CostNode } from "./model.ts"
import { vtName } from "./Motion.tsx"
import { hoverBind, useHover } from "./store.ts"

/* Memoised on the same two primitives the mosaic columns take: `hit` is the hovered key when it
   lands inside this panel, null otherwise. */
const Panel = memo(function Panel({
  panel,
  gname,
  maxPanel,
  kids,
  hit,
  anyHover,
}: {
  panel: CostNode
  gname: string
  maxPanel: number
  kids: CostNode[]
  hit: string | null
  anyHover: boolean
}): React.JSX.Element {
  const { state, pal, amt, reqs, drill } = useReport()
  const t = useT()
  const h = pal.hue(gname)
  const key = gname + "›" + panel.name
  const dim = anyHover && !hit
  const maxKid = maxCost(kids)

  /* Two different footers, and the difference matters: a panel with no children is a genuine
     leaf, while one whose children sum short of it has been filtered by the query and must say
     so rather than appear to under-count. */
  const kidsAll = kidsOf(panel) || []
  const shown = kids.reduce((a, k) => a + k.cost, 0)
  const foot = !kidsAll.length
    ? t.panels.leaf
    : Math.abs(shown - panel.cost) < 0.01
      ? ""
      : t.panels.shown(amt(shown), amt(panel.cost))

  /* Named for the filter transition -- see `vtName`. The key is the panel's identity rather than
     its place in the grid, which is the whole point: a query that removes the third panel moves
     the fourth into its slot, and a name that counted slots would morph one line item into a
     different one. */
  return (
    <div className="pan" style={vtName(key)}>
      <div className="pantop">
        {/* The group's colour, as a bar standing beside the name rather than a rule under it.
            Underlined, the name read as a link and the colour as its decoration; upright, the
            colour is a label on the panel and the name is left as a name. The geometry is the
            stylesheet's -- see `.pantop button`, which hangs the bar out into the panel's own
            padding so the title stays flush with the bar and the rows beneath it. Handed down
            as a custom property rather than as the border itself, because only the hue is the
            data's: a width written here would be a width the padding that offsets it cannot
            see. */}
        <button
          type="button"
          data-code={isCode(t, panel.name, null, gname) ? 1 : 0}
          style={{ "--hue": h, opacity: dim ? 0.55 : 1 } as React.CSSProperties}
          onClick={() => drill(panel.name)}
          {...hoverBind({ key, name: panel.name, cost: panel.cost, under: null, group: gname })}
        >
          {nodeName(t, panel)}
        </button>
        <span className="pc">{amt(panel.cost)}</span>
      </div>
      <div className="panbar">
        <span className="track">
          <span
            style={{
              width: `${Math.max(pctOf(panel.cost, maxPanel), 0.8)}%`,
              background: h,
              opacity: dim ? 0.5 : 1,
            }}
          />
        </span>
        <span className="pr">
          {state.pctOnly
            ? t.panels.ofBill(amt(panel.cost))
            : t.panels.perReq(moneyFine(panel.cost / reqs, 4))}
        </span>
      </div>
      <div className="panitems">
        {kids.map((k) => {
          const kk = key + "›" + k.name
          const active = hit === kk
          return (
            <div
              className="pi"
              key={kk}
              style={vtName(kk)}
              data-on={active ? 1 : 0}
              {...hoverBind({
                key: kk,
                name: k.name,
                cost: k.cost,
                under: panel.name,
                group: gname,
              })}
            >
              <button
                type="button"
                data-folded={k.folded ? 1 : 0}
                data-code={isCode(t, k.name, panel.name, gname) ? 1 : 0}
                onClick={() => drill(panel.name)}
              >
                {nodeName(t, k)}
              </button>
              <span className="tk">
                <span
                  style={{
                    width: `${Math.max(pctOf(k.cost, maxKid), 1)}%`,
                    background: h,
                    opacity: active ? 1 : 0.6,
                  }}
                />
              </span>
              <span className="pv">{amt(k.cost)}</span>
            </div>
          )
        })}
      </div>
      {foot ? <div className="panfoot">{foot}</div> : null}
    </div>
  )
})

export function Panels(): React.JSX.Element {
  const { d, focus, state } = useReport()
  const hover = useHover()
  const hk = hover?.key ?? null
  const q = state.query.trim().toLowerCase()
  const rootCost = focus.node.cost || 1

  /* Memoised for node identity, so a hover leaves the memoised panels' props untouched. */
  const { panels, maxPanel } = useMemo(() => {
    /* At the root the nine groups are shown whole -- they are the page's spine, and folding one
       away would hide a role rather than a long tail. */
    const src: CostNode[] = focus.groupName
      ? fold(focus.node.items || [], rootCost)
      : d.groups.slice().sort((a, b) => b.cost - a.cost)
    return {
      maxPanel: maxCost(src),
      panels: src
        .map((p) => {
          const kids = fold(kidsOf(p) || [], p.cost).filter(
            (k) => !q || k.name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
          )
          return { p, kids }
        })
        .filter(({ kids }) => !q || kids.length),
    }
  }, [d, focus, rootCost, q])

  return (
    <div className="panels">
      {panels.map(({ p, kids }) => {
        const key = (focus.groupName || p.name) + "›" + p.name
        return (
          <Panel
            key={p.name}
            panel={p}
            gname={focus.groupName || p.name}
            maxPanel={maxPanel}
            kids={kids}
            hit={hk && (hk === key || hk.startsWith(key + "›")) ? hk : null}
            anyHover={!!hk}
          />
        )
      })}
    </div>
  )
}
