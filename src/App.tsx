/* The turn: which face the page's one card is showing, and the phase in between.

   A face swap cannot be a single state change. React tears the old contents out on the same
   tick the new ones go in, which leaves nothing on screen to animate away, so a turn is two
   steps: the face on show is held mounted with `leaving` set and plays its exit, and only when
   that has run does the swap happen -- at which point the arriving face mounts closed and
   opens on the next frame. One boolean, and it serves both directions.

   The analysis is held here rather than lower down because this is the boundary that owns
   whether there is one at all. What it no longer owns is the DOM: the card, the toolbar and
   the header below are the same elements across the turn, which is the whole point of it. */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Analysis } from "./engine.ts"
import { readHash, resetState, setState, useViewState } from "./store.ts"
import { cssMs } from "./Motion.tsx"
import { Page, type Dir } from "./Page.tsx"

/** Motion the reader asked not to see. Read at each turn rather than once, because the setting
 *  can change under a page that is already open. */
function reduced(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** How long the departing face is held. Zero when motion is reduced: the exit is `none` in
 *  that case, so waiting for it would be a frozen page rather than a transition. */
function exitMs(): number {
  return reduced() ? 0 : cssMs("--panel-close-dur", 350)
}

/** Theme is an attribute on the root element, outside React's tree, because the stylesheet
 *  needs it above `body`. "system" removes the attribute rather than guessing a value --
 *  that is the un-stamped state where `prefers-color-scheme` decides. */
function useTheme(): void {
  const { theme } = useViewState()
  useEffect(() => {
    const root = document.documentElement
    if (theme === "system") root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", theme)
  }, [theme])
}

interface Turn {
  data: Analysis | null
  leaving: boolean
  dir: Dir
}

export function App(): React.JSX.Element {
  const [turn, setTurn] = useState<Turn>({ data: null, leaving: false, dir: "fwd" })
  useTheme()

  /* Seed from the shared link before anything paints, so a link that says "dark, table
     view, drilled into shell commands" arrives that way rather than snapping into it. */
  useEffect(() => {
    setState(readHash(location.hash))
  }, [])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  /** Turn the card over to `next`, exit first. */
  const turnTo = useCallback((next: Analysis | null, dir: Dir) => {
    setTurn((t) => ({ ...t, leaving: true, dir }))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      /* Cleared with the report rather than before it: the view state is what the departing
         face is still being drawn from, and dropping the drill-down under it would reshape
         the picture on its way out. */
      if (!next) resetState()
      setTurn({ data: next, leaving: false, dir })
    }, exitMs())
  }, [])

  const onData = useCallback((data: Analysis) => turnTo(data, "fwd"), [turnTo])

  const onReset = useCallback(() => {
    /* Before the exit, not after: the report is several screens taller than the empty card, so
       a reset from down in the footnotes would otherwise shrink the document under a scroll
       position the browser then has to clamp -- which reads as the page leaping, however well
       the card itself tweens. */
    window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" })
    turnTo(null, "back")
  }, [turnTo])

  return (
    <Page
      data={turn.data}
      leaving={turn.leaving}
      dir={turn.dir}
      onData={onData}
      onReset={onReset}
    />
  )
}
