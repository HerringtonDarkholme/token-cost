/* One context carrying everything every part of the report needs: the analysis, the
   dataset for the current TTL lens, the view state, the palette, the focused subtree, and
   the two formatters whose behaviour changes when amounts are hidden.

   It exists so that a component deep in the mosaic does not take eight props it only
   forwards, and so that `amt()` is impossible to bypass -- hiding amounts has to hide all
   of them, and a component that formatted its own dollars would leak one. */

import { createContext, useContext } from "react";
import type { Analysis, Dataset } from "./engine.ts";
import type { Focus, Palette } from "./model.ts";
import type { ViewState } from "./store.ts";

export interface ReportCtx {
  data: Analysis;
  /** The dataset for the current TTL lens. */
  d: Dataset;
  state: ViewState;
  pal: Palette;
  /** The subtree the breadcrumb is pointing at. */
  focus: Focus;
  /** Dollars, or share of `base` (default: the whole bill) when amounts are hidden. */
  amt(cost: number, base?: number): string;
  /** Requests, floored at 1 so per-request figures can never divide by zero. */
  reqs: number;
  /** Drill one level down into `name`, if it has anything to show. */
  drill(name: string): void;
}

export const ReportContext = createContext<ReportCtx | null>(null);

export function useReport(): ReportCtx {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error("useReport() outside <Report>");
  return ctx;
}
