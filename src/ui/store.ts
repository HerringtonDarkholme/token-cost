/* View state, held outside the component tree. */

import { useSyncExternalStore } from "react"
import type { Analysis, TtlAssumption } from "../core/engine.ts"
import { GUESSED, isLang, noteLang, type Lang } from "../core/i18n.ts"
import { pathOf, slug } from "../core/model.ts"

/** What the pointer (or keyboard focus) is on. */
export interface HoverTarget {
  key: string
  name: string
  cost: number
  under: string | null
  group: string
}

export type ThemeChoice = "light" | "dark" | "system"

export interface ViewState {
  ttl: TtlAssumption
  /** Breadcrumb, at most [group, item]. */
  path: string[]
  /** Ledger disclosure, keyed by row. */
  open: Record<string, boolean>
  query: string
  /** Which chart the card draws. */
  chart: "mosaic" | "sun"
  view: "panels" | "table"
  /** Amounts hidden for screen-sharing: shares of the bill instead of dollars. */
  pctOnly: boolean
  theme: ThemeChoice
  /** Which language the page is in. */
  lang: Lang
}

/** The mosaic wants nine columns with figures under each, and a phone cannot give it that, so a
 *  narrow card opens on the sunburst. Taken once, at load: re-deciding it would undo a reader's
 *  own pick. */
const WIDE: boolean =
  typeof matchMedia === "function" ? !matchMedia("(max-width: 820px)").matches : true

/** The narrowest band, and unlike `WIDE` this one is subscribed: it decides where a block is
 *  rendered, and a rotation has to move it. */
const NARROW = "(max-width: 560px)"

function narrow(): boolean {
  return typeof matchMedia === "function" && matchMedia(NARROW).matches
}

function subscribeNarrow(fn: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {}
  const list = matchMedia(NARROW)
  list.addEventListener("change", fn)
  return () => list.removeEventListener("change", fn)
}

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, narrow, narrow)
}

const INITIAL: ViewState = {
  ttl: "1h",
  path: [],
  open: {},
  query: "",
  chart: WIDE ? "mosaic" : "sun",
  view: "panels",
  pctOnly: false,
  theme: "system",
  /* The one initial value that is a guess rather than a default. */
  lang: GUESSED,
}

let state: ViewState = { ...INITIAL }
const listeners = new Set<() => void>()

export const getState = (): ViewState => state

export function setState(patch: Partial<ViewState>): void {
  state = { ...state, ...patch }
  /* The two number formatters are plain functions called from inside JSX, so they cannot
     subscribe. */
  noteLang(state.lang)
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Subscribe a component to the whole state. */
export function useViewState(): ViewState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/* hover -- its own slice rather than a field of `ViewState`: it changes dozens of times a second
   during a sweep, and nothing shareable depends on it. */

let hover: HoverTarget | null = null
const hoverListeners = new Set<() => void>()

export const getHover = (): HoverTarget | null => hover

export function setHover(t: HoverTarget | null): void {
  /* Enter and focus both fire for the same block, so the echo is dropped. */
  if (hover === t || (hover?.key === t?.key && hover?.cost === t?.cost)) return
  hover = t
  hoverListeners.forEach((fn) => fn())
}

function subscribeHover(fn: () => void): () => void {
  hoverListeners.add(fn)
  return () => {
    hoverListeners.delete(fn)
  }
}

export function useHover(): HoverTarget | null {
  return useSyncExternalStore(subscribeHover, getHover, getHover)
}

/* hover, as the DOM reports it: a view marks every element that stands for something, and one
   handler on the shell reads the pointer against those marks. */

/** Whether an arrival is allowed to set the hover at all. */
let armed = true

/** Drop the highlight, and stop taking arrivals until the pointer moves. */
export function disarmHover(): void {
  armed = false
  setHover(null)
}

/** Marks an element as standing for something, and reports it on movement, on enter and on
 *  focus, so tabbing gives the readout the pointer does. */
export function hoverBind(t: HoverTarget): {
  onMouseMove: () => void
  onMouseEnter: () => void
  onFocus: () => void
  "data-hoversrc": string
} {
  const on = (): void => setHover(t)
  const moved = (): void => {
    armed = true
    setHover(t)
  }
  return {
    onMouseMove: moved,
    onMouseEnter: () => {
      if (armed) setHover(t)
    },
    /* Focus is nobody's accident: it arrives by tab or by click. */
    onFocus: on,
    "data-hoversrc": "",
  }
}

/** The other half, spread once on the shell. */
export const hoverClear: {
  onMouseOver: (e: React.MouseEvent<HTMLElement>) => void
  onMouseLeave: () => void
  onBlur: (e: React.FocusEvent<HTMLElement>) => void
} = {
  onMouseOver: (e) => {
    if (!(e.target as Element).closest("[data-hoversrc]")) setHover(null)
  },
  onMouseLeave: () => setHover(null),
  onBlur: (e) => {
    if (!(e.relatedTarget as Element | null)?.closest("[data-hoversrc]")) setHover(null)
  },
}

/** Back to a clean slate, keeping the theme and the language: both were chosen for the session. */
export function resetState(): void {
  /* Armed again rather than disarmed, for the reason the changes above are the other way round. */
  armed = true
  setHover(null)
  setState({ ...INITIAL, theme: state.theme, lang: state.lang })
}

/* URL state -- the address is in two halves, split by what Back is for: the path is where the
   reader is, the hash the settings held on that location. */

/** Whether this copy can hold a path at all: a page served as a file has no origin that would
 *  serve `/report/shell` back. */
function here(): string {
  return typeof location === "object" ? location.pathname : "/"
}

function routed(): boolean {
  return !/\.html?$/i.test(here())
}

/** Read on every call rather than taken once at import: `/open` moves the address before the
 *  first render, and this module is imported long before that. */
function root(): string {
  return (
    here()
      .replace(/\/report(\/.*)?$/, "")
      .replace(/\/+$/, "") + "/"
  )
}

/** `/`, `/report`, `/report/shell-commands`, `/report/shell-commands/git`. */
export function pathFor(report: boolean, path: string[]): string {
  if (!routed()) return here()
  if (!report) return root()
  return root() + ["report", ...path.map(slug)].join("/")
}

export function readPath(pathname: string): { report: boolean; slugs: string[] } {
  const base = root()
  if (!routed() || !pathname.startsWith(base)) return { report: false, slugs: [] }
  const seg = pathname.slice(base.length).split("/").filter(Boolean)
  if (seg[0] !== "report") return { report: false, slugs: [] }
  /* Two deep, the same bound the drill itself has. */
  return { report: true, slugs: seg.slice(1, 3).map((s) => decodeURIComponent(s).toLowerCase()) }
}

/** The address applied whole, which is what a Back needs: keys it does not carry go back to
 *  their defaults, bar the two chosen for the session and the disclosure the address never held.
 *  The bill is passed in because only the tree knows which name a slug stood for. */
export function applyUrl(data: Analysis | null): void {
  const hash = readHash(location.hash)
  const d = data?.datasets[hash.ttl ?? INITIAL.ttl]
  setState({
    ...INITIAL,
    theme: state.theme,
    lang: state.lang,
    open: state.open,
    path: d ? pathOf(d, readPath(location.pathname).slugs) : [],
    ...hash,
  })
}

/** The hash as `key=value` pairs. Shared with `transfer.ts`, which reads the one non-setting
 *  key. */
export function parseHash(hash: string): Record<string, string> {
  const h = (hash || "").replace(/^#/, "")
  const p: Record<string, string> = {}
  if (!h) return p
  h.split("&").forEach((kv) => {
    const [a, b] = kv.split("=")
    if (a) p[a] = decodeURIComponent(b || "")
  })
  return p
}

export function readHash(hash: string): Partial<ViewState> {
  const p = parseHash(hash)
  const out: Partial<ViewState> = {}
  if (p.ttl === "5m" || p.ttl === "1h") out.ttl = p.ttl
  if (p.c === "sun" || p.c === "mosaic") out.chart = p.c
  if (p.v === "table" || p.v === "panels") out.view = p.v
  if (p.q) out.query = p.q
  if (p.u === "pct") out.pctOnly = true
  if (p.t === "dark" || p.t === "light") out.theme = p.t
  if (p.l && isLang(p.l)) out.lang = p.l
  return out
}

export function hashFor(s: ViewState): string {
  const parts: string[] = []
  if (s.ttl !== "1h") parts.push("ttl=" + s.ttl)
  /* Against the guess: on a phone the sunburst is where the page started, so the mosaic gets a
     key. */
  if (s.chart !== INITIAL.chart) parts.push("c=" + s.chart)
  if (s.view !== "panels") parts.push("v=" + s.view)
  if (s.query) parts.push("q=" + encodeURIComponent(s.query))
  if (s.pctOnly) parts.push("u=pct")
  if (s.theme !== "system") parts.push("t=" + s.theme)
  /* Against the guess rather than a constant: `en` is not the default, the reader's browser is. */
  if (s.lang !== GUESSED) parts.push("l=" + s.lang)
  return parts.length ? "#" + parts.join("&") : ""
}
