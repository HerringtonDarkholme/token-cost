/* One context carrying everything every part of the report needs: the analysis, the
   dataset for the current TTL lens, the view state, the palette, the focused subtree, and
   the two formatters whose behaviour changes when amounts are hidden.

   It exists so that a component deep in the mosaic does not take eight props it only
   forwards, and so that `amt()` is impossible to bypass -- hiding amounts has to hide all
   of them, and a component that formatted its own dollars would leak one.

   The value is nullable because the page outlives the report: the card is the same element
   before a file is dropped and after it is discarded, so the provider is always mounted and
   `null` is what it carries while there is nothing to report on. Only the report's own parts
   read it, and `useReport` asserts rather than widens -- a component that draws a line item
   has no sensible behaviour without one. */

import { createContext, useCallback, useContext, useMemo } from "react"
import type { Analysis, Dataset } from "./engine.ts"
import { branches, focusOf, money, palette, type Focus, type Palette } from "./model.ts"
import { setHover, setState, type ViewState } from "./store.ts"

export interface ReportCtx {
  data: Analysis
  /** The dataset for the current TTL lens. */
  d: Dataset
  state: ViewState
  pal: Palette
  /** The subtree the breadcrumb is pointing at. */
  focus: Focus
  /** Dollars, or share of `base` (default: the whole bill) when amounts are hidden. */
  amt(cost: number, base?: number): string
  /** Requests, floored at 1 so per-request figures can never divide by zero. */
  reqs: number
  /** Drill one level down into `name`, if it has anything to show. */
  drill(name: string): void
}

export const ReportContext = createContext<ReportCtx | null>(null)

export function useReport(): ReportCtx {
  const ctx = useContext(ReportContext)
  if (!ctx) throw new Error("useReport() outside a report")
  return ctx
}

/** Everything derived from an analysis, in one object whose identity survives a re-render.
 *
 *  The memos are not here because a ledger walk is slow -- it is microseconds -- but because
 *  stable nodes are what let the memoised columns, panels and rows skip re-rendering entirely
 *  when only a highlight moved.
 *
 *  `null` in, `null` out: the hooks still run in that case, since a page with no analysis is
 *  one file drop away from having one and the order has to hold across it. */
export function useReportCtx(data: Analysis | null, state: ViewState): ReportCtx | null {
  const d = data ? data.datasets[state.ttl] : null
  const reqs = d?.requests || 1

  const focus = useMemo(() => (d ? focusOf(d, state.path) : null), [d, state.path])
  const pal = useMemo(() => (data && d ? palette(data, d) : null), [data, d])

  const total = d?.total ?? 0
  const amt = useCallback<ReportCtx["amt"]>(
    (cost, base) => {
      if (!state.pctOnly) return money(cost)
      const denom = base || total
      const r = denom > 0 ? (cost / denom) * 100 : 0
      return (r < 1 ? r.toFixed(2) : r.toFixed(1)) + "%"
    },
    [state.pctOnly, total],
  )

  const drill = useCallback(
    (name: string) => {
      const it = (focus?.node.items || []).find((x) => x.name === name)
      if (!branches(it)) return // nothing to show one level down
      setHover(null)
      if (!focus?.groupName) setState({ path: [name] })
      else if (state.path.length === 1) setState({ path: [focus.groupName, name] })
    },
    [focus, state.path],
  )

  return useMemo(
    () => (data && d && focus && pal ? { data, d, state, pal, focus, reqs, amt, drill } : null),
    [data, d, state, pal, focus, reqs, amt, drill],
  )
}
