/* The turn: which face the page's one card is showing, and the phase in between. */

import { useCallback, useEffect, useRef, useState } from "react"
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/react"
import type { Analysis } from "../core/engine.ts"
import { hosted, scrub } from "../core/analytics.ts"
import { loadFace } from "./faces.ts"
import { applyUrl, readPath, resetState, useViewState } from "./store.ts"
import { useT } from "./copy.tsx"
import { tagOf } from "../core/i18n.ts"
import { canTransition, cssMs, reduced, transition } from "./Motion.tsx"
import { Page, type Dir } from "./Page.tsx"
import { decodeImport, pendingImport } from "./transfer.ts"

/** A view goes out under the name of the face it is, never the one in the address bar -- see
 *  `scrub`, which is where the reader's own line items are kept out of it. The `PROD` half of the
 *  guard beside it is what keeps the dev server and the suites off the network: unbuilt, the
 *  component fetches its debug script from a Vercel domain, and this page reaches nobody. */
const rename = (event: BeforeSendEvent): BeforeSendEvent | null => {
  const url = scrub(event.url)
  return url === null ? null : { ...event, url }
}

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
  /* A report is on its way out of the address bar, so the empty card is not what belongs on
     screen -- and the folder-reading face is not what belongs on the network either. Held until
     the bill lands, or until the decode comes back with nothing. */
  const [importing, setImporting] = useState(() => !!pendingImport())
  useTheme()
  useLangAttr()

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  /** Turn the card over to `next` -- inside a view transition where there is one, exit first
   *  where there is not. */
  const turnTo = useCallback((next: Analysis | null, dir: Dir, sample: boolean, home = false) => {
    /* Cleared with the report rather than before it: the view state is what the departing face
       is still being drawn from, and dropping the drill-down under it would reshape the picture
       on its way out. */
    const swap = (): void => {
      if (!next) resetState()
      setTurn({ data: next, leaving: false, dir, sample })
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

  /* The last bill read, kept so a Forward back into `/report` has something to show. Nothing else
     can restore it: the address carries the view, but the transcripts came out of a folder this
     page never gets to open twice. */
  const last = useRef<{ data: Analysis; sample: boolean } | null>(null)

  /* The face is awaited before the card turns rather than inside the turn: a view transition
     photographs the tree it is handed, and a face still on the network would be photographed
     empty. The wait is a microtask wherever the prefetch got there first, which is everywhere the
     reader had time to drop a folder. */
  const onData = useCallback(
    (data: Analysis, sample: boolean) => {
      last.current = { data, sample }
      void loadFace("report").then(() => turnTo(data, "fwd", sample))
    },
    [turnTo],
  )

  /* A report the CLI dropped in the address rather than a folder dropped on the card. It was
     lifted out of the hash before the first render -- see `takeImport` -- so what is left here is
     the decode. Latched rather than left to the dependency list: StrictMode runs an effect twice
     on mount, and turning the card over twice would push a second history entry. */
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

  /* Start over is a move home rather than an undo, so it goes forward to `/` and leaves the
     report where it was: `history.back()` would have risen one drill level instead, since going
     into a group is an entry of its own. */
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
      />
      {import.meta.env.PROD && hosted(location.protocol, location.pathname) && (
        <Analytics beforeSend={rename} />
      )}
    </>
  )
}
