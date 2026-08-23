/* One context carrying everything every part of the report needs: the analysis, the dataset for
   the current TTL lens, the view state, the palette, the focused subtree, and the two formatters
   whose behaviour changes when amounts are hidden. */

import { createContext, useCallback, useContext, useMemo } from "react"
import type { Analysis, Dataset } from "../core/engine.ts"
import { branches, focusOf, money, palette, type Focus, type Palette } from "../core/model.ts"
import { disarmHover, setState, type ViewState } from "./store.ts"

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

/** Everything derived from an analysis, in one object whose identity survives a re-render. */
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
      disarmHover()
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
