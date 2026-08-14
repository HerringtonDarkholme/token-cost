/* The turn: which face the page's one card is showing, and the phase in between.

   A face swap cannot be a single state change -- not on its own. React tears the old contents
   out on the same tick the new ones go in, which leaves nothing on screen to animate away. So
   there are two ways to run the turn, and this module picks between them.

   The first is `startViewTransition`, which is the browser solving exactly this: it captures
   what is on screen, lets the swap happen in one tick, and cross-fades its picture of the old
   screen against the live new one. One state change, both halves of the motion at once, and
   what the CSS animates is a pair of pseudo-elements rather than the real DOM -- see the
   view-transition block in the stylesheet.

   The second is the fallback, and it is the two-step this used to be everywhere: the face on
   show is held mounted with `leaving` set and plays its exit, and only when that has run does
   the swap happen -- at which point the arriving face mounts closed and opens on the next
   frame. It is slower by an exit, because the two halves cannot overlap without a snapshot to
   overlap them against, but it needs nothing beyond a CSS transition.

   The analysis is held here rather than lower down because this is the boundary that owns
   whether there is one at all. What it no longer owns is the DOM: the card, the toolbar and
   the header below are the same elements across the turn, which is the whole point of it. */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Analysis } from "./engine.ts"
import { readHash, resetState, setState, useViewState } from "./store.ts"
import { canTransition, cssMs, reduced, transition } from "./Motion.tsx"
import { Page, type Dir } from "./Page.tsx"

/** How long the departing face is held on the fallback path. Zero when motion is reduced: the
 *  exit is `none` in that case, so waiting for it would be a frozen page rather than a
 *  transition. */
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

  /** Turn the card over to `next` -- inside a view transition where there is one, exit first
   *  where there is not. `home` sends the page back to the top on the way, which the turn back
   *  to the empty card needs and the turn away from it does not. */
  const turnTo = useCallback((next: Analysis | null, dir: Dir, home = false) => {
    /* Cleared with the report rather than before it: the view state is what the departing
       face is still being drawn from, and dropping the drill-down under it would reshape the
       picture on its way out. Inside a view transition that ordering is free -- the departing
       face is a snapshot by then -- but it costs nothing to keep the one rule. */
    const swap = (): void => {
      if (!next) resetState()
      setTurn({ data: next, leaving: false, dir })
    }

    if (canTransition()) {
      /* Up first and without tweening it, because the capture that is about to happen is of
         the viewport: a smooth scroll still running when the snapshot is taken would be
         photographed mid-flight, and a scroll *inside* the callback would move the ground the
         old and new snapshots are being lined up against. The cross-fade covers the jump,
         which is the whole reason it can be a jump. */
      if (home) window.scrollTo({ top: 0, behavior: "auto" })
      /* `data-turn` is which way the page is going, and it is also what tells the stylesheet
         that the transition now starting is the turn rather than the breakdown filtering
         itself -- the two want different things named and different things left alone. */
      transition(swap, { "data-turn": dir })
      return
    }

    /* Before the exit, not after: the report is several screens taller than the empty card, so
       a reset from down in the footnotes would otherwise shrink the document under a scroll
       position the browser then has to clamp -- which reads as the page leaping, however well
       the card itself tweens. There is room to tween it here, unlike above, because nothing is
       being photographed: the exit runs on the real elements and travels with the scroll. */
    if (home) window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" })
    setTurn((t) => ({ ...t, leaving: true, dir }))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(swap, exitMs())
  }, [])

  const onData = useCallback((data: Analysis) => turnTo(data, "fwd"), [turnTo])
  const onReset = useCallback(() => turnTo(null, "back", true), [turnTo])

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
