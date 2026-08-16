/* View state, held outside the component tree. */

import { useSyncExternalStore } from "react"
import type { Analysis, TtlAssumption } from "./engine.ts"
import { GUESSED, isLang, noteLang, type Lang } from "./i18n.ts"
import { pathOf, slug } from "./model.ts"

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

/** The mosaic is nine columns wide with a name and two figures under each, and a phone cannot
 *  give it that -- so where the stylesheet stops laying the card out side by side, the sunburst
 *  is what the card opens on. Taken once, at the width the page loaded at: this is which picture
 *  to *start* with, and re-deciding it under a reader who has since picked the other one would
 *  be a rotation undoing their choice. */
const WIDE: boolean =
  typeof matchMedia === "function" ? !matchMedia("(max-width: 820px)").matches : true

/** The narrowest band, and unlike `WIDE` this one is subscribed. The difference is what each is
 *  for: `WIDE` seeds a default the reader may then change, so re-answering it would undo their
 *  choice, while this decides where a block is rendered -- and a rotation has to move it. */
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
  /* The two number formatters are plain functions called by name from inside JSX, so they cannot
     subscribe to anything. */
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

/* hover ---------- Deliberately its own slice rather than a field of `ViewState`. Hover changes
   on every block the pointer crosses -- dozens per second during a sweep -- while nothing about
   the shareable view depends on it. */

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

/* hover, as the DOM reports it ---------- A view marks every element that stands for something
   -- a block, a row, an arc -- and one handler on the shell reads the pointer against those
   marks. */

/** Whether an arrival is allowed to set the hover at all. */
let armed = true

/** Drop the highlight, and stop taking arrivals until the pointer moves. */
export function disarmHover(): void {
  armed = false
  setHover(null)
}

/** Marks an element as standing for something, and reports it on movement, on enter and on
 *  focus, so tabbing through a view gives the same readout the pointer does. */
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
    /* Focus is nobody's accident: it arrives by tab or by click, both of which are the reader
       saying which thing they mean. */
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

/** Back to a clean slate, keeping the reader's theme and their language: both were chosen for
 *  the session, not for the file. */
export function resetState(): void {
  /* Armed again rather than disarmed, which is the opposite of what the changes above do and for
     the same reason they do it. */
  armed = true
  setHover(null)
  setState({ ...INITIAL, theme: state.theme, lang: state.lang })
}

/* URL state ---------- The address is in two halves, split by what Back is for. The path is where
   the reader is -- the report, and the drill inside it -- so going into `shell` is a move the
   browser can undo. The hash is the settings held on that location: TTL lens, which chart,
   panels-or-table, query, whether amounts are hidden, the theme and the language. */

/** Where this copy lives, and whether it can hold a path at all: a page served as a file -- the
 *  standalone `cost-report.html`, on `file://` or over http -- has no origin that would serve
 *  `/report/shell` back, so there the address stays where it opened. */
const HERE = typeof location === "object" ? location.pathname : "/"
const ROUTED = !/\.html?$/i.test(HERE)
const ROOT = HERE.replace(/\/report(\/.*)?$/, "").replace(/\/+$/, "") + "/"

/** `/`, `/report`, `/report/shell-commands`, `/report/shell-commands/git`. */
export function pathFor(report: boolean, path: string[]): string {
  if (!ROUTED) return HERE
  if (!report) return ROOT
  return ROOT + ["report", ...path.map(slug)].join("/")
}

export function readPath(pathname: string): { report: boolean; slugs: string[] } {
  if (!ROUTED || !pathname.startsWith(ROOT)) return { report: false, slugs: [] }
  const seg = pathname.slice(ROOT.length).split("/").filter(Boolean)
  if (seg[0] !== "report") return { report: false, slugs: [] }
  /* Two deep, the same bound the drill itself has. */
  return { report: true, slugs: seg.slice(1, 3).map((s) => decodeURIComponent(s).toLowerCase()) }
}

/** The address applied whole, which is what a Back or a Forward needs: keys the new address does
 *  not carry go back to their defaults, since coming out of a view has to undo what going in
 *  added. The exceptions are the two the reader chose for the session rather than for the file,
 *  and the disclosure the address never carried.
 *
 *  The bill is passed in because the drill is slugs on the way out and names on the way back,
 *  and only the tree knows which name a slug stood for -- under the lens the same address names,
 *  since that is the tree the address was written from. */
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

export function readHash(hash: string): Partial<ViewState> {
  const h = (hash || "").replace(/^#/, "")
  if (!h) return {}
  const p: Record<string, string> = {}
  h.split("&").forEach((kv) => {
    const [a, b] = kv.split("=")
    if (a) p[a] = decodeURIComponent(b || "")
  })
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
  /* Against the guess rather than against a constant, for the reason `lang` is below: on a phone
     the sunburst is where the page started, so it is the mosaic that is worth a key. */
  if (s.chart !== INITIAL.chart) parts.push("c=" + s.chart)
  if (s.view !== "panels") parts.push("v=" + s.view)
  if (s.query) parts.push("q=" + encodeURIComponent(s.query))
  if (s.pctOnly) parts.push("u=pct")
  if (s.theme !== "system") parts.push("t=" + s.theme)
  /* Against the guess rather than against a constant, which is the one place this differs from
     every other key: `en` is not the default, *the reader's own browser* is. */
  if (s.lang !== GUESSED) parts.push("l=" + s.lang)
  return parts.length ? "#" + parts.join("&") : ""
}
