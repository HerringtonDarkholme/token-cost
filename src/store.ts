/* View state, held outside the component tree.

   Everything the report's appearance depends on lives in one object. It sits in an
   external store rather than in `useState` for two reasons: the URL hash has to be able
   to seed it before the first paint and rewrite it after every change, and the render
   suite drives every reachable state through `setState` from outside React. A component
   subscribes with `useViewState()`, which is `useSyncExternalStore` -- so React still owns
   when the tree re-renders, this only owns what it re-renders from. */

import { useSyncExternalStore } from "react"
import type { TtlAssumption } from "./engine.ts"
import { GUESSED, isLang, noteLang, type Lang } from "./i18n.ts"

/** What the pointer (or keyboard focus) is on. One object rather than a key plus a parallel
 *  bag of details, so highlighting and the readout can never disagree about what is hovered. */
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
  /** Ledger disclosure, keyed by row. Absent means "the default for that depth". */
  open: Record<string, boolean>
  query: string
  /** Which chart the card draws. Both read the same tree; one packs it, one wraps it. */
  chart: "mosaic" | "sun"
  view: "panels" | "table"
  /** Amounts hidden for screen-sharing: shares of the bill instead of dollars. */
  pctOnly: boolean
  theme: ThemeChoice
  /** Which language the page is in. A lens like the theme is a lens: it belongs to the reader
   *  rather than to the file, so it survives a reset and rides in the shared link. */
  lang: Lang
}

const INITIAL: ViewState = {
  ttl: "1h",
  path: [],
  open: {},
  query: "",
  chart: "mosaic",
  view: "panels",
  pctOnly: false,
  theme: "system",
  /* The one initial value that is a guess rather than a default. See `guessLang`. */
  lang: GUESSED,
}

let state: ViewState = { ...INITIAL }
const listeners = new Set<() => void>()

export const getState = (): ViewState => state

export function setState(patch: Partial<ViewState>): void {
  state = { ...state, ...patch }
  /* The two number formatters are plain functions called by name from inside JSX, so they
     cannot subscribe to anything. This is the one write that reaches them -- see `noteLang`. */
  noteLang(state.lang)
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Subscribe a component to the whole state. The report re-renders from the top on any
 *  change, and React diffs it down to the attributes that moved -- which is what keeps the
 *  charts and the table provably the same instrument rather than two that agree by hand. */
export function useViewState(): ViewState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/* ---------- hover ----------
   Deliberately its own slice rather than a field of `ViewState`. Hover changes on every
   block the pointer crosses -- dozens per second during a sweep -- while nothing about the
   shareable view depends on it. Keeping it separate means a hover re-renders the handful of
   components that draw a highlight, not the header, the strip, the footnotes and the whole
   ledger. It is still one store read by every view, so the mosaic, the panels and the table
   cannot fall out of step about what is hovered. */

let hover: HoverTarget | null = null
const hoverListeners = new Set<() => void>()

export const getHover = (): HoverTarget | null => hover

export function setHover(t: HoverTarget | null): void {
  /* Enter and focus both fire for the same block, so the echo is dropped. The cost is part
     of the comparison and not just the key: switching the TTL lens reprices every line item
     without moving the pointer, and re-entering the same block has to pick that up. */
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

/* ---------- hover, as the DOM reports it ----------
   A view marks every element that stands for something -- a block, a row, an arc -- and one
   handler on the shell reads the pointer against those marks. That is the whole contract:
   arriving at a marked element sets the hover, arriving at anything else drops it.

   It used to be a `clearBind` on each view's own container, which was correct only where the
   container happened to be tiled edge to edge by marked elements. The mosaic and the table
   are; the panels are not, so a card's padding, its footer and the grid's gaps all left a
   highlight standing, and the sunburst needed two hand-placed clears for its hole and its
   margin. Delegation has no such precondition, and the next view to call `hoverBind` cannot
   forget to add its own. */

/** Whether an arrival is allowed to set the hover at all.
 *
 *  A highlight follows a pointer, and a pointer that has not moved has not pointed at
 *  anything. Switching the chart is the case that made the difference matter: the card is
 *  16/9 for the mosaic and 4/3 for the sunburst, so the picture changes shape under a pointer
 *  resting wherever the reader left it -- and the browser, which recomputes what is under the
 *  cursor whenever the page moves beneath it, reports an arrival at whatever slid into that
 *  spot. The new chart would then come up with one arbitrary sector lit and the other eight
 *  dimmed behind it, describing nothing the reader did.
 *
 *  So a switch disarms this, and the next real movement of the pointer arms it again. */
let armed = true

/** Drop the highlight, and stop taking arrivals until the pointer moves. For the changes that
 *  rearrange the picture rather than move the pointer through it: switching chart or view,
 *  drilling in, walking back up the breadcrumb. */
export function disarmHover(): void {
  armed = false
  setHover(null)
}

/** Marks an element as standing for something, and reports it on movement, on enter and on
 *  focus, so tabbing through a view gives the same readout the pointer does.
 *
 *  Movement is what arms the store, and it is bound here rather than on the shell so that the
 *  same event can arm and report in one step: a pointer that comes to rest on an arc during a
 *  switch is over something real, and asking it to leave and re-enter before the chart will
 *  answer would be a chart that ignores the reader. `setHover` drops a repeat of what is
 *  already showing, so the moves after the first cost a comparison. */
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
       saying which thing they mean. It reports whether or not the pointer has moved. */
    onFocus: on,
    "data-hoversrc": "",
  }
}

/** The other half, spread once on the shell. Closes over nothing, so it is written once
 *  rather than rebuilt per render.
 *
 *  `mouseover` rather than `mouseleave` is what makes this work: it fires for whatever the
 *  pointer arrives at, marked or not, and the two cases cannot both apply -- if the target is
 *  inside a source, that source's own `mouseenter` is setting the hover, and this leaves it
 *  alone. `mouseleave` is still needed for the way out of the shell entirely, where there is
 *  no `mouseover` inside it left to read. Blur asks the same question of where focus went. */
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
  /* Armed again rather than disarmed, which is the opposite of what the changes above do and
     for the same reason they do it. Those rearrange a picture the pointer is resting in; this
     one takes the picture away -- the page turns back to the drop zone, and whatever report
     comes next arrives after the reader has been to a folder picker and back, which is a
     pointer that has moved. A clean slate is a slate that answers. */
  armed = true
  setHover(null)
  setState({ ...INITIAL, theme: state.theme, lang: state.lang })
}

/* ---------- URL state ----------
   The hash is the whole shareable view: TTL lens, drill path, which chart, panels-or-table, query,
   whether amounts are hidden, and the theme. `history.replaceState` can throw on a
   `file://` page, which is the normal way this is opened, so writing is best-effort. */

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
  if (p.p) out.path = p.p.split(">").filter(Boolean).slice(0, 2)
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
  if (s.path.length) parts.push("p=" + encodeURIComponent(s.path.join(">")))
  if (s.chart !== "mosaic") parts.push("c=" + s.chart)
  if (s.view !== "panels") parts.push("v=" + s.view)
  if (s.query) parts.push("q=" + encodeURIComponent(s.query))
  if (s.pctOnly) parts.push("u=pct")
  if (s.theme !== "system") parts.push("t=" + s.theme)
  /* Against the guess rather than against a constant, which is the one place this differs from
     every other key: `en` is not the default, *the reader's own browser* is. So a link carries
     a language only when its author overrode theirs, and a link that never mentions one arrives
     in whatever the person opening it reads. Sharing a view should not also export a locale. */
  if (s.lang !== GUESSED) parts.push("l=" + s.lang)
  return parts.length ? "#" + parts.join("&") : ""
}
