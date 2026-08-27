/* The turn: which face the page's one card is showing, and the phase in between. */

import { useCallback, useEffect, useRef, useState } from "react"
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/react"
import type { Analysis } from "../core/engine.ts"
import { hosted, scrub } from "../core/analytics.ts"
import { loadFace } from "./faces.ts"
import { applyUrl, readPath, resetState, useViewState } from "./store.ts"
import { useT } from "./copy.tsx"
import { tagOf } from "../core/i18n.ts"
import { canTransition, reduced, transition } from "./Motion.tsx"
import { Page, type Dir } from "./Page.tsx"
import { decodeImport, pendingImport } from "./transfer.ts"

/** A view goes out under the name of the face it is, never the one in the address bar -- see
 *  `scrub`. The `PROD` half of the guard beside it keeps the dev server and the suites off the
 *  network. */
const rename = (event: BeforeSendEvent): BeforeSendEvent | null => {
  const url = scrub(event.url)
  return url === null ? null : { ...event, url }
}

/** Theme is an attribute on the root element, outside React's tree, because the stylesheet needs
 *  it above `body`. "system" removes the attribute rather than guessing a value. */
function useTheme(): void {
  const { theme } = useViewState()
  useEffect(() => {
    const root = document.documentElement
    if (theme === "system") root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", theme)
  }, [theme])
}

/** And the language, on the same element: a screen reader picks its voice from `lang`, and the
 *  browser its hyphenation and quotes. */
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
  /** The bill on show came from the example rather than from anyone's folder. */
  sample: boolean
}

/** The address is what says which face belongs on screen -- `/report` and everything under it is
 *  the report, `/` is the empty card. */
function addressed(): boolean {
  return readPath(location.pathname).report
}

export function App(): React.JSX.Element {
  const [turn, setTurn] = useState<Turn>({
    data: null,
    leaving: false,
    dir: "fwd",
    sample: false,
  })
  /* A report is on its way out of the address bar, so neither face belongs yet. Held until the bill
     lands, or until the decode comes back with nothing. */
  const [importing, setImporting] = useState(() => !!pendingImport())
  useTheme()
  useLangAttr()

  /* The swap the departing face is still standing in the way of, on the path with no view
     transition: `Reveal` says when it has finished leaving. */
  const exit = useRef<(() => void) | null>(null)
  const onExited = useCallback(() => {
    const swap = exit.current
    exit.current = null
    swap?.()
  }, [])

  /** Turn the card over to `next` -- inside a view transition where there is one, exit first
   *  where there is not. */
  const turnTo = useCallback((next: Analysis | null, dir: Dir, sample: boolean, home = false) => {
    /* Cleared with the report rather than before it: the departing face is still being drawn from
       the view state. */
    const swap = (): void => {
      if (!next) resetState()
      setTurn({ data: next, leaving: false, dir, sample })
    }

    if (canTransition()) {
      /* Up first and without tweening it: the capture about to happen is of the viewport, and a
         smooth scroll still running would be photographed mid-flight. */
      if (home) window.scrollTo({ top: 0, behavior: "auto" })
      /* `data-turn` is which way the page is going, and what tells the stylesheet this transition
         is the turn rather than the breakdown filtering itself. */
      transition(swap, { "data-turn": dir })
      return
    }

    /* Before the exit, not after: the report is several screens taller, so a reset from the
       footnotes would shrink the document under a scroll position the browser then clamps. */
    if (home) window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" })
    setTurn((t) => ({ ...t, leaving: true, dir }))
    exit.current = swap
  }, [])

  /* The last bill read, kept so a Forward back into `/report` has something to show: the
     transcripts came out of a folder this page never gets to open twice. */
  const last = useRef<{ data: Analysis; sample: boolean } | null>(null)

  /* The face is awaited before the card turns rather than inside it: a view transition photographs
     the tree it is handed, and a face still on the network would be photographed empty. */
  const onData = useCallback(
    (data: Analysis, sample: boolean) => {
      last.current = { data, sample }
      void loadFace("report").then(() => turnTo(data, "fwd", sample))
    },
    [turnTo],
  )

  /* A report the CLI dropped in the address, lifted out of the hash before the first render -- see
     `takeImport` -- so what is left here is the decode. Latched, because StrictMode runs an effect
     twice and a second turn would push a second history entry. */
  const imported = useRef(false)
  useEffect(() => {
    const raw = pendingImport()
    if (!raw || imported.current) return
    imported.current = true
    void (async () => {
      /* Together rather than in turn: the decode is a gzip stream and the face is a fetch, and
         neither is waiting on the other. */
      const [data] = await Promise.all([decodeImport(raw), loadFace("report")])
      if (data) {
        onData(data, false)
        return
      }
      /* Awaited before the card is handed back, the way `onReset` does it: a link that decodes to
         nothing has to arrive at a droppable card rather than at an empty slot. */
      await loadFace("intake")
      setImporting(false)
    })()
  }, [onData])

  /* Start over is a move home rather than an undo, so it goes forward to `/`: `history.back()`
     would rise one drill level instead. */
  const onReset = useCallback(() => {
    void (async () => {
      await loadFace("intake")
      setImporting(false)
      turnTo(null, "back", false, true)
    })()
  }, [turnTo])

  /* Re-bound on every turn rather than once, because what a pop means depends on which face is
     showing. */
  useEffect(() => {
    const onPop = (): void => {
      const want = addressed() ? last.current : null
      /* Out of the report: the view state is what the departing face is still drawn from, so it
         is left alone here -- the reset rides with the swap. */
      if (!want) {
        if (turn.data) onReset()
        return
      }
      applyUrl(want.data)
      if (!turn.data) turnTo(want.data, "fwd", want.sample)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [turn.data, turnTo, onReset])

  return (
    <>
      <Page
        data={turn.data}
        leaving={turn.leaving}
        dir={turn.dir}
        sample={turn.sample}
        importing={importing}
        onData={onData}
        onReset={onReset}
        onExited={onExited}
      />
      {import.meta.env.PROD && hosted(location.protocol, location.pathname) && (
        <Analytics beforeSend={rename} />
      )}
    </>
  )
}
