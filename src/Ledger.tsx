/* The ledger table. Not a fallback for the charts: several palette hues fall below 3:1
   contrast on a light ground, so identity has to be carried by text somewhere, and this is
   where the numbers are legible to a screen reader and copyable to a spreadsheet. */

import { memo } from "react"
import { useReport } from "./context.ts"
import { maxCost, pctOf, rowIsOpen, type LedgerRow, type Ledger } from "./model.ts"
import { vtName } from "./Motion.tsx"
import { hoverBind, setState, useHover } from "./store.ts"

/** What the footer claims, in words. Two different claims: unfiltered, it asserts the
 *  reconciliation; filtered, it says plainly that the matched rows are a subset shown in
 *  their parents' context, so nobody reads the total as having shrunk. */
export function useReconNote(L: Ledger): string {
  const { d, state, amt } = useReport()
  if (state.query)
    return (
      `Filtered view · ${amt(L.recon)} across matching line items, shown in their ` +
      "parents' context; parent rows keep their own full totals."
    )
  let s = "Children sum to parent at every level; folded rows keep their full value."
  if (!state.path.length && Math.abs(d.total - L.recon) > 0.005) {
    const gap = state.pctOnly
      ? (((d.total - L.recon) / d.total) * 100).toFixed(2) + "%"
      : "$" + (d.total - L.recon).toFixed(2)
    s += ` ${gap} of the billed total is unattributed rounding.`
  }
  return s
}

/* One row, memoised on `active` rather than on the hover target, so moving the pointer down
   the table re-renders the row entered and the row left instead of all of them. */
const Row = memo(function Row({
  r,
  maxRow,
  rootCost,
  active,
}: {
  r: LedgerRow
  maxRow: number
  rootCost: number
  active: boolean
}): React.JSX.Element {
  const { state, pal, amt, reqs } = useReport()
  const h = pal.hue(r.group)
  const pct = (r.node.cost / rootCost) * 100
  const name = (
    <span className="nm" data-folded={r.node.folded ? 1 : 0}>
      {r.node.name}
    </span>
  )

  return (
    <tr
      className={`d${r.depth}`}
      style={vtName(r.key)}
      data-on={active ? 1 : 0}
      {...hoverBind({
        key: r.hkey,
        name: r.node.name,
        cost: r.node.cost,
        under: r.under,
        group: r.group || "",
      })}
    >
      <td className="name">
        <span className="namecell">
          <span
            className="chip"
            style={{
              width: r.depth ? 6 : 10,
              height: r.depth ? 6 : 10,
              background: h,
              marginLeft: r.depth * 16,
              borderRadius: r.depth ? "50%" : 0,
            }}
          />
          {r.hasKids ? (
            <button
              type="button"
              className="tog"
              aria-expanded={r.open}
              onClick={() =>
                setState({
                  open: { ...state.open, [r.key]: !rowIsOpen(state.open, r.key, r.depth) },
                })
              }
            >
              <span className="caret">{r.open ? "–" : "+"}</span>
              {name}
            </button>
          ) : (
            <span className="tog">
              <span className="caret" />
              {name}
            </span>
          )}
        </span>
      </td>
      <td className="num">{amt(r.node.cost)}</td>
      <td className="pct">{pct.toFixed(pct < 1 ? 2 : 1)}%</td>
      <td>
        <span
          className="magbar"
          style={{
            height: r.depth ? 5 : 9,
            width: `${Math.max(pctOf(r.node.cost, maxRow), 0.6)}%`,
            background: h,
            opacity: active ? 1 : 0.55,
          }}
        />
      </td>
      <td className="per">
        {state.pctOnly ? amt(r.node.cost) : "$" + (r.node.cost / reqs).toFixed(4)}
      </td>
    </tr>
  )
})

export function LedgerTable({ L }: { L: Ledger }): React.JSX.Element {
  const { state, amt } = useReport()
  const hover = useHover()
  const hk = hover?.key ?? null
  const maxRow = maxCost(L.rows.filter((r) => r.depth === 0).map((r) => r.node))
  const reconShare = L.recon / L.rootCost

  return (
    <div className="tblwrap">
      <table>
        <thead>
          <tr>
            <th scope="col" className="l">
              Line item
            </th>
            <th scope="col" className="r" style={{ width: 110 }}>
              Cost
            </th>
            <th scope="col" className="r" style={{ width: 78 }}>
              Share
            </th>
            <th scope="col" className="l" style={{ width: 230 }}>
              Magnitude
            </th>
            <th scope="col" className="last" style={{ width: 110 }}>
              {state.pctOnly ? "Share of bill" : "Per request"}
            </th>
          </tr>
        </thead>
        <tbody>
          {L.rows.length ? (
            L.rows.map((r) => (
              <Row
                key={r.key}
                r={r}
                maxRow={maxRow}
                rootCost={L.rootCost}
                active={hk === r.hkey || !!hk?.startsWith(r.hkey + "›")}
              />
            ))
          ) : (
            <tr>
              <td colSpan={5} style={{ padding: "14px 0", color: "var(--ink3)" }}>
                No line item matches “{state.query}”.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="lbl">{state.query ? "Matched" : "Reconciled"}</td>
            <td className="v">{amt(L.recon)}</td>
            <td className="p">{(reconShare * 100).toFixed(reconShare < 0.1 ? 2 : 1)}%</td>
            {/* The sentence lives in `.reconline` directly below, which is where it has to
                live anyway -- the panels view has no table to put a footer in -- so printing
                it here as well was the same paragraph twice, ten pixels apart. */}
            <td colSpan={2} className="n" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
