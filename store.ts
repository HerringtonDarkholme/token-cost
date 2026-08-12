/* View state, held outside the component tree.

   Everything the report's appearance depends on lives in one object. It sits in an
   external store rather than in `useState` for two reasons: the URL hash has to be able
   to seed it before the first paint and rewrite it after every change, and the render
   suite drives every reachable state through `setState` from outside React. A component
   subscribes with `useViewState()`, which is `useSyncExternalStore` -- so React still owns
   when the tree re-renders, this only owns what it re-renders from. */

import { useSyncExternalStore } from "react";
import type { TtlAssumption } from "./engine.ts";

/** What the pointer (or keyboard focus) is on. One object rather than a key plus a parallel
 *  bag of details, so highlighting and the readout can never disagree about what is hovered. */
export interface HoverTarget {
  key: string;
  name: string;
  cost: number;
  under: string | null;
  group: string;
}

export type ThemeChoice = "light" | "dark" | "system";

export interface ViewState {
  ttl: TtlAssumption;
  /** Breadcrumb, at most [group, item]. */
  path: string[];
  /** Ledger disclosure, keyed by row. Absent means "the default for that depth". */
  open: Record<string, boolean>;
  hover: HoverTarget | null;
  query: string;
  view: "panels" | "table";
  /** Amounts hidden for screen-sharing: shares of the bill instead of dollars. */
  pctOnly: boolean;
  theme: ThemeChoice;
}

const INITIAL: ViewState = {
  ttl: "1h", path: [], open: {}, hover: null, query: "", view: "panels",
  pctOnly: false, theme: "system",
};

let state: ViewState = { ...INITIAL };
const listeners = new Set<() => void>();

export const getState = (): ViewState => state;

export function setState(patch: Partial<ViewState>): void {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Subscribe a component to the whole state. The report re-renders from the top on any
 *  change -- including hover -- which is cheap because React diffs it, and is what keeps
 *  the charts and the table provably the same instrument rather than two that agree by
 *  hand. */
export function useViewState(): ViewState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Back to a clean slate, keeping the reader's theme: they chose it for the session, not
 *  for the file. */
export function resetState(): void {
  setState({ ...INITIAL, theme: state.theme });
}

/* ---------- URL state ----------
   The hash is the whole shareable view: TTL lens, drill path, chart-or-table, query,
   whether amounts are hidden, and the theme. `history.replaceState` can throw on a
   `file://` page, which is the normal way this is opened, so writing is best-effort. */

export function readHash(hash: string): Partial<ViewState> {
  const h = (hash || "").replace(/^#/, "");
  if (!h) return {};
  const p: Record<string, string> = {};
  h.split("&").forEach(kv => {
    const [a, b] = kv.split("=");
    if (a) p[a] = decodeURIComponent(b || "");
  });
  const out: Partial<ViewState> = {};
  if (p.ttl === "5m" || p.ttl === "1h") out.ttl = p.ttl;
  if (p.p) out.path = p.p.split(">").filter(Boolean).slice(0, 2);
  if (p.v === "table" || p.v === "panels") out.view = p.v;
  if (p.q) out.query = p.q;
  if (p.u === "pct") out.pctOnly = true;
  if (p.t === "dark" || p.t === "light") out.theme = p.t;
  return out;
}

export function hashFor(s: ViewState): string {
  const parts: string[] = [];
  if (s.ttl !== "1h") parts.push("ttl=" + s.ttl);
  if (s.path.length) parts.push("p=" + encodeURIComponent(s.path.join(">")));
  if (s.view !== "panels") parts.push("v=" + s.view);
  if (s.query) parts.push("q=" + encodeURIComponent(s.query));
  if (s.pctOnly) parts.push("u=pct");
  if (s.theme !== "system") parts.push("t=" + s.theme);
  return parts.length ? "#" + parts.join("&") : "";
}
