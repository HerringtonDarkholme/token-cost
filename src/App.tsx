/* The turn: which face the page's one card is showing, and the phase in between. */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Analysis } from "./engine.ts"
import { readHash, resetState, setState, useViewState } from "./store.ts"
import { useT } from "./copy.tsx"
import { tagOf } from "./i18n.ts"
import { canTransition, cssMs, reduced, transition } from "./Motion.tsx"
import { Page, type Dir } from "./Page.tsx"

/** How long the departing face is held on the fallback path. */
function exitMs(): number {
  return reduced() ? 0 : cssMs("--panel-close-dur", 350)
}

/** Theme is an attribute on the root element, outside React's tree, because the stylesheet needs
 *  it above `body`. "system" removes the attribute rather than guessing a value -- that is the
 *  un-stamped state where `prefers-color-scheme` decides. */
function useTheme(): void {
  const { theme } = useViewState()
  useEffect(() => {
    const root = document.documentElement
    if (theme === "system") root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", theme)
  }, [theme])
}

/** And the language, on the same element and for the same reason: `lang` is above `body`, and it
 *  is not decoration -- a screen reader picks its voice from it, and the browser picks its
 *  hyphenation and its quotes. */
function useLangAttr(): void {
  const { lang } = useViewState()
  const t = useT()
  useEffect(() => {
    document.documentElement.lang = tagOf(lang)
    document.title = t.card.title
  }, [lang, t])
}

interface Turn {
  data: Analysis | null
  leaving: boolean
  dir: Dir
}

export function App(): React.JSX.Element {
  const [turn, setTurn] = useState<Turn>({ data: null, leaving: false, dir: "fwd" })
  useTheme()
  useLangAttr()

  /* Seed from the shared link before anything paints, so a link that says "dark, table view,
     drilled into shell commands" arrives that way rather than snapping into it. */
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
   *  where there is not. */
  const turnTo = useCallback((next: Analysis | null, dir: Dir, home = false) => {
    /* Cleared with the report rather than before it: the view state is what the departing face
       is still being drawn from, and dropping the drill-down under it would reshape the picture
       on its way out. */
    const swap = (): void => {
      if (!next) resetState()
      setTurn({ data: next, leaving: false, dir })
    }

    if (canTransition()) {
      /* Up first and without tweening it, because the capture that is about to happen is of the
         viewport: a smooth scroll still running when the snapshot is taken would be photographed
         mid-flight, and a scroll *inside* the callback would move the ground the old and new
         snapshots are being lined up against. */
      if (home) window.scrollTo({ top: 0, behavior: "auto" })
      /* `data-turn` is which way the page is going, and it is also what tells the stylesheet
         that the transition now starting is the turn rather than the breakdown filtering itself
         -- the two want different things named and different things left alone. */
      transition(swap, { "data-turn": dir })
      return
    }

    /* Before the exit, not after: the report is several screens taller than the empty card, so a
       reset from down in the footnotes would otherwise shrink the document under a scroll
       position the browser then has to clamp -- which reads as the page leaping, however well
       the card itself tweens. */
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
